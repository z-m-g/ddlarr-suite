import { BaseScraper } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchJson } from '../utils/http.js';
import { isNameMatch } from '../utils/text.js';
import { getSearchQueriesFromImdb, normalizeImdbId } from '../utils/imdb.js';
import { config } from '../config.js';
import { buildLoadixLink, getLoadixSession, resolveLoadixLink } from '../utils/loadix.js';

/**
 * Loadix (loadix.fun) scraper.
 *
 * The site is a SPA, so nothing is scraped from HTML: everything goes through the public
 * JSON API (api.loadix.fun). Flow for a search:
 *   1. GET /api/media/search?q=&type=   -> catalog hits (TMDB-backed, with tmdbId)
 *   2. GET /api/media/{id}              -> imdbId (used to validate IMDB searches)
 *   3. GET /api/media/{id}/links        -> hoster links with quality/language/size
 *
 * Links are not exposed directly: revealing one needs an authenticated call, done either
 * here (LOADIX_RESOLVE_AT=indexer) or by the download services at grab time (default).
 * Until then the result link is an opaque pseudo URL (see utils/loadix.ts).
 */

type LoadixMediaType = 'movie' | 'series' | 'anime';

const CONTENT_TYPE_MAP: Partial<Record<ContentType, LoadixMediaType>> = {
  movie: 'movie',
  series: 'series',
  anime: 'anime',
};

interface LoadixSearchHit {
  id: string;
  type: string;
  title: string;
  originalTitle: string | null;
  titleAlt: string[] | null;
  year: number | null;
  tmdbId: number | null;
  hasLinks: boolean;
}

interface LoadixSearchResponse {
  hits: LoadixSearchHit[];
  estimatedTotalHits: number;
  page: number;
  hitsPerPage: number;
}

interface LoadixMediaDetail {
  media: {
    id: string;
    type: string;
    tmdbId: number | null;
    imdbId: string | null;
    title: string;
    originalTitle: string | null;
    year: number | null;
  };
}

interface LoadixLink {
  id: string;
  mediaId: string;
  scope: 'series' | 'season' | 'episode' | string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  provider: string;
  linkType: 'ddl_url' | 'nzb_file' | string;
  quality: string | null;
  language: string | null;
  sizeBytes: string | number | null;
  releaseName: string | null;
  releaseGroup: string | null;
  fileCount: number;
  status: string;
  addedAt: string;
}

interface LoadixLinksResponse {
  items: LoadixLink[];
  total: number;
  page: number;
  perPage: number;
}

interface MatchedMedia {
  hit: LoadixSearchHit;
  /** Title that matched the query (site title or original title) */
  matchedTitle: string;
}

const LINKS_PER_PAGE = 100;
const SEARCH_PAGE_SIZE = 20;
const REVEAL_CONCURRENCY = 3;

/**
 * Map Loadix quality labels to tags Radarr/Sonarr parse reliably.
 * Vocabulary comes from the site's own release-name parser (e.g. "HDLight 1080p (x265)",
 * "ULTRA HD (x265)", "REMUX UHD", "WEB 1080p", "Blu-Ray 1080p", "DVDRIP MKV").
 */
