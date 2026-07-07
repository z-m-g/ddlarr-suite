import { config as dotenvConfig } from 'dotenv';
import { getSiteUrlFromTelegram, getDefaultTelegramChannel } from './utils/telegram.js';
import { getUrlAfterRedirect } from './utils/http.js';

dotenvConfig();

// Static config (read from env at startup)
export const config = {
  port: parseInt(process.env.PORT || '9117', 10),
  host: process.env.HOST || '0.0.0.0',

  // Site URLs from env (may be empty - will be resolved dynamically)
  sites: {
    wawacity: process.env.WAWACITY_URL || '',
    zonetelecharger: process.env.ZONETELECHARGER_URL || '',
    darkiworld: process.env.DARKIWORLD_URL || '',
    bookys: process.env.BOOKYS_URL || '',
  },

  // Telegram channel URLs for dynamic URL resolution
  telegram: {
    wawacity: process.env.WAWACITY_TELEGRAM || getDefaultTelegramChannel('wawacity'),
    zonetelecharger: process.env.ZONETELECHARGER_TELEGRAM || getDefaultTelegramChannel('zonetelecharger'),
  },

  flaresolverrUrl: process.env.FLARESOLVERR_URL || '',
  dlprotectServiceUrl: process.env.DLPROTECT_SERVICE_URL || 'http://localhost:5000',
  dlprotectResolveAt: (process.env.DLPROTECT_RESOLVE_AT || 'indexer') as 'indexer' | 'downloader',
  darkiworldServiceUrl: process.env.DARKIWORLD_SERVICE_URL || 'http://localhost:5002',
  searchMaxPages: parseInt(process.env.SEARCH_MAX_PAGES || '5', 10),
  disableRemoteDlProtectCache: process.env.DISABLE_REMOTE_DL_PROTECT_CACHE === 'true',
  bookysHoster: process.env.BOOKYS_HOSTER || '1fichier',
} as const;

// Resolved site URLs (populated at initialization or from env)
const resolvedSiteUrls: Record<SiteType, string> = {
  wawacity: config.sites.wawacity,
  zonetelecharger: config.sites.zonetelecharger,
  darkiworld: config.sites.darkiworld,
  'darkiworld-premium': config.darkiworldServiceUrl,
  bookys: config.sites.bookys,
};

export type SiteType = 'wawacity' | 'zonetelecharger' | 'darkiworld' | 'darkiworld-premium' | 'bookys';

// Sites that use Telegram for URL resolution (excludes darkiworld-premium which is a service)
type TelegramSiteType = 'wawacity' | 'zonetelecharger';

/**
 * Initialize site URLs - fetches from Telegram or redirect if not configured in env
 * Should be called at application startup
 */
export async function initializeSiteUrls(): Promise<void> {
  const sites: TelegramSiteType[] = ['wawacity', 'zonetelecharger'];

  for (const site of sites) {
    if (config.sites[site]) {
      console.log(`[Config] ${site} URL configured (fallback): ${config.sites[site]}`);
    }
    console.log(`[Config] Fetching ${site} URL from Telegram...`);
    const url = await getSiteUrlFromTelegram(site, config.telegram[site]);
    if (url) {
      resolvedSiteUrls[site] = url;
      console.log(`[Config] ${site} URL resolved from Telegram: ${url}`);
    } else if (config.sites[site]) {
      console.warn(`[Config] Telegram resolution failed for ${site}, using env fallback: ${config.sites[site]}`);
    } else {
      console.warn(`[Config] Could not resolve ${site} URL from Telegram and no env fallback`);
    }
  }

  // Darkiworld URL resolution from redirect
  if (!config.sites.darkiworld) {
    console.log(`[Config] darkiworld URL not configured, fetching from redirect...`);
    const url = await getUrlAfterRedirect('https://darkiworld.com/');
    if (url) {
      resolvedSiteUrls.darkiworld = url;
      console.log(`[Config] darkiworld URL resolved: ${url}`);
    } else {
      console.warn(`[Config] Could not resolve darkiworld URL from redirect`);
    }
  } else {
    console.log(`[Config] darkiworld URL configured: ${config.sites.darkiworld}`);
  }

  // Darkiworld Premium is a service URL, always configured from env
  console.log(`[Config] darkiworld-premium service URL: ${config.darkiworldServiceUrl}`);
}

/**
 * Get the last resolved site URL synchronously (from env or the latest resolution).
 * Prefer resolveSiteUrl() on the request path to get a fresh value.
 */
export function getSiteUrl(site: SiteType): string {
  return resolvedSiteUrls[site];
}

// Dedup concurrent resolutions so a burst of requests triggers a single Telegram fetch per site
const inflightResolutions: Partial<Record<SiteType, Promise<string>>> = {};

/**
 * Resolve the current URL for a site, re-checking the source on every call (no time-based cache).
 *
 * - If the URL is pinned via an env var, it always wins (no network call).
 * - Otherwise (wawacity/zonetelecharger) the domain is re-checked on Telegram every time.
 *   If Telegram is unreachable, we fall back to the last known value (resolvedSiteUrls).
 * - Other sites keep their statically resolved value (env / service / redirect resolved at boot).
 */
export async function resolveSiteUrl(site: SiteType): Promise<string> {
  // Non-Telegram sites: static value resolved at boot / from env
  if (site !== 'wawacity' && site !== 'zonetelecharger') {
    return resolvedSiteUrls[site];
  }

  // Pinned via env var => absolute priority, no network call
  if (config.sites[site]) {
    return config.sites[site];
  }

  // Reuse an in-flight resolution if one is already running for this site
  const existing = inflightResolutions[site];
  if (existing) {
    return existing;
  }

  const resolution = (async (): Promise<string> => {
    const url = await getSiteUrlFromTelegram(site, config.telegram[site]);
    if (url) {
      if (url !== resolvedSiteUrls[site]) {
        console.log(`[Config] ${site} URL updated: ${resolvedSiteUrls[site] || '(none)'} -> ${url}`);
      }
      resolvedSiteUrls[site] = url; // remember as fallback for next time
      return url;
    }
    // Telegram unreachable => keep serving the last known URL
    console.warn(`[Config] Telegram unavailable for ${site}, using last known URL: ${resolvedSiteUrls[site] || '(none)'}`);
    return resolvedSiteUrls[site];
  })();

  inflightResolutions[site] = resolution;
  try {
    return await resolution;
  } finally {
    delete inflightResolutions[site];
  }
}

/**
 * Proactively refresh site URLs in the background so the fallback stays fresh even without traffic.
 * (The request path already re-resolves on every call via resolveSiteUrl.)
 */
async function refreshSiteUrls(): Promise<void> {
  const sites: TelegramSiteType[] = ['wawacity', 'zonetelecharger'];
  await Promise.all(sites.map(site => resolveSiteUrl(site).catch(() => undefined)));

  // Refresh darkiworld URL from redirect (not env vars)
  if (!config.sites.darkiworld) {
    const url = await getUrlAfterRedirect('https://darkiworld.com/');
    if (url && url !== resolvedSiteUrls.darkiworld) {
      console.log(`[Config] darkiworld URL updated: ${resolvedSiteUrls.darkiworld} -> ${url}`);
      resolvedSiteUrls.darkiworld = url;
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
