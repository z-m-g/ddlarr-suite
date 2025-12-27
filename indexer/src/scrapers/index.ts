import type { BaseScraper } from './base.js';
import { contentTypeToCategory } from './base.js';
import { WawacityScraper } from './wawacity.js';
import { ZoneTelechargerScraper } from './zonetelecharger.js';
// import { DarkiworldScraper } from './darkiworld.js'; // Disabled - not fully implemented
import { SiteType, isSiteConfigured, getSiteUrl } from '../config.js';

export type { BaseScraper } from './base.js';
export { contentTypeToCategory } from './base.js';

const scraperCache = new Map<SiteType, BaseScraper>();

export function getScraper(site: SiteType): BaseScraper | null {
  if (!isSiteConfigured(site)) {
    return null;
  }

  if (scraperCache.has(site)) {
    return scraperCache.get(site)!;
  }

  const url = getSiteUrl(site);
  let scraper: BaseScraper;

  switch (site) {
    case 'wawacity':
      scraper = new WawacityScraper(url);
      break;
    case 'zonetelecharger':
      scraper = new ZoneTelechargerScraper(url);
      break;
    // case 'darkiworld': // Disabled - not fully implemented
    //   scraper = new DarkiworldScraper(url);
    //   break;
    default:
      return null;
  }

  scraperCache.set(site, scraper);
  return scraper;
}

export function getAvailableSites(): SiteType[] {
  const sites: SiteType[] = ['wawacity', 'zonetelecharger'];
  return sites.filter((site) => isSiteConfigured(site));
}

export function isValidSite(site: string): site is SiteType {
  return ['wawacity', 'zonetelecharger'].includes(site);
}
