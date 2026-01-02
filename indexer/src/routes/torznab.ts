import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getScraper, isValidSite, getAvailableSites, contentTypeToCategory } from '../scrapers/index.js';
import { buildTorznabResponse, buildCapsResponse, buildErrorResponse } from '../utils/xml.js';
import { TorznabItem, TorznabCaps, TorznabCategory, SearchParams, ScraperResult, ContentType } from '../models/torznab.js';
import { SiteType, config } from '../config.js';
import { generateFakeTorrent } from '../utils/torrent.js';
import { isDlProtectLink, resolveDlProtectLink } from '../utils/dlprotect.js';
import { BaseScraper } from '../scrapers/base.js';

interface TorznabQuerystring {
  t?: string;
  q?: string;
  cat?: string;
  limit?: string;
  offset?: string;
  imdbid?: string;
  tmdbid?: string;
  tvdbid?: string;
  season?: string;
  ep?: string;
  apikey?: string;
  hoster?: string;
  year?: string;
}

interface SiteParams {
  site: string;
}

interface SiteWithHostersParams {
  site: string;
  hosters: string;
}

interface SearchContext {
  action: string;
  searchParams: SearchParams;
  categoryFilter: number[] | null;
  scraper: BaseScraper;
  request: FastifyRequest;
}

// Category groups
const MOVIE_CATEGORIES = [2000, 2030, 2040, 2045, 2060];
const TV_CATEGORIES = [5000, 5030, 5040, 5045];
const ANIME_CATEGORIES = [5070];
const EBOOK_CATEGORIES = [7000, 7010, 7020, 7030, 7050];

/**
 * Determine content type from category filter
 */
function getContentTypeFromCategories(categoryFilter: number[] | null): ContentType | null {
  if (!categoryFilter || categoryFilter.length === 0) {
    return null;
  }

  if (categoryFilter.some(cat => MOVIE_CATEGORIES.includes(cat))) {
    return 'movie';
  }
  if (categoryFilter.some(cat => TV_CATEGORIES.includes(cat))) {
    return 'series';
  }
  if (categoryFilter.some(cat => ANIME_CATEGORIES.includes(cat))) {
    return 'anime';
  }
  if (categoryFilter.some(cat => EBOOK_CATEGORIES.includes(cat))) {
    return 'ebook';
  }

  return null;
}

function getCapsForSite(siteName: string): TorznabCaps {
  return {
    server: {
      title: `DDL Torznab - ${siteName}`,
    },
    limits: {
      default: 100,
      max: 500,
    },
    searching: {
      search: { available: true },
      tvsearch: { available: true },
      moviesearch: { available: true },
      booksearch: { available: true },
    },
    categories: [
      // Movies
      { id: TorznabCategory.Movies, name: 'Movies' },
      { id: TorznabCategory.MoviesSD, name: 'Movies/SD' },
      { id: TorznabCategory.MoviesHD, name: 'Movies/HD' },
      { id: TorznabCategory.MoviesUHD, name: 'Movies/UHD' },
      { id: TorznabCategory.Movies3D, name: 'Movies/3D' },
      // TV
      { id: TorznabCategory.TV, name: 'TV' },
      { id: TorznabCategory.TVSD, name: 'TV/SD' },
      { id: TorznabCategory.TVHD, name: 'TV/HD' },
      { id: TorznabCategory.TVUHD, name: 'TV/UHD' },
      // Anime
      { id: TorznabCategory.Anime, name: 'Anime' },
      // Books
      { id: TorznabCategory.Books, name: 'Books' },
      { id: TorznabCategory.BooksMags, name: 'Books/Mags' },
      { id: TorznabCategory.BooksEBook, name: 'Books/EBook' },
      { id: TorznabCategory.BooksComics, name: 'Books/Comics' },
      { id: TorznabCategory.BooksOther, name: 'Books/Other' },
    ],
  };
}

