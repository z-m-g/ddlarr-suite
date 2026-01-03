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

function getContentTypesFromCategories(categoryFilter: number[] | null): ContentType[] {
  if (!categoryFilter || categoryFilter.length === 0) {
    return ['movie', 'series', 'anime', 'ebook'];
  }
  const types: ContentType[] = [];
  if (categoryFilter.some(c => MOVIE_CATEGORIES.includes(c))) types.push('movie');
  if (categoryFilter.some(c => TV_CATEGORIES.includes(c))) types.push('series');
  if (categoryFilter.some(c => ANIME_CATEGORIES.includes(c))) types.push('anime');
  if (categoryFilter.some(c => EBOOK_CATEGORIES.includes(c))) types.push('ebook');
  return types.length > 0 ? types : ['movie', 'series', 'anime', 'ebook'];
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
  const now = new Date();

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    let link = result.link;
    if (resolveInIndexer && isDlProtectLink(link)) {
      link = await resolveDlProtectLink(link);
    }

    items.push({
      title: result.title,
      guid: Buffer.from(`${result.link}-${result.title}`).toString('base64'),
      link,
      comments: result.pageUrl,
      pubDate: result.pubDate || new Date(now.getTime() - i * 60000),
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
 * Handle RSS feed (no search query) - returns latest items
 */
async function handleRssFeed(ctx: SearchContext): Promise<string> {
  const { searchParams, categoryFilter, scraper, request } = ctx;
  const contentTypes = getContentTypesFromCategories(categoryFilter);
  let allResults: ScraperResult[] = [];

  if (scraper.getLatest) {
    const tasks = contentTypes.map(type => scraper.getLatest!(type, searchParams.limit));
    const completed = await Promise.allSettled(tasks);
    for (const res of completed) {
      if (res.status === 'fulfilled') allResults = [...allResults, ...res.value];
    }
  }

  let items = await processResults(allResults);

  // Filter by category if specified
  if (categoryFilter && categoryFilter.length > 0) {
    items = items.filter(item => categoryFilter.includes(item.category as number));
  }

  // Sort by date descending
  items.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dateB - dateA;
  });

  // Apply limit
  items = items.slice(0, searchParams.limit || 100);

  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const baseUrl = `${protocol}://${host}`;

  return buildTorznabResponse(items, scraper.name, baseUrl);
}

/**
 * Core search logic shared between endpoints
 */
async function executeSearch(ctx: SearchContext): Promise<string> {
  const { action, searchParams, categoryFilter, scraper, request } = ctx;

  // RSS feed mode: no search query provided
  if (!searchParams.q && !searchParams.imdbid && !searchParams.tmdbid && !searchParams.tvdbid) {
    return handleRssFeed(ctx);
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
      results = await scraper.searchMovies(searchParams);
      break;
    case 'tvsearch':
      results = await scraper.searchSeries(searchParams);
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
      return categoryFilter.includes(category);
    });
  }

  // Process results (resolve dl-protect links, generate pubDate fallback)
  const items = await processResults(results);

  // Sort by date descending
  items.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dateB - dateA;
  });

  // Apply limit and offset
  const start = searchParams.offset || 0;
  const end = start + (searchParams.limit || 100);
  const paginatedItems = items.slice(start, end);

  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
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

  // Generate fake .torrent file containing the DDL link
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