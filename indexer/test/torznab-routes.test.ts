import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getScraper } from '../src/scrapers/index.js';
import { torznabRoutes } from '../src/routes/torznab.js';
import type { BaseScraper } from '../src/scrapers/base.js';
import type { ScraperResult, SearchParams } from '../src/models/torznab.js';

vi.mock('../src/scrapers/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/scrapers/index.js')>()),
  getScraper: vi.fn(),
  isValidSite: (site: string) => site === 'fake',
  getAvailableSites: () => ['fake'],
}));

const results: ScraperResult[] = [
  { title: 'Heat.1995.1080p.MULTI', link: 'https://1fichier.com/?hd', pageUrl: 'https://fake/heat', size: 4_000_000_000, quality: '1080p', contentType: 'movie', pubDate: new Date('2026-10-20T00:00:00Z') },
  { title: 'Heat.1995.DVDRip', link: 'https://1fichier.com/?sd', pageUrl: 'https://fake/heat', size: 700_000_000, quality: 'DVDRip', contentType: 'movie', pubDate: new Date('2026-10-20T00:00:00Z') },
  { title: 'Heat.1995.NoSize', link: 'https://1fichier.com/?nosize', pageUrl: 'https://fake/heat', quality: '1080p', contentType: 'movie', pubDate: new Date('2026-10-20T00:00:00Z') },
];

const scraper = {
  name: 'Fake',
  baseUrl: 'https://fake',
  search: vi.fn(async () => results),
  searchMovies: vi.fn(async (_params: SearchParams) => results),
  searchSeries: vi.fn(async (_params: SearchParams) => [] as ScraperResult[]),
};

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  await app.register(torznabRoutes);
  await app.ready();
});
afterAll(() => app.close());

beforeEach(() => {
  vi.mocked(getScraper).mockResolvedValue(scraper as unknown as BaseScraper);
  scraper.searchMovies.mockClear();
  scraper.searchSeries.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const get = (url: string) => app.inject({ method: 'GET', url, headers: { host: 'indexer:9117' } });
const titles = (xml: string) => [...xml.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).slice(1);

describe('Torznab routes', () => {
  it('lists sites and answers caps', async () => {
    expect((await get('/sites')).json()).toEqual({ sites: ['fake'] });
    const caps = await get('/api/fake?t=caps');
    expect(caps.headers['content-type']).toContain('application/xml');
    expect(caps.body).toContain('<caps>');
    expect(caps.body).toContain('name="Movies/HD"');
  });

  it('rejects unknown sites and actions with Torznab error codes', async () => {
    expect((await get('/api/nope?t=search&q=x')).body).toContain('code="100"');
    expect((await get('/api/fake?t=bogus')).body).toContain('code="200"');
  });

  it('returns items with torrent enclosures and drops results without size', async () => {
    const res = await get('/api/fake?t=search&q=heat');
    expect(titles(res.body)).toEqual(['Heat.1995.1080p.MULTI', 'Heat.1995.DVDRip']);
    expect(res.body).toContain('http://indexer:9117/torrent?link=https%3A%2F%2F1fichier.com%2F%3Fhd&amp;name=Heat.1995.1080p.MULTI&amp;size=4000000000');
    expect(res.body).toContain('name="category" value="2040"');
    expect(res.body).toContain('name="category" value="2030"');
  });

  it('extracts a trailing year from the query', async () => {
    await get('/api/fake?t=search&q=heat%201995');
    expect(scraper.searchMovies).toHaveBeenCalledWith(expect.objectContaining({ q: 'heat', year: '1995' }));
  });

  it('passes the hosters from the path to the scraper', async () => {
    await get('/api/fake/1fichier,rapidgator?t=search&q=heat');
    expect(scraper.searchMovies).toHaveBeenCalledWith(expect.objectContaining({ hoster: '1fichier,rapidgator' }));
  });

  it('filters on categories, including parent/child relations', async () => {
    expect(titles((await get('/api/fake?t=search&q=heat&cat=2040')).body)).toEqual(['Heat.1995.1080p.MULTI']);
    expect(titles((await get('/api/fake?t=search&q=heat&cat=2000')).body)).toEqual(['Heat.1995.1080p.MULTI', 'Heat.1995.DVDRip']);
    expect(titles((await get('/api/fake?t=search&q=heat&cat=5000')).body)).toEqual([]);
  });

  it('skips movie and tvsearch requests without an IMDB id', async () => {
    expect(titles((await get('/api/fake?t=movie&q=heat')).body)).toEqual([]);
    expect(scraper.searchMovies).not.toHaveBeenCalled();
    await get('/api/fake?t=movie&q=heat&imdbid=tt0113277');
    expect(scraper.searchMovies).toHaveBeenCalledWith(expect.objectContaining({ imdbid: 'tt0113277' }));
    await get('/api/fake?t=tvsearch&q=heat&imdbid=tt0113277&season=1&ep=2');
    expect(scraper.searchSeries).toHaveBeenCalledWith(expect.objectContaining({ season: '1', ep: '2' }));
  });

  it('gives every item its own GUID even when links share a long prefix', async () => {
    const prefix = 'https://api.loadix.fun/api/links/';
    scraper.searchMovies.mockResolvedValueOnce([
      { ...results[0], title: 'A', link: `${prefix}aaaaaaaa-0000-4000-8000-000000000001/reveal` },
      { ...results[0], title: 'B', link: `${prefix}bbbbbbbb-0000-4000-8000-000000000002/reveal` },
    ]);
    const guids = [...(await get('/api/fake?t=search&q=heat')).body.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(m => m[1]);
    expect(guids).toHaveLength(2);
    expect(new Set(guids).size).toBe(2);
  });

  it('applies limit and offset', async () => {
    expect(titles((await get('/api/fake?t=search&q=heat&limit=1&offset=1')).body)).toEqual(['Heat.1995.DVDRip']);
  });

  it('answers an empty query with a connection-test item', async () => {
    scraper.searchMovies.mockResolvedValueOnce([]);
    expect(titles((await get('/api/fake?t=search')).body)).toEqual(['DDL Torznab Connection Test']);
  });

  it('serves a fake torrent carrying the DDL link', async () => {
    const res = await get('/torrent?link=https%3A%2F%2F1fichier.com%2F%3Fhd&name=H%C3%A9at.1995&size=42');
    expect(res.headers['content-type']).toBe('application/x-bittorrent');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Heat.1995.torrent"');
    expect(res.rawPayload.toString('latin1')).toContain('7:comment24:https://1fichier.com/?hd');
    expect((await get('/torrent')).statusCode).toBe(400);
  });
});
