import axios, { AxiosError } from 'axios';
// Config comes straight from env (same as dlprotect.ts)

/**
 * Loadix (loadix.fun) link reveal.
 *
 * The indexer emits opaque pseudo links (<api>/api/links/<id>/reveal) for Loadix results
 * because revealing the hoster URL needs an authenticated call (Bearer access token).
 * Every login path on the site is gated by a Cloudflare Turnstile challenge, so the
 * session comes from one of two places:
 *   - the resolver service (botasaurus), which drives a real browser to pass Turnstile
 *     and logs in with the credentials configured on it (LOADIX_MNEMONIC or
 *     LOADIX_EMAIL/LOADIX_PASSWORD) - POST /loadix/login returns the access token and
 *     the refresh cookie;
 *   - a refresh cookie copied from the user's browser (LOADIX_REFRESH_COOKIE).
 * In both cases short-lived access tokens are renewed via POST /api/auth/refresh, and a
 * new login is only requested when the refresh fails. Regular accounts must also pass a
 * Turnstile token on every reveal; the resolver provides it (POST /loadix/turnstile).
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LOADIX_LINK_PATTERN = /\/api\/links\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reveal\/?$/i;
const LOADIX_HOST_PATTERN = /(^|\.)loadix\.[a-z]+$/i;
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;
// A browser login takes a while (page load + Turnstile), and we don't want to hammer the
// resolver when it keeps failing (no credentials, Turnstile not passed...)
const AUTO_LOGIN_TIMEOUT_MS = 3 * 60 * 1000;
const AUTO_LOGIN_COOLDOWN_MS = 2 * 60 * 1000;
// Reveal answers for "send a Turnstile token" (regular accounts must pass one per reveal;
// only moderators are exempt)
const REVEAL_TURNSTILE_CODES = new Set(['missing_token', 'turnstile_required']);

export interface LoadixRevealResult {
  url: string;
  password?: string | null;
  warning?: string | null;
}

interface RevealResponse {
  status?: string;
  error?: string;
  url?: string;
  password?: string | null;
  warning?: string | null;
  interactionToken?: string;
}

interface RefreshResponse {
  accessToken?: string;
}

interface ResolverLoginResponse {
  accessToken?: string;
  refreshCookie?: string;
  user?: { id?: string; username?: string } | null;
  error?: string;
  code?: string;
}

interface ResolverTurnstileResponse {
  token?: string;
  error?: string;
  code?: string;
}

/**
 * Check if URL is a Loadix pseudo link (needs a reveal call to get the hoster URL)
 */
