import { config as dotenvConfig } from 'dotenv';
import { getSiteUrlFromTelegram, getDefaultTelegramChannel } from './utils/telegram.js';

dotenvConfig();

// Static config (read from env at startup)
export const config = {
  port: parseInt(process.env.PORT || '9117', 10),
  host: process.env.HOST || '0.0.0.0',

  // Site URLs from env (may be empty - will be resolved from Telegram)
  sites: {
    wawacity: process.env.WAWACITY_URL || '',
    zonetelecharger: process.env.ZONETELECHARGER_URL || '',
  },

  // Telegram channel URLs for dynamic URL resolution
  telegram: {
    wawacity: process.env.WAWACITY_TELEGRAM || getDefaultTelegramChannel('wawacity'),
    zonetelecharger: process.env.ZONETELECHARGER_TELEGRAM || getDefaultTelegramChannel('zonetelecharger'),
  },

  dlprotectServiceUrl: process.env.DLPROTECT_SERVICE_URL || 'http://localhost:5000',
  dlprotectResolveAt: (process.env.DLPROTECT_RESOLVE_AT || 'indexer') as 'indexer' | 'downloader',
  searchMaxPages: parseInt(process.env.SEARCH_MAX_PAGES || '5', 10),
  disableRemoteDlProtectCache: process.env.DISABLE_REMOTE_DL_PROTECT_CACHE === 'true',
} as const;

// Resolved site URLs (populated at initialization or from env)
const resolvedSiteUrls: Record<SiteType, string> = {
  wawacity: config.sites.wawacity,
  zonetelecharger: config.sites.zonetelecharger,
};

export type SiteType = 'wawacity' | 'zonetelecharger';

/**
 * Initialize site URLs - fetches from Telegram if not configured in env
 * Should be called at application startup
 */
export async function initializeSiteUrls(): Promise<void> {
  const sites: SiteType[] = ['wawacity', 'zonetelecharger'];

  for (const site of sites) {
    if (!config.sites[site]) {
      console.log(`[Config] ${site} URL not configured, fetching from Telegram...`);
      const url = await getSiteUrlFromTelegram(site, config.telegram[site]);
      if (url) {
        resolvedSiteUrls[site] = url;
        console.log(`[Config] ${site} URL resolved: ${url}`);
      } else {
        console.warn(`[Config] Could not resolve ${site} URL from Telegram`);
      }
    } else {
      console.log(`[Config] ${site} URL configured: ${config.sites[site]}`);
    }
  }
}

/**
 * Get site URL (resolved from env or Telegram)
 */
export function getSiteUrl(site: SiteType): string {
  return resolvedSiteUrls[site];
}

/**
 * Refresh site URLs from Telegram (for sites not configured via env)
 */
async function refreshSiteUrls(): Promise<void> {
  const sites: SiteType[] = ['wawacity', 'zonetelecharger'];

  for (const site of sites) {
    // Only refresh URLs that come from Telegram (not env vars)
    if (!config.sites[site]) {
      const url = await getSiteUrlFromTelegram(site, config.telegram[site]);
      if (url && url !== resolvedSiteUrls[site]) {
        console.log(`[Config] ${site} URL updated: ${resolvedSiteUrls[site]} -> ${url}`);
        resolvedSiteUrls[site] = url;
      }
    }
  }
}

// Refresh site URLs every hour
setInterval(() => {
  console.log('[Config] Refreshing site URLs from Telegram...');
  refreshSiteUrls().catch(err => console.error('[Config] Error refreshing URLs:', err));
}, 60 * 60 * 1000); // 1 hour

/**
 * Check if site is configured (has a URL either from env or resolved from Telegram)
 */
export function isSiteConfigured(site: SiteType): boolean {
  return Boolean(resolvedSiteUrls[site]);
}

export function isDlprotectServiceConfigured(): boolean {
  return Boolean(config.dlprotectServiceUrl);
}