async function processResults(results: ScraperResult[]): Promise<TorznabItem[]> {
  const items: TorznabItem[] = [];
  const resolveInIndexer = config.dlprotectResolveAt === 'indexer';
  const baseDate = new Date();

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    // Resolve dl-protect links via Botasaurus service (if configured to resolve in indexer)
    // Note: Debriding is now handled by the downloader service
    let link = result.link;
    if (resolveInIndexer && isDlProtectLink(link)) {
      link = await resolveDlProtectLink(link);
    }

    items.push({
      title: result.title,
      guid: Buffer.from(result.link).toString('base64').slice(0, 40),
      link,
      comments: result.pageUrl,
      pubDate: result.pubDate || new Date(baseDate.getTime() - (i * 60 * 1000)),
      size: result.size,
      category: contentTypeToCategory(result.contentType, result.quality),
      imdbId: result.imdbId,
      tmdbId: result.tmdbId,
      season: result.season,
      episode: result.episode,
      quality: result.quality,
      language: result.language,
      year: result.year,
    });
  }

  return items;
}

/**
 * Core search logic shared between endpoints
 */
async function executeSearch(ctx: SearchContext): Promise<string> {
  const { action, searchParams, categoryFilter, scraper, request } = ctx;

  // Si pas de query mais une catégorie est spécifiée, retourne les dernières releases
  if (!searchParams.q && !searchParams.imdbid && !searchParams.tmdbid && !searchParams.tvdbid) {
    const contentType = getContentTypeFromCategories(categoryFilter);
    
    // Si une catégorie est spécifiée et que le scraper supporte getLatest
    if (contentType && scraper.getLatest) {
      console.log(`[Torznab] Empty search with category - fetching latest ${contentType}`);
      const limit = searchParams.limit || 100;
      
      try {
        const results = await scraper.getLatest(contentType, limit);
        
        if (results.length > 0) {
          const items = await processResults(results);
          const protocol = request.headers['x-forwarded-proto'] || 'http';
          const host = request.headers['x-forwarded-host'] || request.headers.host;
          const baseUrl = `${protocol}://${host}`;
          return buildTorznabResponse(items, scraper.name, baseUrl);
        }
      } catch (error) {
        console.error(`[Torznab] Error fetching latest ${contentType}:`, error);
      }
    }

    // Fallback: retourne un résultat fictif (utile pour les tests de connexion Radarr/Sonarr)
    console.log(`[Torznab] Empty search query - returning dummy result (connection test)`);
    const dummyItem: TorznabItem = {
      title: 'DDL Torznab Connection Test',
      guid: 'ddl-torznab-test',
      link: 'https://example.com/test',
      pubDate: new Date(),
      size: 1500000000, // 1.5 GB
      category: action === 'tvsearch' ? TorznabCategory.TVHD : TorznabCategory.MoviesHD,
      quality: '1080p',
      language: 'MULTI',
    };
    return buildTorznabResponse([dummyItem], scraper.name);
  }

  let results: ScraperResult[] = [];

  console.log(`[Torznab] Action: "${action}", Categories: ${categoryFilter ? categoryFilter.join(',') : 'none'}`);

  switch (action) {
    case 'search': {
      // For generic search, check categories to determine what to search
      const searchPromises: Promise<ScraperResult[]>[] = [];

      const shouldSearchMovies = !categoryFilter || categoryFilter.length === 0 ||
        categoryFilter.some(cat => MOVIE_CATEGORIES.includes(cat));
      const shouldSearchTV = !categoryFilter || categoryFilter.length === 0 ||
        categoryFilter.some(cat => TV_CATEGORIES.includes(cat));
      const shouldSearchAnime = !categoryFilter || categoryFilter.length === 0 ||
        categoryFilter.some(cat => ANIME_CATEGORIES.includes(cat));
      const shouldSearchEbooks = !categoryFilter || categoryFilter.length === 0 ||
        categoryFilter.some(cat => EBOOK_CATEGORIES.includes(cat));

      console.log(`[Torznab] Search filters - Movies: ${shouldSearchMovies}, TV: ${shouldSearchTV}, Anime: ${shouldSearchAnime}, Ebooks: ${shouldSearchEbooks}`);

      if (shouldSearchMovies) {
        searchPromises.push(scraper.searchMovies(searchParams));
      }
      if (shouldSearchTV) {
        searchPromises.push(scraper.searchSeries(searchParams));
      }
      if (shouldSearchAnime && scraper.searchAnime) {
        searchPromises.push(scraper.searchAnime(searchParams));
      }
      if (shouldSearchEbooks && scraper.searchEbooks) {
        searchPromises.push(scraper.searchEbooks(searchParams));
      }

      const searchResults = await Promise.allSettled(searchPromises);
      for (const result of searchResults) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        }
      }
      break;
    }
    case 'movie':
      // Only search if imdbid is provided to avoid duplicate results
      // (Radarr sends both text and imdbid searches)
      if (searchParams.imdbid) {
        results = await scraper.searchMovies(searchParams);
      } else {
        console.log(`[Torznab] Skipping movie search without imdbid to avoid duplicates`);
        results = [];
      }
      break;
    case 'tvsearch':
      // Only search if imdbid is provided to avoid duplicate results
      // (Sonarr sends both text and imdbid searches)
      if (searchParams.imdbid) {
        results = await scraper.searchSeries(searchParams);
      } else {
        console.log(`[Torznab] Skipping tvsearch without imdbid to avoid duplicates`);
        results = [];
      }
      break;
    case 'book':
      if (scraper.searchEbooks) {
        results = await scraper.searchEbooks(searchParams);
      } else {
        console.log(`[Torznab] Scraper ${scraper.name} does not support ebook search`);
        results = [];
      }
      break;
  }

  // Filter by category AFTER search (for fine-grained quality filtering like HD vs UHD)
  if (categoryFilter && categoryFilter.length > 0) {
    results = results.filter(result => {
      const category = contentTypeToCategory(result.contentType, result.quality);
      if (categoryFilter.includes(category)) {
        return true;
      }
      console.log(`[Torznab] Skipping "${result.title}" - category ${category} not in filter: ${categoryFilter.join(',')}`);
      return false;
    });
  }

  // Filter out results without valid size (Radarr/Sonarr need size info)
  const beforeSizeFilter = results.length;
  results = results.filter(result => {
    if (!result.size || result.size <= 0) {
      console.log(`[Torznab] Skipping "${result.title}" - no valid size`);
      return false;
    }
    return true;
  });
  if (beforeSizeFilter !== results.length) {
    console.log(`[Torznab] Filtered out ${beforeSizeFilter - results.length} results without size`);
  }

  // Process results (resolve dl-protect links)
  const items = await processResults(results);

  // Apply limit and offset
  const start = searchParams.offset || 0;
  const end = start + (searchParams.limit || 100);
  const paginatedItems = items.slice(start, end);

  // Génère l'URL de base pour les liens torrent
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const baseUrl = `${protocol}://${host}`;

  return buildTorznabResponse(paginatedItems, scraper.name, baseUrl);
}