export function isLoadixLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOADIX_HOST_PATTERN.test(parsed.hostname) && LOADIX_LINK_PATTERN.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractLoadixLinkId(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(LOADIX_LINK_PATTERN);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Normalise a refresh cookie given by the user: accepts either "name=value" or a full
 * "Cookie:" header value. Strips a leading "Cookie:" prefix and surrounding quotes.
 */
function normalizeCookie(raw: string): string {
  return raw.trim().replace(/^cookie:\s*/i, '').replace(/^["']|["']$/g, '').trim();
}

export interface LoadixSessionOptions {
  accessToken?: string;
  refreshCookie?: string;
  /** Base URL of the resolver service (botasaurus) used for automatic login */
  resolverUrl?: string;
}

export class LoadixSession {
  private accessToken: string | null;
  private accessTokenExpiry: number | null;
  private refreshCookie: string | null;
  private readonly resolverUrl: string | null;
  private inflightRenew: Promise<string> | null = null;
  private autoLoginFailedAt: number | null = null;
  private autoLoginLastError: string | null = null;
  // Set once the API asked for a Turnstile token on a reveal: later reveals fetch it up front
  private revealNeedsTurnstile = false;

  constructor(
    public readonly apiBaseUrl: string,
    public readonly siteUrl: string,
    options: LoadixSessionOptions = {},
  ) {
    this.accessToken = options.accessToken || null;
    this.accessTokenExpiry = options.accessToken ? decodeJwtExpiry(options.accessToken) : null;
    this.refreshCookie = options.refreshCookie ? normalizeCookie(options.refreshCookie) : null;
    this.resolverUrl = options.resolverUrl ? options.resolverUrl.replace(/\/+$/, '') : null;
  }

  /**
   * True when we have at least one way to get an access token
   */
  isConfigured(): boolean {
    return Boolean(this.accessToken || this.refreshCookie || this.resolverUrl);
  }

  /**
   * True when an expired/rejected token can be replaced (cookie refresh or automatic login)
   */
  private canRenew(): boolean {
    return Boolean(this.refreshCookie || this.resolverUrl);
  }

  private get headers(): Record<string, string> {
    return {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': this.siteUrl,
      'Referer': `${this.siteUrl}/`,
    };
  }

  private isAccessTokenUsable(): boolean {
    if (!this.accessToken) return false;
    if (this.accessTokenExpiry === null) return true; // opaque token: trust it until a 401
    return Date.now() < this.accessTokenExpiry - TOKEN_EXPIRY_MARGIN_MS;
  }

  /**
   * Return a valid access token, renewing it (cookie refresh, then automatic login) when needed
   */
  async getAccessToken(force = false): Promise<string> {
    if (!force && this.isAccessTokenUsable()) {
      return this.accessToken as string;
    }
    if (!this.canRenew()) {
      if (this.accessToken && !force) return this.accessToken;
      throw new Error('Loadix session expired and no LOADIX_REFRESH_COOKIE or resolver service configured');
    }
    if (this.inflightRenew) {
      return this.inflightRenew;
    }
    this.inflightRenew = this.renew().finally(() => {
      this.inflightRenew = null;
    });
    return this.inflightRenew;
  }

  private async renew(): Promise<string> {
    if (this.refreshCookie) {
      try {
        return await this.refresh();
      } catch (error) {
        if (!this.resolverUrl) throw error;
        console.warn(`[Loadix] ${error instanceof Error ? error.message : error} - logging in again through the resolver`);
      }
    }
    return this.autoLogin();
  }

  private async refresh(): Promise<string> {
    console.log('[Loadix] Refreshing access token...');
    try {
      const response = await axios.post<RefreshResponse>(
        `${this.apiBaseUrl}/api/auth/refresh`,
        {},
        {
          timeout: 30000,
          headers: { ...this.headers, 'Cookie': this.refreshCookie as string },
        },
      );

      const token = response.data?.accessToken;
      if (!token) {
        throw new Error('refresh response has no accessToken');
      }

      // The API may rotate the refresh cookie: keep the new value for the next refresh
      const setCookies = response.headers['set-cookie'];
      if (Array.isArray(setCookies) && setCookies.length > 0) {
        const pairs = setCookies
          .map(c => c.split(';')[0].trim())
          .filter(pair => pair.includes('=') && !/=\s*$/.test(pair));
        if (pairs.length > 0) {
          this.refreshCookie = this.mergeCookies(this.refreshCookie as string, pairs);
          console.log('[Loadix] Refresh cookie rotated by the API');
        }
      }

      this.setAccessToken(token);
      console.log(`[Loadix] Access token refreshed${this.describeExpiry()}`);
      return token;
    } catch (error) {
      const err = error as AxiosError<{ code?: string; message?: string }>;
      const code = err.response?.data?.code || err.response?.status || err.message;
      const hint = this.resolverUrl ? '' : ` - log in again on ${this.siteUrl} and update LOADIX_REFRESH_COOKIE`;
      throw new Error(`Loadix token refresh failed (${code})${hint}`);
    }
  }

  /**
   * Ask the resolver service to log in (real browser for Turnstile, credentials on its side)
   */
  private async autoLogin(): Promise<string> {
    if (this.autoLoginFailedAt && Date.now() - this.autoLoginFailedAt < AUTO_LOGIN_COOLDOWN_MS) {
      const retryIn = Math.ceil((AUTO_LOGIN_COOLDOWN_MS - (Date.now() - this.autoLoginFailedAt)) / 1000);
      throw new Error(`Loadix automatic login failed recently (${this.autoLoginLastError}) - retry in ${retryIn}s`);
    }

    console.log('[Loadix] Logging in through the resolver service...');
    try {
      const response = await axios.post<ResolverLoginResponse>(
        `${this.resolverUrl}/loadix/login`,
        {},
        { timeout: AUTO_LOGIN_TIMEOUT_MS, validateStatus: () => true },
      );
      const data = response.data || {};
      if (response.status !== 200 || !data.accessToken) {
        throw new Error(data.error || `resolver answered HTTP ${response.status}`);
      }

      this.setAccessToken(data.accessToken);
      if (data.refreshCookie) {
        this.refreshCookie = normalizeCookie(data.refreshCookie);
      }
      this.autoLoginFailedAt = null;
      this.autoLoginLastError = null;
      const who = data.user?.username || data.user?.id;
      console.log(`[Loadix] Logged in${who ? ` as ${who}` : ''}${this.describeExpiry()}`);
      return data.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.autoLoginFailedAt = Date.now();
      this.autoLoginLastError = message;
      throw new Error(`Loadix automatic login failed: ${message}`);
    }
  }

  /**
   * Get a Turnstile token from the resolver for actions the API gates with anti-bot checks
   */
  private async getTurnstileToken(action: string): Promise<string | null> {
    if (!this.resolverUrl) return null;
    try {
      const response = await axios.post<ResolverTurnstileResponse>(
        `${this.resolverUrl}/loadix/turnstile`,
        { action },
        { timeout: AUTO_LOGIN_TIMEOUT_MS, validateStatus: () => true },
      );
      if (response.status === 200 && response.data?.token) {
        return response.data.token;
      }
      console.warn(`[Loadix] Resolver could not provide a Turnstile token: ${response.data?.error || `HTTP ${response.status}`}`);
    } catch (error) {
      console.warn(`[Loadix] Resolver Turnstile request failed: ${error instanceof Error ? error.message : error}`);
    }
    return null;
  }

  private setAccessToken(token: string): void {
    this.accessToken = token;
    this.accessTokenExpiry = decodeJwtExpiry(token);
  }

  private describeExpiry(): string {
    return this.accessTokenExpiry ? ` (expires ${new Date(this.accessTokenExpiry).toISOString()})` : '';
  }

  private mergeCookies(current: string, updates: string[]): string {
    const jar = new Map<string, string>();
    for (const pair of current.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    for (const pair of updates) {
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * Reveal a link: returns the real hoster URL (and archive password when any)
   */
  async reveal(linkId: string): Promise<LoadixRevealResult> {
    if (!this.isConfigured()) {
      throw new Error('Loadix session not configured (set LOADIX_REFRESH_COOKIE, or credentials on the resolver service)');
    }

    let token = await this.getAccessToken();
    let turnstileToken: string | null = this.revealNeedsTurnstile ? await this.getTurnstileToken('link_reveal') : null;
    let renewed = false;

    // Up to 3 tries: initial call, one retry with a renewed token, one retry with a Turnstile token
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await axios.post<RevealResponse>(
          `${this.apiBaseUrl}/api/links/${linkId}/reveal`,
          turnstileToken ? { turnstileToken } : {},
          {
            timeout: 30000,
            headers: { ...this.headers, 'Authorization': `Bearer ${token}` },
          },
        );

        const data = response.data;
        if (data.status === 'ok' && data.url) {
          if (data.warning) {
            console.warn(`[Loadix] Link ${linkId} revealed with warning: ${data.warning}`);
          }
          return { url: data.url, password: data.password ?? null, warning: data.warning ?? null };
        }
        throw new Error(`reveal refused: ${data.error || data.status || 'unknown'}`);
      } catch (error) {
        const err = error as AxiosError<{ code?: string; message?: string; retryAfter?: number }>;
        const status = err.response?.status;
        const code = err.response?.data?.code;

        // Expired/invalid access token: renew once and retry
        if (status === 401 && !renewed && this.canRenew()) {
          renewed = true;
          console.log(`[Loadix] Access token rejected (${code || 401}), renewing...`);
          token = await this.getAccessToken(true);
          continue;
        }

        if (status === 403 && code && REVEAL_TURNSTILE_CODES.has(code)) {
          this.revealNeedsTurnstile = true;
          if (!turnstileToken) {
            turnstileToken = await this.getTurnstileToken('link_reveal');
            if (turnstileToken) {
              console.log(`[Loadix] Reveal of ${linkId} needs an anti-bot verification, retrying with a Turnstile token`);
              continue;
            }
          }
          throw new Error('Loadix requires an anti-bot verification for each reveal - the resolver service must be reachable to provide the Turnstile token');
        }
        if (status === 403 && code && code.startsWith('turnstile_')) {
          throw new Error(`Loadix rejected the anti-bot verification (${code})`);
        }
        if (status === 429) {
          const retryAfter = err.response?.data?.retryAfter;
          throw new Error(`Loadix rate limit reached${retryAfter ? ` (retry in ${retryAfter}s)` : ''}`);
        }
        if (status === 404) {
          throw new Error('Loadix link not found (removed?)');
        }
        if (status) {
          throw new Error(`Loadix reveal failed (${status} ${code || err.response?.data?.message || ''})`.trim());
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new Error('Loadix reveal failed after retries');
  }
}

let session: LoadixSession | null = null;

/**
 * Shared session built from env (LOADIX_* and DLPROTECT_SERVICE_URL)
 */
export function getLoadixSession(): LoadixSession {
  if (!session) {
    session = new LoadixSession(
      (process.env.LOADIX_API_URL || 'https://api.loadix.fun').replace(/\/+$/, ''),
      (process.env.LOADIX_URL || 'https://loadix.fun').replace(/\/+$/, ''),
      {
        accessToken: process.env.LOADIX_ACCESS_TOKEN,
        refreshCookie: process.env.LOADIX_REFRESH_COOKIE,
        resolverUrl: process.env.DLPROTECT_SERVICE_URL || 'http://localhost:5000',
      },
    );
  }
  return session;
}

/**
 * Resolve a Loadix pseudo link to the real hoster URL
 */
export async function resolveLoadixLink(url: string): Promise<string> {
  const linkId = extractLoadixLinkId(url);
  if (!linkId) return url;

  const result = await getLoadixSession().reveal(linkId);
  if (result.password) {
    console.log(`[Loadix] Archive password for ${linkId}: ${result.password}`);
  }
  console.log(`[Loadix] Revealed ${linkId} -> ${result.url}`);
  return result.url;
}
