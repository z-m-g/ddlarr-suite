import { fetchHtml } from './http.js';

// Default Telegram channel URLs
const DEFAULT_TELEGRAM_CHANNELS = {
  wawacity: 'https://t.me/s/Wawacityofficiel',
  zonetelecharger: 'https://t.me/s/ztofficiel',
};

// Cache for fetched URLs (to avoid fetching on every request)
const urlCache: Record<string, { url: string; fetchedAt: number }> = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Extract site URL from Telegram channel page
 * The URL is in the og:title meta tag, e.g.: <meta property="og:title" content="Wawacity.irish">
 */
export async function fetchSiteUrlFromTelegram(telegramUrl: string, siteName: string): Promise<string | null> {
  try {
    console.log(`[Telegram] Fetching site URL for ${siteName} from ${telegramUrl}`);

    const html = await fetchHtml(telegramUrl);

    // Extract og:title content
    const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);

    if (!ogTitleMatch) {
      console.error(`[Telegram] Could not find og:title in Telegram page for ${siteName}`);
      return null;
    }

    const domain = ogTitleMatch[1].trim();

    // Validate it looks like a domain
    if (!domain.includes('.')) {
      console.error(`[Telegram] Invalid domain found for ${siteName}: ${domain}`);
      return null;
    }

    // Build full URL
    const siteUrl = `https://www.${domain.toLowerCase()}/`;
    console.log(`[Telegram] Found URL for ${siteName}: ${siteUrl}`);

    return siteUrl;
  } catch (error) {
    console.error(`[Telegram] Error fetching URL for ${siteName}:`, error);
    return null;
  }
}

/**
 * Get site URL from Telegram channel with caching
 */
export async function getSiteUrlFromTelegram(
  site: 'wawacity' | 'zonetelecharger',
  telegramUrl?: string
): Promise<string | null> {
  const cacheKey = site;
  const now = Date.now();

  // Check cache first
  const cached = urlCache[cacheKey];
  if (cached && (now - cached.fetchedAt) < CACHE_TTL) {
    console.log(`[Telegram] Using cached URL for ${site}: ${cached.url}`);
    return cached.url;
  }

  // Fetch from Telegram
  const channelUrl = telegramUrl || DEFAULT_TELEGRAM_CHANNELS[site];
  const siteUrl = await fetchSiteUrlFromTelegram(channelUrl, site);

  if (siteUrl) {
    // Cache the result
    urlCache[cacheKey] = { url: siteUrl, fetchedAt: now };
  }

  return siteUrl;
}

/**
 * Get default Telegram channel URL for a site
 */
export function getDefaultTelegramChannel(site: 'wawacity' | 'zonetelecharger'): string {
  return DEFAULT_TELEGRAM_CHANNELS[site];
}
