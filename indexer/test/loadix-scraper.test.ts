import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../src/utils/http.js';
import { getSearchQueriesFromImdb } from '../src/utils/imdb.js';
import { LoadixScraper } from '../src/scrapers/loadix.js';

vi.mock('../src/utils/http.js', () => ({ fetchJson: vi.fn() }));
vi.mock('../src/utils/imdb.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/imdb.js')>()),
  getSearchQueriesFromImdb: vi.fn(),
}));

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/loadix/${name}.json`, import.meta.url), 'utf8'));
const HEAT_ID = 'ebc89b67-3fa6-475c-8c5e-5236e8a594bb';
const BB_ID = '4674a63c-ff00-40c8-9aa3-895b47a70964';

function link(overrides: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    mediaId: BB_ID,
    scope: 'episode',
    seasonNumber: null,
    episodeNumber: null,
    provider: '1fichier',
    linkType: 'ddl_url',
    quality: 'WEB 1080p',
    language: 'VOSTFR',
    sizeBytes: '1000000000',
    status: 'validated',
    addedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const bbLinks = [
  link({ id: 'c39fa98a-e524-4336-ac44-bbaede71d9d4', seasonNumber: 5, episodeNumber: 3, quality: 'ULTRA HD (x265)', language: 'MULTI' }),
  link({ id: '11111111-1111-4111-8111-111111111111', scope: 'season', seasonNumber: 5, quality: 'HDLight 1080p (x265)', language: 'MULTi VFF' }),
  link({ id: '22222222-2222-4222-8222-222222222222', seasonNumber: 3, episodeNumber: 12, quality: 'Blu-Ray 1080p' }),
  link({ id: '33333333-3333-4333-8333-333333333333', scope: 'series', quality: 'WEB-DL' }),
  link({ id: '44444444-4444-4444-8444-444444444444', seasonNumber: 5, episodeNumber: 3, linkType: 'nzb_file' }),
  link({ id: '55555555-5555-4555-8555-555555555555', seasonNumber: 5, episodeNumber: 3, status: 'pending' }),
  link({ id: '66666666-6666-4666-8666-666666666666', seasonNumber: 5, episodeNumber: 3, provider: 'rapidgator' }),
];

type Routes = Record<string, (url: URL) => unknown>;
const requested: string[] = [];

function mockApi(routes: Routes) {
  vi.mocked(fetchJson).mockImplementation(async (rawUrl: string) => {
    const url = new URL(rawUrl);
    requested.push(url.pathname + url.search);
    const key = Object.keys(routes).find(k => url.pathname === k);
    if (!key) throw new Error(`unexpected ${rawUrl}`);
    return routes[key](url);
  });
}

const heatRoutes: Routes = {
  '/api/media/search': () => fixture('search-heat'),
  [`/api/media/${HEAT_ID}`]: () => fixture('detail-heat'),
  [`/api/media/${HEAT_ID}/links`]: () => fixture('links-heat'),
};

beforeEach(() => {
  requested.length = 0;
  vi.mocked(fetchJson).mockReset();
  vi.mocked(getSearchQueriesFromImdb).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const scraper = new LoadixScraper('https://loadix.fun');

describe('LoadixScraper movies', () => {
  it('builds Radarr-friendly releases from the catalog, keeping only the media matching the year', async () => {
    mockApi(heatRoutes);
    const results = await scraper.searchMovies({ q: 'heat', year: '1995', hoster: '1fichier' });

    expect(results.map(r => r.title)).toEqual([
      'Heat.1995.1080p.HDLight.VFF.1fichier',
      'Heat.1995.1080p.BluRay.x265.MULTI.VF2.1fichier',
      'Heat.1995.2160p.WEB-DL.MULTI.VFF.1fichier',
      'Heat.1995.2160p.BluRay.REMUX.MULTI.VFF.1fichier',
    ]);
    expect(results[0]).toMatchObject({
      link: 'https://api.loadix.fun/api/links/b8647072-79a7-4420-b523-5700a79c7091/reveal',
      pageUrl: `https://loadix.fun/media/${HEAT_ID}`,
      size: 3450000000,
      imdbId: 'tt0113277',
      tmdbId: '949',
      year: 1995,
      contentType: 'movie',
    });
    // "Killer Heat" (2024) and "The Big Heat" (1988) are never expanded
    expect(requested.filter(u => u.includes('/links'))).toHaveLength(1);
    expect(requested[0]).toContain('/api/media/search?q=heat&type=movie&has_links=true&pageSize=20');
  });

  it('drops a media whose IMDB id does not match the one Radarr asked for', async () => {
    mockApi(heatRoutes);
    vi.mocked(getSearchQueriesFromImdb).mockResolvedValue(['Heat']);
    await expect(scraper.searchMovies({ q: 'heat', imdbid: 'tt0000001' })).resolves.toEqual([]);
    await expect(scraper.searchMovies({ q: 'heat', imdbid: '0113277' })).resolves.toHaveLength(4);
    expect(getSearchQueriesFromImdb).toHaveBeenCalledWith('tt0000001', 'heat');
  });

  it('uses the TMDB id as the decisive match when provided', async () => {
    mockApi(heatRoutes);
    await expect(scraper.searchMovies({ q: 'heat', tmdbid: '949' })).resolves.toHaveLength(4);
    await expect(scraper.searchMovies({ q: 'heat', tmdbid: '1' })).resolves.toEqual([]);
  });

  it('returns nothing without a query and survives API errors', async () => {
    await expect(scraper.searchMovies({ q: '' })).resolves.toEqual([]);
    vi.mocked(fetchJson).mockRejectedValue(new Error('boom'));
    await expect(scraper.searchMovies({ q: 'heat' })).resolves.toEqual([]);
  });
});