export function normalizeLoadixQuality(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const q = raw.trim();
  const upper = q.toUpperCase();
  const x265 = /X265|HEVC/.test(upper) ? '.x265' : '';
  const resMatch = upper.match(/\b(2160|1080|720|480)P?\b/);
  const res = resMatch ? `${resMatch[1]}p` : '';

  if (/ISO 4K/.test(upper)) return '2160p.BluRay.ISO';
  if (/FULL ISO/.test(upper)) return '1080p.BluRay.ISO';
  if (/REMUX UHD/.test(upper)) return '2160p.BluRay.REMUX';
  if (/REMUX DVD/.test(upper)) return 'DVD.REMUX';
  if (/REMUX/.test(upper)) return '1080p.BluRay.REMUX';
  if (/^(CAM|TS|TC|DVDSCR|R5)$/.test(upper)) return upper;
  if (/ULTRA HDLIGHT/.test(upper)) return '2160p.HDLight.x265';
  if (/HDLIGHT/.test(upper)) return `${res || '1080p'}.HDLight${x265}`;
  if (/BDRIP/.test(upper)) return 'BDRip';
  if (/BRRIP/.test(upper)) return 'BRRip';
  if (/BLU-?RAY 3D/.test(upper)) return '1080p.BluRay.3D';
  if (/4K HDR/.test(upper)) return '2160p.HDR';
  if (/ULTRA HD/.test(upper)) return `2160p${x265 || '.x265'}`;
  if (/^UHD$/.test(upper)) return '2160p.BluRay';
  if (/BLU-?RAY/.test(upper)) return `${res || '1080p'}.BluRay${x265}`;
  if (/WEBRIP/.test(upper)) return `${res ? `${res}.` : ''}WEBRip`;
  if (/^4K$/.test(upper)) return '2160p.WEB-DL';
  if (/^WEB/.test(upper)) return `${res ? `${res}.` : ''}WEB-DL${x265}`;
  if (/HDTV/.test(upper)) return `${res ? `${res}.` : ''}HDTV`;
  if (/HDRIP/.test(upper)) return 'HDRip';
  if (/DVDRIP/.test(upper)) return 'DVDRip';
  if (/DVD-?R$/.test(upper)) return 'DVD-R';
  if (/TVRIP/.test(upper)) return 'TVRip';
  if (/^HD \d+P$/.test(upper) && res) return res;

  // Unknown label: keep it, dotted, without parentheses
  return q.replace(/[()]/g, '').trim().replace(/\s+/g, '.');
}

export function normalizeLoadixLanguage(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const lang = raw.trim().replace(/\+/g, ' ').replace(/\s+/g, '.');
  return lang.replace(/multi/i, 'MULTI') || undefined;
}

/**
 * Build the release name: Title.Year.S01E05.Quality.Language.Provider
 */
function cleanTitleForRelease(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '.');
}

export class LoadixScraper implements BaseScraper {
  readonly name = 'Loadix';

  constructor(public readonly baseUrl: string) {}

  private get apiUrl(): string {
    return config.loadix.apiUrl;
  }

