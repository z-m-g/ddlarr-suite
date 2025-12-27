/**
 * DarkiWorld Scraper - DISABLED
 * This scraper is not fully implemented and is disabled.
 * To re-enable, uncomment darkiworld in config.ts and scrapers/index.ts
 */
import { BaseScraper, parseQuality, parseLanguage, parseSeasonEpisode } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchJson } from '../utils/http.js';
// import { config } from '../config.js';

interface DarkiSearchResult {
  id: string;
  title: string;
  type: string;
  year?: number;
  quality?: string;
  size?: number;
  language?: string;
  imdb_id?: string;
  tmdb_id?: string;
  links?: DarkiLink[];
}

interface DarkiLink {
  host: string;
  url: string;
  quality?: string;
  size?: number;
}

interface DarkiApiResponse {
  success: boolean;
  results?: DarkiSearchResult[];
  error?: string;
}

export class DarkiworldScraper implements BaseScraper {
  readonly name = 'DarkiWorld';

  constructor(public readonly baseUrl: string) {}

  private get apiKey(): string {
    // return config.darkiworldApiKey; // Disabled
    return '';
  }

  private async apiRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const searchParams = new URLSearchParams(params);
    if (this.apiKey) {
      searchParams.set('apikey', this.apiKey);
    }

    const url = `${this.baseUrl}${endpoint}?${searchParams.toString()}`;
    return fetchJson<T>(url);
  }

  async search(params: SearchParams): Promise<ScraperResult[]> {
    if (!params.q) return [];

    try {
      const response = await this.apiRequest<DarkiApiResponse>('/search', {
        q: params.q,
        type: 'all',
      });

      if (!response.success || !response.results) {
        return [];
      }

      return response.results.map((item) => this.mapToScraperResult(item));
    } catch (error) {
      console.error('DarkiWorld search error:', error);
      return [];
    }
  }

  async searchMovies(params: SearchParams): Promise<ScraperResult[]> {
    if (!params.q) return [];

    try {
      const searchParams: Record<string, string> = {
        q: params.q,
        type: 'movie',
      };

      if (params.imdbid) {
        searchParams.imdb = params.imdbid;
      }
      if (params.tmdbid) {
        searchParams.tmdb = params.tmdbid;
      }

      const response = await this.apiRequest<DarkiApiResponse>('/search', searchParams);

      if (!response.success || !response.results) {
        return [];
      }

      return response.results
        .filter((item) => item.type === 'movie')
        .map((item) => this.mapToScraperResult(item, 'movie'));
    } catch (error) {
      console.error('DarkiWorld movie search error:', error);
      return [];
    }
  }

  async searchSeries(params: SearchParams): Promise<ScraperResult[]> {
    if (!params.q) return [];

    try {
      const searchParams: Record<string, string> = {
        q: params.q,
        type: 'series',
      };

      if (params.tvdbid) {
        searchParams.tvdb = params.tvdbid;
      }
      if (params.season) {
        searchParams.season = params.season;
      }
      if (params.ep) {
        searchParams.episode = params.ep;
      }

      const response = await this.apiRequest<DarkiApiResponse>('/search', searchParams);

      if (!response.success || !response.results) {
        return [];
      }

      return response.results
        .filter((item) => item.type === 'series')
        .map((item) => this.mapToScraperResult(item, 'series'));
    } catch (error) {
      console.error('DarkiWorld series search error:', error);
      return [];
    }
  }

  async searchAnime(params: SearchParams): Promise<ScraperResult[]> {
    if (!params.q) return [];

    try {
      const response = await this.apiRequest<DarkiApiResponse>('/search', {
        q: params.q,
        type: 'anime',
      });

      if (!response.success || !response.results) {
        return [];
      }

      return response.results
        .filter((item) => item.type === 'anime')
        .map((item) => this.mapToScraperResult(item, 'anime'));
    } catch (error) {
      console.error('DarkiWorld anime search error:', error);
      return [];
    }
  }

  private mapToScraperResult(item: DarkiSearchResult, forcedType?: ContentType): ScraperResult {
    const contentType: ContentType = forcedType || this.mapContentType(item.type);
    const { season, episode } = parseSeasonEpisode(item.title);

    // Get the best link (prefer highest quality)
    const bestLink = item.links?.[0]?.url || '';

    return {
      title: item.title,
      link: bestLink,
      size: item.size || item.links?.[0]?.size,
      quality: item.quality || parseQuality(item.title),
      language: item.language || parseLanguage(item.title),
      imdbId: item.imdb_id,
      tmdbId: item.tmdb_id ? String(item.tmdb_id) : undefined,
      season,
      episode,
      contentType,
      pubDate: new Date(),
    };
  }

  private mapContentType(type: string): ContentType {
    switch (type.toLowerCase()) {
      case 'movie':
      case 'film':
        return 'movie';
      case 'series':
      case 'tv':
      case 'show':
        return 'series';
      case 'anime':
        return 'anime';
      default:
        return 'movie';
    }
  }
}
