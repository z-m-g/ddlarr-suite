import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { LoadixSession } from '../src/utils/loadix.js';

vi.mock('axios');

const API = 'https://api.loadix.fun';
const SITE = 'https://loadix.fun';
const RESOLVER = 'http://resolver:5000';
const LINK = 'b8647072-79a7-4420-b523-5700a79c7091';

function jwt(expiresInSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString('base64url');
  return `header.${payload}.sig`;
}

type Call = { url: string; body: unknown; headers: Record<string, string> };
const calls: Call[] = [];

/** Route axios.post calls to handlers keyed by URL suffix; handlers may throw axios-like errors */
function mockPosts(handlers: Record<string, (call: Call) => unknown>) {
  vi.mocked(axios.post).mockImplementation(async (url: string, body?: unknown, config?: { headers?: Record<string, string> }) => {
    const call = { url, body, headers: config?.headers || {} };
    calls.push(call);
    const key = Object.keys(handlers).find(k => url.endsWith(k));
    if (!key) throw new Error(`unexpected POST ${url}`);
    return handlers[key](call);
  });
}

const httpError = (status: number, data: unknown) => ({ response: { status, data } });
const ok = (data: unknown, headers: Record<string, unknown> = {}) => ({ status: 200, data, headers });

beforeEach(() => {
  calls.length = 0;
  vi.mocked(axios.post).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('LoadixSession', () => {
  it('is not configured without any credential source', () => {
    expect(new LoadixSession(API, SITE).isConfigured()).toBe(false);
    expect(new LoadixSession(API, SITE, { refreshCookie: 'loadix_refresh=x' }).isConfigured()).toBe(true);
    expect(new LoadixSession(API, SITE, { resolverUrl: RESOLVER }).isConfigured()).toBe(true);
  });

  it('refreshes the access token with the cookie and keeps the rotated cookie', async () => {
    const session = new LoadixSession(API, SITE, { refreshCookie: 'Cookie: "loadix_refresh=old"' });
    mockPosts({
      '/api/auth/refresh': () => ok({ accessToken: jwt(900) }, { 'set-cookie': ['loadix_refresh=new; Path=/; HttpOnly'] }),
    });

    const first = await session.getAccessToken();
    expect(calls[0].headers.Cookie).toBe('loadix_refresh=old');
    expect(first).toMatch(/^header\./);

    // Still valid: no second call
    await session.getAccessToken();
    expect(calls).toHaveLength(1);

    await session.getAccessToken(true);
    expect(calls[1].headers.Cookie).toBe('loadix_refresh=new');
  });

  it('logs in through the resolver and passes a Turnstile token when the reveal asks for one', async () => {
    const session = new LoadixSession(API, SITE, { resolverUrl: RESOLVER });
    let reveals = 0;
    mockPosts({
      '/loadix/login': () => ok({ accessToken: jwt(900), refreshCookie: 'loadix_refresh=abc', user: { username: 'tester' } }),
      '/loadix/turnstile': () => ok({ token: 'turnstile-token' }),
      [`/api/links/${LINK}/reveal`]: (call) => {
        reveals++;
        if (!(call.body as { turnstileToken?: string }).turnstileToken) throw httpError(403, { code: 'missing_token' });
        return ok({ status: 'ok', url: 'https://1fichier.com/?real', password: 'pass' });
      },
    });

    const result = await session.reveal(LINK);
    expect(result).toEqual({ url: 'https://1fichier.com/?real', password: 'pass', warning: null });
    expect(calls.map(c => new URL(c.url).pathname)).toEqual([
      '/loadix/login',
      `/api/links/${LINK}/reveal`,
      '/loadix/turnstile',
      `/api/links/${LINK}/reveal`,
    ]);
    expect(calls[1].headers.Authorization).toMatch(/^Bearer header\./);
    expect((calls[0].body as { action?: string })).toEqual({});

    // The session remembers that reveals need a token and fetches it up front
    calls.length = 0;
    await session.reveal(LINK);
    expect(calls.map(c => new URL(c.url).pathname)).toEqual(['/loadix/turnstile', `/api/links/${LINK}/reveal`]);
    expect(calls[0].body).toEqual({ action: 'link_reveal' });
    expect(reveals).toBe(3);
  });

  it('renews the token once on 401 and falls back to the resolver when the refresh fails', async () => {
    const session = new LoadixSession(API, SITE, { accessToken: jwt(900), refreshCookie: 'loadix_refresh=dead', resolverUrl: RESOLVER });
    let revealCalls = 0;
    mockPosts({
      '/api/auth/refresh': () => { throw httpError(401, { code: 'invalid_refresh_token' }); },
      '/loadix/login': () => ok({ accessToken: jwt(900), refreshCookie: 'loadix_refresh=fresh' }),
      [`/api/links/${LINK}/reveal`]: () => {
        revealCalls++;
        if (revealCalls === 1) throw httpError(401, { code: 'token_expired' });
        return ok({ status: 'ok', url: 'https://1fichier.com/?x' });
      },
    });

    await expect(session.reveal(LINK)).resolves.toMatchObject({ url: 'https://1fichier.com/?x' });
    expect(calls.map(c => new URL(c.url).pathname)).toEqual([
      `/api/links/${LINK}/reveal`,
      '/api/auth/refresh',
      '/loadix/login',
      `/api/links/${LINK}/reveal`,
    ]);
  });

  it('does not hammer the resolver after a failed login', async () => {
    const session = new LoadixSession(API, SITE, { resolverUrl: RESOLVER });
    mockPosts({
      '/loadix/login': () => ({ status: 502, data: { error: 'Turnstile token not obtained', code: 'turnstile_timeout' }, headers: {} }),
    });

    await expect(session.reveal(LINK)).rejects.toThrow('Turnstile token not obtained');
    await expect(session.reveal(LINK)).rejects.toThrow(/failed recently/);
    expect(calls).toHaveLength(1);
  });

  it('maps API errors to explicit messages', async () => {
    const session = new LoadixSession(API, SITE, { accessToken: jwt(900) });
    mockPosts({ [`/api/links/${LINK}/reveal`]: () => { throw httpError(429, { code: 'rate_limited', retryAfter: 42 }); } });
    await expect(session.reveal(LINK)).rejects.toThrow('retry in 42s');

    mockPosts({ [`/api/links/${LINK}/reveal`]: () => { throw httpError(404, { code: 'not_found' }); } });
    await expect(session.reveal(LINK)).rejects.toThrow('not found');

    mockPosts({ [`/api/links/${LINK}/reveal`]: () => ok({ status: 'error', error: 'reveal_link_dead' }) });
    await expect(session.reveal(LINK)).rejects.toThrow('reveal_link_dead');
  });
});
