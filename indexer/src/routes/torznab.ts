import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getScraper, isValidSite, getAvailableSites, contentTypeToCategory } from '../scrapers/index.js';
import { buildTorznabResponse, buildCapsResponse, buildErrorResponse } from '../utils/xml.js';
import { TorznabItem, TorznabCaps, TorznabCategory, SearchParams, ScraperResult } from '../models/torznab.js';
import { SiteType } from '../config.js';
import { generateFakeTorrent } from '../utils/torrent.js';
import { isDlProtectLink, resolveDlProtectLink } from '../utils/dlprotect.js';

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
    ],
  };
}

async function processResults(results: ScraperResult[]): Promise<TorznabItem[]> {
  const items: TorznabItem[] = [];

  for (const result of results) {
    // Resolve dl-protect links via Botasaurus service
    // Note: Debriding is now handled by the downloader service
    let link = result.link;
    if (isDlProtectLink(link)) {
      link = await resolveDlProtectLink(link);
    }

    items.push({
      title: result.title,
      guid: Buffer.from(result.link).toString('base64').slice(0, 40),
      link,
      comments: result.pageUrl,
      pubDate: result.pubDate,
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

  // Torznab API endpoint
  app.get<{
    Params: SiteParams;
    Querystring: TorznabQuerystring;
  }>('/api/:site', async (request: FastifyRequest<{ Params: SiteParams; Querystring: TorznabQuerystring }>, reply: FastifyReply) => {
    const { site } = request.params;
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
    if (!action || !['search', 'tvsearch', 'movie'].includes(action)) {
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

    // Build search params
    const searchParams: SearchParams = {
      q: searchQuery,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
      imdbid,
      tmdbid,
      tvdbid,
      season,
      ep,
      hoster,
      year: extractedYear,
    };

    // Si pas de query, retourne un résultat fictif (utile pour les tests de connexion Radarr/Sonarr)
    if (!searchParams.q && !imdbid && !tmdbid && !tvdbid) {
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

    try {
      let results: ScraperResult[] = [];

      switch (action) {
        case 'search':
          results = await scraper.search(searchParams);
          break;
        case 'movie':
          results = await scraper.searchMovies(searchParams);
          break;
        case 'tvsearch':
          results = await scraper.searchSeries(searchParams);
          break;
      }

      // Filter by category BEFORE resolving links (to avoid unnecessary work)
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
    } catch (error) {
      console.error(`Search error for ${site}:`, error);
      return buildErrorResponse(900, 'Internal server error');
    }
  });

  // Torznab API endpoint with hosters in path: /api/:site/:hosters
  app.get<{
    Params: SiteWithHostersParams;
    Querystring: TorznabQuerystring;
  }>('/api/:site/:hosters', async (request: FastifyRequest<{ Params: SiteWithHostersParams; Querystring: TorznabQuerystring }>, reply: FastifyReply) => {
    const { site, hosters } = request.params;
    const { t: action, q, cat, limit, offset, imdbid, tmdbid, tvdbid, season, ep, year } = request.query;

    console.log(`[Torznab] Request with hosters in path: site=${site}, hosters=${hosters}`);

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
    if (!action || !['search', 'tvsearch', 'movie'].includes(action)) {
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

    // Build search params - hosters from path
    const searchParams: SearchParams = {
      q: searchQuery,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
      imdbid,
      tmdbid,
      tvdbid,
      season,
      ep,
      hoster: hosters, // Hosters from path
      year: extractedYear,
    };

    // Si pas de query, retourne un résultat fictif (utile pour les tests de connexion Radarr/Sonarr)
    if (!searchParams.q && !imdbid && !tmdbid && !tvdbid) {
      console.log(`[Torznab] Empty search query - returning dummy result (connection test)`);
      const dummyItem: TorznabItem = {
        title: 'DDL Torznab Connection Test',
        guid: 'ddl-torznab-test',
        link: 'https://example.com/test',
        pubDate: new Date(),
        size: 1500000000,
        category: action === 'tvsearch' ? TorznabCategory.TVHD : TorznabCategory.MoviesHD,
        quality: '1080p',
        language: 'MULTI',
      };
      return buildTorznabResponse([dummyItem], scraper.name);
    }

    try {
      let results: ScraperResult[] = [];

      switch (action) {
        case 'search':
          results = await scraper.search(searchParams);
          break;
        case 'movie':
          results = await scraper.searchMovies(searchParams);
          break;
        case 'tvsearch':
          results = await scraper.searchSeries(searchParams);
          break;
      }

      // Filter by category BEFORE resolving links
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
    } catch (error) {
      console.error(`Search error for ${site}:`, error);
      return buildErrorResponse(900, 'Internal server error');
    }
  });
}