describe('LoadixScraper series', () => {
  const bbRoutes: Routes = {
    '/api/media/search': () => fixture('search-breaking-bad'),
    [`/api/media/${BB_ID}`]: () => ({ media: { id: BB_ID, imdbId: 'tt0903747', tmdbId: 1396 } }),
    [`/api/media/${BB_ID}/links`]: () => ({ items: bbLinks, total: bbLinks.length, page: 1, perPage: 100 }),
  };

  it('answers an episode search with the episode and the season pack only', async () => {
    mockApi(bbRoutes);
    const results = await scraper.searchSeries({ q: 'breaking bad', season: '5', ep: '3', hoster: '1fichier' });
    expect(results.map(r => r.title)).toEqual([
      'Breaking.Bad.S05E03.2160p.x265.MULTI.1fichier',
      'Breaking.Bad.S05.1080p.HDLight.x265.MULTI.VFF.1fichier',
    ]);
    expect(results[0]).toMatchObject({ season: 5, episode: 3, contentType: 'series', imdbId: 'tt0903747' });
    expect(results[1]).toMatchObject({ season: 5, episode: undefined });
  });

  it('ignores NZB, unvalidated links and complete-series packs for a season search', async () => {
    mockApi(bbRoutes);
    const results = await scraper.searchSeries({ q: 'breaking bad', season: '5' });
    expect(results.map(r => r.title)).toEqual([
      'Breaking.Bad.S05E03.2160p.x265.MULTI.1fichier',
      'Breaking.Bad.S05.1080p.HDLight.x265.MULTI.VFF.1fichier',
      'Breaking.Bad.S05E03.1080p.WEB-DL.VOSTFR.rapidgator',
    ]);
  });

  it('keeps every season when no season is requested', async () => {
    mockApi(bbRoutes);
    const results = await scraper.searchSeries({ q: 'breaking bad' });
    expect(results).toHaveLength(5);
    expect(results.find(r => r.title === 'Breaking.Bad.WEB-DL.VOSTFR.1fichier')).toBeDefined();
  });

  it('pages through the links list', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => link({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, seasonNumber: 1, episodeNumber: i + 1 }));
    const page2 = Array.from({ length: 40 }, (_, i) => link({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`, seasonNumber: 2, episodeNumber: i + 1 }));
    mockApi({
      ...bbRoutes,
      [`/api/media/${BB_ID}/links`]: (url) => ({ items: url.searchParams.get('page') === '2' ? page2 : page1, total: 140, page: Number(url.searchParams.get('page')), perPage: 100 }),
    });
    const results = await scraper.searchSeries({ q: 'breaking bad' });
    expect(results).toHaveLength(140);
    expect(requested.filter(u => u.includes('/links'))).toEqual([
      `/api/media/${BB_ID}/links?page=1&perPage=100`,
      `/api/media/${BB_ID}/links?page=2&perPage=100`,
    ]);
  });
});
