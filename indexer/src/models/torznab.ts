export enum TorznabCategory {
  Movies = 2000,
  MoviesSD = 2030,
  MoviesHD = 2040,
  MoviesUHD = 2045,
  Movies3D = 2060,
  TV = 5000,
  TVSD = 5030,
  TVHD = 5040,
  TVUHD = 5045,
  Anime = 5070,
}

export interface TorznabItem {
  title: string;
  guid: string;
  link: string;
  comments?: string; // URL de la page source
  pubDate?: Date;
  size?: number;
  category: TorznabCategory;
  imdbId?: string;
  tmdbId?: string;
  tvdbId?: string;
  season?: number;
  episode?: number;
  quality?: string;
  language?: string;
  year?: number;
}

export interface TorznabCaps {
  server: {
    title: string;
  };
  limits: {
    default: number;
    max: number;
  };
  searching: {
    search: { available: boolean };
    tvsearch: { available: boolean };
    moviesearch: { available: boolean };
  };
  categories: Array<{
    id: number;
    name: string;
  }>;
}

export interface SearchParams {
  q?: string;
  limit?: number;
  offset?: number;
  imdbid?: string;
  tmdbid?: string;
  tvdbid?: string;
  season?: string;
  ep?: string;
  hoster?: string; // Liste d'hébergeurs séparés par des virgules (ex: "1fichier,rapidgator")
  year?: string; // Année de production (ex: "2006")
}

export type ContentType = 'movie' | 'series' | 'anime';

export interface ScraperResult {
  title: string;
  link: string;
  pageUrl?: string; // URL de la page source
  size?: number;
  quality?: string;
  language?: string;
  imdbId?: string;
  tmdbId?: string;
  season?: number;
  episode?: number;
  pubDate?: Date;
  contentType: ContentType;
  year?: number;
}