  async search(params: SearchParams): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];
    const settled = await Promise.allSettled([
      this.searchMovies(params),
      this.searchSeries(params),
      this.searchAnime(params),
    ]);
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
    return results;
  }

  async searchMovies(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'movie');
  }

  async searchSeries(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'series');
  }

  async searchAnime(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'anime');
  }

  private async searchByType(params: SearchParams, contentType: ContentType): Promise<ScraperResult[]> {
    const mediaType = CONTENT_TYPE_MAP[contentType];
    if (!mediaType) return [];
    if (!params.q && !params.imdbid) return [];

    let searchQueries: string[];
    if (params.imdbid) {
      console.log(`[Loadix] IMDB ID provided: ${params.imdbid}`);
      searchQueries = await getSearchQueriesFromImdb(params.imdbid, params.q);
    } else {
      searchQueries = params.q ? [params.q] : [];
    }

    if (searchQueries.length === 0) {
      console.log('[Loadix] No search queries available');
      return [];
    }

    console.log(`[Loadix] Search queries for "${params.q || params.imdbid}" (${mediaType}):`, searchQueries);

    try {
      const matched = await this.searchCatalog(searchQueries, mediaType, contentType, params);
      if (matched.length === 0) {
        console.log(`[Loadix] No matching media for ${contentType}`);
        return [];
      }

      const toVisit = matched.slice(0, config.loadix.maxMedia);
      console.log(`[Loadix] ${matched.length} matching media, fetching links for ${toVisit.length}`);

      const perMedia = await Promise.all(
        toVisit.map(async (media) => {
          try {
            return await this.collectMediaLinks(media, contentType, params);
          } catch (error) {
            console.error(`[Loadix] Error fetching links for media ${media.hit.id}:`, error);
            return [];
          }
        }),
      );

      let results = perMedia.flat();
      console.log(`[Loadix] ${results.length} links collected for ${contentType}`);

      if (config.loadix.resolveAt === 'indexer' && results.length > 0) {
        results = await this.revealAll(results);
      }

      return results;
    } catch (error) {
      console.error(`[Loadix] Search error for ${contentType}:`, error);
      return [];
    }
  }

  /**
   * Query the catalog for every search term and keep the media that match the query
   * (name similarity, year, tmdb id).
   */
  private async searchCatalog(
    queries: string[],
    mediaType: LoadixMediaType,
    contentType: ContentType,
    params: SearchParams,
  ): Promise<MatchedMedia[]> {
    const matched: MatchedMedia[] = [];
    const seen = new Set<string>();

    const perQuery = await Promise.all(
      queries.map(async (query) => {
        const url = this.buildSearchUrl(query, mediaType);
        console.log(`[Loadix] Searching ${mediaType}: ${url}`);
        try {
          const data = await fetchJson<LoadixSearchResponse>(url, { headers: this.apiHeaders() });
          return { query, hits: data.hits || [] };
        } catch (error) {
          console.error(`[Loadix] Search request failed for "${query}":`, error);
          return { query, hits: [] as LoadixSearchHit[] };
        }
      }),
    );

    for (const { query, hits } of perQuery) {
      for (const hit of hits) {
        if (seen.has(hit.id)) continue;
        const matchedTitle = this.matchHit(hit, query, contentType, params);
        if (!matchedTitle) continue;
        seen.add(hit.id);
        matched.push({ hit, matchedTitle });
      }
    }

    return matched;
  }

  private buildSearchUrl(query: string, mediaType: LoadixMediaType): string {
    const search = new URLSearchParams({ q: query, type: mediaType });
    search.set('has_links', 'true');
    search.set('pageSize', String(SEARCH_PAGE_SIZE));
    return `${this.apiUrl}/api/media/search?${search.toString()}`;
  }

  /**
   * Returns the title that matched, or null when the hit must be skipped
   */
  private matchHit(hit: LoadixSearchHit, query: string, contentType: ContentType, params: SearchParams): string | null {
    if (hit.hasLinks === false) return null;

    // Strong signal when Radarr/Sonarr sent a TMDB id and the catalog knows it
    if (params.tmdbid && hit.tmdbId !== null && hit.tmdbId !== undefined) {
      if (String(hit.tmdbId) !== String(params.tmdbid)) {
        return null;
      }
      return hit.title;
    }

    const candidates = [hit.title, hit.originalTitle, ...(hit.titleAlt || [])].filter((t): t is string => Boolean(t));
    const matchedTitle = candidates.find(title => isNameMatch(query, title, contentType, '[Loadix]'));
    if (!matchedTitle) {
      console.log(`[Loadix] Skipping "${hit.title}" - no title close to "${query}"`);
      return null;
    }

    if (params.year && hit.year && contentType === 'movie') {
      const wanted = parseInt(params.year, 10);
      if (Math.abs(hit.year - wanted) > 1) {
        console.log(`[Loadix] Skipping "${hit.title}" - year ${hit.year} != ${wanted}`);
        return null;
      }
    }

    return matchedTitle;
  }

  private async collectMediaLinks(media: MatchedMedia, contentType: ContentType, params: SearchParams): Promise<ScraperResult[]> {
    const { hit } = media;
    const pageUrl = `${this.baseUrl.replace(/\/+$/, '')}/media/${hit.id}`;

    // Media detail gives the IMDB id: decisive for IMDB-based searches
    let imdbId: string | undefined;
    try {
      const detail = await fetchJson<LoadixMediaDetail>(`${this.apiUrl}/api/media/${hit.id}`, { headers: this.apiHeaders() });
      imdbId = detail.media?.imdbId || undefined;
    } catch (error) {
      console.warn(`[Loadix] Could not fetch detail for ${hit.id}:`, error);
    }

    if (params.imdbid && imdbId) {
      if (normalizeImdbId(imdbId) !== normalizeImdbId(params.imdbid)) {
        console.log(`[Loadix] Skipping "${hit.title}" - IMDB ${imdbId} != ${params.imdbid}`);
        return [];
      }
      console.log(`[Loadix] IMDB match for "${hit.title}": ${imdbId}`);
    }

    const links = await this.fetchAllLinks(hit.id);
    console.log(`[Loadix] "${hit.title}": ${links.length} links on site`);

    const allowedHosters = params.hoster
      ? params.hoster.toLowerCase().split(',').map(h => h.trim()).filter(Boolean)
      : null;
    const wantedSeason = params.season ? parseInt(params.season, 10) : undefined;
    const wantedEpisode = params.ep ? parseInt(params.ep, 10) : undefined;

    const results: ScraperResult[] = [];
    const providersSeen = new Map<string, number>();
    let droppedByHoster = 0;

    for (const link of links) {
      if (link.status && link.status !== 'validated') continue;
      if (link.linkType && link.linkType !== 'ddl_url') continue; // NZB not supported

      const provider = (link.provider || '').toLowerCase();
      providersSeen.set(provider || '?', (providersSeen.get(provider || '?') || 0) + 1);
      if (allowedHosters && !allowedHosters.some(h => provider.includes(h) || h.includes(provider))) {
        droppedByHoster++;
        continue;
      }

      const season = link.seasonNumber ?? undefined;
      const episode = link.episodeNumber ?? undefined;

      if (contentType !== 'movie') {
        if (wantedSeason !== undefined) {
          // Complete-series packs (no season) do not answer a season search
          if (season === undefined || season !== wantedSeason) continue;
        }
        if (wantedEpisode !== undefined && episode !== undefined && episode !== wantedEpisode) {
          continue;
        }
      }

      const size = link.sizeBytes !== null && link.sizeBytes !== undefined ? Number(link.sizeBytes) : undefined;
      const quality = normalizeLoadixQuality(link.quality);
      const language = normalizeLoadixLanguage(link.language);

      const parts: string[] = [cleanTitleForRelease(media.matchedTitle)];
      if (contentType === 'movie' && hit.year) {
        parts.push(String(hit.year));
      }
      if (season !== undefined) {
        parts.push(`S${String(season).padStart(2, '0')}${episode !== undefined ? `E${String(episode).padStart(2, '0')}` : ''}`);
      }
      if (quality) parts.push(quality);
      if (language) parts.push(language);
      if (link.provider) parts.push(link.provider.replace(/\s+/g, '.'));

      results.push({
        title: parts.join('.'),
        link: buildLoadixLink(this.apiUrl, link.id),
        pageUrl,
        size: size && size > 0 ? Math.round(size) : undefined,
        quality,
        language,
        imdbId,
        tmdbId: hit.tmdbId !== null && hit.tmdbId !== undefined ? String(hit.tmdbId) : undefined,
        season,
        episode,
        contentType,
        pubDate: link.addedAt ? new Date(link.addedAt) : new Date(),
        year: hit.year ?? undefined,
      });
    }

    console.log(`[Loadix] "${hit.title}": ${results.length} links kept after filters`);
    if (results.length === 0 && droppedByHoster > 0) {
      const seen = Array.from(providersSeen.entries()).map(([p, n]) => `${p} x${n}`).join(', ');
      console.warn(`[Loadix] "${hit.title}": all ${droppedByHoster} links dropped by the hoster filter (${params.hoster}) - providers on site: ${seen}`);
    }
    return results;
  }

  private async fetchAllLinks(mediaId: string): Promise<LoadixLink[]> {
    const items: LoadixLink[] = [];
    const maxPages = Math.max(1, config.searchMaxPages);

    for (let page = 1; page <= maxPages; page++) {
      const url = `${this.apiUrl}/api/media/${mediaId}/links?page=${page}&perPage=${LINKS_PER_PAGE}`;
      const data = await fetchJson<LoadixLinksResponse>(url, { headers: this.apiHeaders() });
      items.push(...(data.items || []));
      if (!data.items || data.items.length < LINKS_PER_PAGE || items.length >= (data.total || 0)) {
        break;
      }
    }

    return items;
  }

  /**
   * LOADIX_RESOLVE_AT=indexer: swap pseudo links for real hoster URLs at search time
   */
  private async revealAll(results: ScraperResult[]): Promise<ScraperResult[]> {
    const session = getLoadixSession();
    if (!session.isConfigured()) {
      console.warn('[Loadix] LOADIX_RESOLVE_AT=indexer but no session configured - returning unresolved links');
      return results;
    }

    const queue = [...results];
    const workers = Array.from({ length: Math.min(REVEAL_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const result = queue.shift() as ScraperResult;
        try {
          result.link = await resolveLoadixLink(result.link);
        } catch (error) {
          console.error(`[Loadix] Reveal failed for "${result.title}": ${(error as Error).message}`);
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  private apiHeaders(): Record<string, string> {
    const site = this.baseUrl.replace(/\/+$/, '');
    return {
      'Accept': 'application/json',
      'Origin': site,
      'Referer': `${site}/`,
    };
  }
}
