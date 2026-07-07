import type { BaseScraper } from './base.js';
import { contentTypeToCategory } from './base.js';
import { WawacityScraper } from './wawacity.js';
import { ZoneTelechargerScraper } from './zonetelecharger.js';
import { DarkiworldPremiumScraper } from './darkiworld.js';
import { BookysScraper } from './bookys.js';
import { SiteType, isSiteConfigured, resolveSiteUrl } from '../config.js';

export type { BaseScraper } from './base.js';
export { contentTypeToCategory } from './base.js';

const scraperCache = new Map<SiteType, BaseScraper>();

export async function getScraper(site: SiteType): Promise<BaseScraper | null> {
  // Resolve the current URL on every call (fresh from Telegram for wawacity/zt).
  const url = await resolveSiteUrl(site);
  if (!url) {
    return null;
  }

  // Reuse the cached instance only if it still points at the current URL,
  // otherwise rebuild it so a domain change takes effect immediately.
  const cached = scraperCache.get(site);
  if (cached && cached.baseUrl === url) {
    return cached;
  }

  let scraper: BaseScraper;

  switch (site) {
    case 'wawacity':
      scraper = new WawacityScraper(url);
      break;
    case 'zonetelecharger':
      scraper = new ZoneTelechargerScraper(url);
      break;
    case 'darkiworld-premium':
      scraper = new DarkiworldPremiumScraper(url);
      break;
    case 'bookys':
      scraper = new BookysScraper(url);
      break;
    default:
      return null;
  }

  scraperCache.set(site, scraper);
  return scraper;
}

export function getAvailableSites(): SiteType[] {
  const sites: SiteType[] = ['wawacity', 'zonetelecharger', 'darkiworld-premium', 'bookys'];
  return sites.filter((site) => isSiteConfigured(site));
}

export function isValidSite(site: string): site is SiteType {
  return ['wawacity', 'zonetelecharger', 'darkiworld-premium', 'bookys'].includes(site);
}