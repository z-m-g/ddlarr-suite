import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';

export interface BaseScraper {
  readonly name: string;
  readonly baseUrl: string;

  search(params: SearchParams): Promise<ScraperResult[]>;
  searchMovies(params: SearchParams): Promise<ScraperResult[]>;
  searchSeries(params: SearchParams): Promise<ScraperResult[]>;
  searchAnime?(params: SearchParams): Promise<ScraperResult[]>;
}

export function parseQuality(title: string): string | undefined {
  const qualityPatterns = [
    /\b(2160p|4K|UHD)\b/i,
    /\b(1080p|FHD)\b/i,
    /\b(720p|HD)\b/i,
    /\b(480p|SD)\b/i,
    /\b(HDTV)\b/i,
    /\b(WEB-?DL|WEBDL)\b/i,
    /\b(WEBRip)\b/i,
    /\b(BluRay|BDRip|BRRip)\b/i,
    /\b(DVDRip)\b/i,
    /\b(HDCAM|CAM|TS|TC)\b/i,
  ];

  for (const pattern of qualityPatterns) {
    const match = title.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return undefined;
}

export function parseLanguage(title: string): string | undefined {
  const langPatterns = [
    { pattern: /\b(FRENCH|VFF|VFI|VF2|TRUEFRENCH)\b/i, lang: 'French' },
    { pattern: /\b(MULTI)\b/i, lang: 'Multi' },
    { pattern: /\b(VOSTFR|SUBFRENCH)\b/i, lang: 'VOSTFR' },
    { pattern: /\b(ENGLISH|ENG)\b/i, lang: 'English' },
  ];

  for (const { pattern, lang } of langPatterns) {
    if (pattern.test(title)) {
      return lang;
    }
  }
  return undefined;
}

export function parseSeasonEpisode(title: string): { season?: number; episode?: number } {
  const seMatch = title.match(/S(\d{1,2})E(\d{1,3})/i);
  if (seMatch) {
    return {
      season: parseInt(seMatch[1], 10),
      episode: parseInt(seMatch[2], 10),
    };
  }

  const seasonMatch = title.match(/Saison\s*(\d{1,2})/i);
  if (seasonMatch) {
    return { season: parseInt(seasonMatch[1], 10) };
  }

  return {};
}

export function parseSize(sizeStr: string): number | undefined {
  const match = sizeStr.match(/([\d.,]+)\s*(Go|Gb|Mo|Mb|Ko|Kb|To|Tb)/i);
  if (!match) return undefined;

  const value = parseFloat(match[1].replace(',', '.'));
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    'ko': 1024,
    'kb': 1024,
    'mo': 1024 * 1024,
    'mb': 1024 * 1024,
    'go': 1024 * 1024 * 1024,
    'gb': 1024 * 1024 * 1024,
    'to': 1024 * 1024 * 1024 * 1024,
    'tb': 1024 * 1024 * 1024 * 1024,
  };

  return Math.round(value * (multipliers[unit] || 1));
}

export function contentTypeToCategory(contentType: ContentType, quality?: string): number {
  if (contentType === 'anime') {
    return 5070;
  }

  const isHD = quality && /1080p|720p|HD|FHD|HDLight/i.test(quality);
  const isUHD = quality && /2160p|4K|UHD/i.test(quality);

  if (contentType === 'movie') {
    if (isUHD) return 2045;
    if (isHD) return 2040;
    return 2000;
  }

  if (contentType === 'series') {
    if (isUHD) return 5045;
    if (isHD) return 5040;
    return 5000;
  }

  return 2000;
}
