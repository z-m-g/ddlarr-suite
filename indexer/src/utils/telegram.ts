import { fetchHtml } from './http.js';

// Default Telegram channel URLs
const DEFAULT_TELEGRAM_CHANNELS = {
  wawacity: 'https://t.me/Wawacityofficiel',
  zonetelecharger: 'https://t.me/ztofficiel',
};

// Timeout court pour la résolution: on résout à chaque requête, donc on préfère
// retomber vite sur la dernière valeur connue plutôt que d'attendre si Telegram traîne.
const TELEGRAM_FETCH_TIMEOUT = 5000;

/**
 * Extract site URL from Telegram channel page
 * The URL is in the og:title meta tag, e.g.: <meta property="og:title" content="Wawacity.irish">
 * Always performs a fresh fetch (no cache): the caller keeps the last known value as fallback.
 */
export async function fetchSiteUrlFromTelegram(telegramUrl: string, siteName: string): Promise<string | null> {
  try {
    console.log(`[Telegram] Fetching site URL for ${siteName} from ${telegramUrl}`);

    const html = await fetchHtml(telegramUrl, { timeout: TELEGRAM_FETCH_TIMEOUT }, true);

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
 * Get site URL from Telegram channel.
 * Always fresh: caching / fallback is handled by the caller (resolveSiteUrl in config).
 */
export async function getSiteUrlFromTelegram(
  site: 'wawacity' | 'zonetelecharger',
  telegramUrl?: string
): Promise<string | null> {
  const channelUrl = telegramUrl || DEFAULT_TELEGRAM_CHANNELS[site];
  return fetchSiteUrlFromTelegram(channelUrl, site);
}

/**
 * Get default Telegram channel URL for a site
 */
export function getDefaultTelegramChannel(site: 'wawacity' | 'zonetelecharger'): string {
  return DEFAULT_TELEGRAM_CHANNELS[site];
}
