import { fetchJson } from './http.js';

/**
 * Site URL detection from a Mastodon profile.
 *
 * WawaCity and Zone-Téléchargement announce their current domain in the bio of their
 * Mastodon account ("Url officielle : https://www.example.tld"). The profile page is a
 * JavaScript application, so the bio is read through the instance's public API
 * (GET /api/v1/accounts/lookup?acct=<name>), which needs no authentication.
 */

const DEFAULT_PROFILES = {
  wawacity: 'https://mamot.fr/@wawacity',
  zonetelecharger: 'https://mamot.fr/@ZT',
};

// Resolution happens on every request, so a slow instance must not hold searches:
// on timeout the caller keeps the last known URL.
const MASTODON_FETCH_TIMEOUT = 5000;

interface MastodonAccount {
  note?: string;
  fields?: Array<{ name?: string; value?: string }>;
}

export type MastodonSite = keyof typeof DEFAULT_PROFILES;

/**
 * Split a profile URL such as https://mamot.fr/@ZT into the instance and the account name
 */
export function parseMastodonProfile(profileUrl: string): { instance: string; acct: string } | null {
  try {
    const parsed = new URL(profileUrl);
    const match = parsed.pathname.match(/^\/@([^/]+)\/?$/);
    if (!match) return null;
    return { instance: parsed.origin, acct: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

/**
 * Pick the site URL out of the bio HTML: the first http(s) link, or a bare domain
 */
export function extractSiteUrl(bioHtml: string): string | null {
  const text = bioHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
  const candidates = [
    ...[...bioHtml.matchAll(/href="(https?:\/\/[^"\s]+)"/gi)].map(m => m[1]),
    ...[...text.matchAll(/https?:\/\/[^\s<"')]+/gi)].map(m => m[0]),
  ];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      // Ignore links back to the fediverse itself
      if (/(^|\.)(mamot\.fr|mastodon\.social|joinmastodon\.org)$/i.test(url.hostname)) continue;
      return `${url.origin}/`;
    } catch {
      // not a URL, try the next one
    }
  }
  return null;
}

/**
 * Read the current site URL from a Mastodon profile. Returns null on any failure so the
 * caller can keep its last known value.
 */
export async function fetchSiteUrlFromMastodon(profileUrl: string, siteName: string): Promise<string | null> {
  const profile = parseMastodonProfile(profileUrl);
  if (!profile) {
    console.error(`[Mastodon] Invalid profile URL for ${siteName}: ${profileUrl}`);
    return null;
  }

  const apiUrl = `${profile.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(profile.acct)}`;
  try {
    console.log(`[Mastodon] Fetching site URL for ${siteName} from ${profileUrl}`);
    const account = await fetchJson<MastodonAccount>(apiUrl, { timeout: MASTODON_FETCH_TIMEOUT });

    const sources = [account.note || '', ...(account.fields || []).map(f => f.value || '')];
    for (const source of sources) {
      const siteUrl = extractSiteUrl(source);
      if (siteUrl) {
        console.log(`[Mastodon] Found URL for ${siteName}: ${siteUrl}`);
        return siteUrl;
      }
    }
    console.error(`[Mastodon] No site URL in the bio of ${profileUrl} (${siteName})`);
    return null;
  } catch (error) {
    console.error(`[Mastodon] Error fetching URL for ${siteName}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Get a site URL from its Mastodon account (default profile unless one is given).
 * Always fresh: caching / fallback is handled by the caller (resolveSiteUrl in config).
 */
export async function getSiteUrlFromMastodon(site: MastodonSite, profileUrl?: string): Promise<string | null> {
  return fetchSiteUrlFromMastodon(profileUrl || DEFAULT_PROFILES[site], site);
}

export function getDefaultMastodonProfile(site: MastodonSite): string {
  return DEFAULT_PROFILES[site];
}