/**
 * Handle a Torznab search request
 */
async function handleTorznabRequest(
  request: FastifyRequest<{ Querystring: TorznabQuerystring }>,
  reply: FastifyReply,
  site: string,
  hostersOverride?: string
): Promise<string> {
  const { t: action, q, cat, limit, offset, imdbid, tmdbid, tvdbid, season, ep, hoster, year } = request.query;

  if (hostersOverride) {
    console.log(`[Torznab] Request with hosters in path: site=${site}, hosters=${hostersOverride}`);
  }

  // Parse category filter
  const categoryFilter = cat
    ? cat.split(',').map(c => parseInt(c.trim(), 10)).filter(c => !isNaN(c))
    : null;

  // Validate site
  if (!isValidSite(site)) {
    reply.type('application/xml');
    return buildErrorResponse(100, `Unknown site: ${site}. Available: ${getAvailableSites().join(', ')}`);
  }

  const scraper = getScraper(site as SiteType);
  if (!scraper) {
    reply.type('application/xml');
    return buildErrorResponse(100, `Site ${site} is not configured`);
  }

  reply.type('application/xml');

  // Handle capabilities request
  if (action === 'caps') {
    return buildCapsResponse(getCapsForSite(scraper.name));
  }

  // Validate action
  if (!action || !['search', 'tvsearch', 'movie', 'book'].includes(action)) {
    return buildErrorResponse(200, 'Missing or invalid parameter t');
  }

  // Extract year from query if present (e.g., "Apocalypto 2006" -> year=2006, q="Apocalypto")
  let searchQuery = q || '';
  let extractedYear = year;
  const yearMatch = searchQuery.match(/^(.+?)\s+(\d{4})$/);
  if (yearMatch) {
    searchQuery = yearMatch[1].trim();
    extractedYear = extractedYear || yearMatch[2];
    console.log(`[Torznab] Extracted year from query: "${q}" -> q="${searchQuery}", year=${extractedYear}`);
  }

  // Build search params - hosters from path override query param
  const searchParams: SearchParams = {
    q: searchQuery,
    limit: limit ? parseInt(limit, 10) : 100,
    offset: offset ? parseInt(offset, 10) : 0,
    imdbid,
    tmdbid,
    tvdbid,
    season,
    ep,
    hoster: hostersOverride || hoster,
    year: extractedYear,
  };

  try {
    return await executeSearch({
      action,
      searchParams,
      categoryFilter,
      scraper,
      request,
    });
  } catch (error) {
    console.error(`Search error for ${site}:`, error);
    return buildErrorResponse(900, 'Internal server error');
  }
}

