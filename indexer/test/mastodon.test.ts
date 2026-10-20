import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../src/utils/http.js';
import { extractSiteUrl, fetchSiteUrlFromMastodon, getDefaultMastodonProfile, getSiteUrlFromMastodon, parseMastodonProfile } from '../src/utils/mastodon.js';

vi.mock('../src/utils/http.js', () => ({ fetchJson: vi.fn() }));

// Bio as returned by mamot.fr for @ZT on 2026-10-20
const ZT_BIO = '<p>Url officielle : <a href="https://www.zone-telechargement.gold" target="_blank" rel="nofollow noopener" translate="no"><span class="invisible">https://www.</span><span class="">zone-telechargement.gold</span><span class="invisible"></span></a></p>';

beforeEach(() => {
  vi.mocked(fetchJson).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parseMastodonProfile', () => {
  it('splits a profile URL into instance and account', () => {
    expect(parseMastodonProfile('https://mamot.fr/@ZT')).toEqual({ instance: 'https://mamot.fr', acct: 'ZT' });
    expect(parseMastodonProfile('https://mamot.fr/@wawacity/')).toEqual({ instance: 'https://mamot.fr', acct: 'wawacity' });
    expect(parseMastodonProfile('https://mamot.fr/users/ZT')).toBeNull();
    expect(parseMastodonProfile('garbage')).toBeNull();
  });
});

describe('extractSiteUrl', () => {
  it('reads the official URL out of the bio HTML', () => {
    expect(extractSiteUrl(ZT_BIO)).toBe('https://www.zone-telechargement.gold/');
  });

  it('accepts a bare URL in text and ignores fediverse links', () => {
    expect(extractSiteUrl('<p>Nouvelle adresse: https://wawacity.example/films</p>')).toBe('https://wawacity.example/');
    expect(extractSiteUrl('<a href="https://mamot.fr/@other">ami</a> puis <a href="https://www.site.tld">site</a>')).toBe('https://www.site.tld/');
    expect(extractSiteUrl('<p>Rien ici</p>')).toBeNull();
  });
});

describe('fetchSiteUrlFromMastodon', () => {
  it('looks the account up through the instance API and returns the bio URL', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ note: ZT_BIO, fields: [] });
    await expect(fetchSiteUrlFromMastodon('https://mamot.fr/@ZT', 'zonetelecharger')).resolves.toBe('https://www.zone-telechargement.gold/');
    expect(vi.mocked(fetchJson).mock.calls[0][0]).toBe('https://mamot.fr/api/v1/accounts/lookup?acct=ZT');
  });

  it('falls back to the profile fields when the bio has no URL', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ note: '<p>Films et séries</p>', fields: [{ name: 'Site', value: '<a href="https://www.wawacity.gold">wawacity.gold</a>' }] });
    await expect(fetchSiteUrlFromMastodon('https://mamot.fr/@wawacity', 'wawacity')).resolves.toBe('https://www.wawacity.gold/');
  });

  it('returns null on an invalid profile, an empty bio or a network error', async () => {
    await expect(fetchSiteUrlFromMastodon('https://mamot.fr/users/ZT', 'zonetelecharger')).resolves.toBeNull();
    vi.mocked(fetchJson).mockResolvedValueOnce({ note: '<p>Rien</p>', fields: [] });
    await expect(fetchSiteUrlFromMastodon('https://mamot.fr/@ZT', 'zonetelecharger')).resolves.toBeNull();
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error('timeout'));
    await expect(fetchSiteUrlFromMastodon('https://mamot.fr/@ZT', 'zonetelecharger')).resolves.toBeNull();
  });

  it('uses the default profile of each site unless one is given', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ note: ZT_BIO });
    await getSiteUrlFromMastodon('zonetelecharger');
    expect(vi.mocked(fetchJson).mock.calls[0][0]).toContain('acct=ZT');
    expect(getDefaultMastodonProfile('wawacity')).toBe('https://mamot.fr/@wawacity');
    await getSiteUrlFromMastodon('wawacity', 'https://other.instance/@waw');
    expect(vi.mocked(fetchJson).mock.calls[1][0]).toBe('https://other.instance/api/v1/accounts/lookup?acct=waw');
  });
});