export async function torznabRoutes(app: FastifyInstance): Promise<void> {
  // Health check
  app.get('/health', async () => {
    return { status: 'ok', sites: getAvailableSites() };
  });

  // List available sites
  app.get('/sites', async () => {
    return { sites: getAvailableSites() };
  });

  // Génère un faux fichier .torrent contenant le lien DDL
  // Usage: /torrent?link=URL_ENCODEE&name=NOM_FICHIER&size=TAILLE
  app.get<{
    Querystring: { link: string; name?: string; size?: string };
  }>('/torrent', async (request, reply) => {
    const { link, name, size } = request.query;

    if (!link) {
      reply.status(400);
      return { error: 'Missing link parameter' };
    }

    const decodedLink = decodeURIComponent(link);
    const fileName = name || 'download';
    const fileSize = size ? parseInt(size, 10) : undefined;

    console.log(`[Torrent] Generating fake torrent for: ${decodedLink}`);

    const torrentBuffer = generateFakeTorrent({
      name: fileName,
      link: decodedLink,
      size: fileSize,
    });

    reply
      .header('Content-Type', 'application/x-bittorrent')
      .header('Content-Disposition', `attachment; filename="${fileName}.torrent"`)
      .send(torrentBuffer);
  });

  // Generic Torznab API endpoint (without site parameter)
  // Used by Radarr/Sonarr for capabilities check
  app.get<{
    Querystring: TorznabQuerystring;
  }>('/api', async (request: FastifyRequest<{ Querystring: TorznabQuerystring }>, reply: FastifyReply) => {
    const { t: action } = request.query;

    reply.type('application/xml');

    if (action === 'caps') {
      const sites = getAvailableSites();
      const siteName = sites.length > 0 ? sites.join(', ') : 'DDL Torznab';
      return buildCapsResponse(getCapsForSite(siteName));
    }

    return buildErrorResponse(100, `Please specify a site. Available: ${getAvailableSites().join(', ')}. Use /api/{site}?t=...`);
  });

  // Torznab API endpoint: /api/:site
  app.get<{
    Params: SiteParams;
    Querystring: TorznabQuerystring;
  }>('/api/:site', async (request: FastifyRequest<{ Params: SiteParams; Querystring: TorznabQuerystring }>, reply: FastifyReply) => {
    const { site } = request.params;
    return handleTorznabRequest(request, reply, site);
  });

  // Torznab API endpoint with hosters in path: /api/:site/:hosters
  app.get<{
    Params: SiteWithHostersParams;
    Querystring: TorznabQuerystring;
  }>('/api/:site/:hosters', async (request: FastifyRequest<{ Params: SiteWithHostersParams; Querystring: TorznabQuerystring }>, reply: FastifyReply) => {
    const { site, hosters } = request.params;
    return handleTorznabRequest(request, reply, site, hosters);
  });
}