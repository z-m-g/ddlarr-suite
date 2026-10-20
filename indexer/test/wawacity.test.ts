import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHtml } from '../src/utils/http.js';
import { WawacityScraper } from '../src/scrapers/wawacity.js';

vi.mock('../src/utils/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/http.js')>()),
  fetchHtml: vi.fn(),
}));

const BASE = 'https://www.wawacity.test';
const scraper = new WawacityScraper(BASE);
const fetched: string[] = [];

function servePages(pages: Record<string, string>) {
  vi.mocked(fetchHtml).mockImplementation(async (url: string) => {
    fetched.push(url);
    const key = Object.keys(pages).find(k => url.includes(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return pages[key];
  });
}

const result = (href: string, titleHtml: string) =>
  `<div class="wa-sub-block wa-post-detail-item"><div class="wa-sub-block-title"><a href="${href}">${titleHtml}</a></div></div>`;
const linkRow = (href: string, hoster: string, size: string) =>
  `<tr class="link-row"><td><a href="${href}">Télécharger</a></td><td>${hoster}</td><td>${size}</td></tr>`;

const movieSearchPage = `
  ${result('?p=film&id=1-heat', 'Heat <i>[HDLIGHT 1080p]</i> - MULTI')}
  ${result('?p=film&id=2-dune', 'Dune <i>[1080p]</i>')}
  <ul class="pagination"><li class="disabled"><a rel="next">»</a></li></ul>`;
const heatDetailPage = `
  <div class="wa-block-body"><ul class="detail-list">
    <li><span>Année de production:</span> <b>1995</b></li>
    <li><span>Titre original:</span> <b>Heat</b></li>
  </ul></div>
  <a href="https://www.imdb.com/title/tt0113277/">IMDb</a>
  <table id="DDLLinks">
    ${linkRow('https://dl-protect.link/aaa', '1fichier', '4.2 Go')}
    ${linkRow('https://dl-protect.link/bbb', 'Rapidgator', '4.2 Go')}
    ${linkRow('https://dl-protect.link/ccc', 'Anonyme', '1 Go')}
  </table>`;

beforeEach(() => {
  fetched.length = 0;
  vi.mocked(fetchHtml).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('WawacityScraper movies', () => {
  it('parses the search page, visits matching detail pages and builds release names', async () => {
    servePages({ 'p=films&': movieSearchPage, 'p=film&id=1-heat': heatDetailPage });
    const results = await scraper.searchMovies({ q: 'Heat', year: '1995' });

    expect(results.map(r => r.title)).toEqual([
      'Heat.1995.HDLIGHT.1080P.MULTI.1fichier',
      'Heat.1995.HDLIGHT.1080P.MULTI.Rapidgator',
    ]);
    expect(results[0]).toMatchObject({
      link: 'https://dl-protect.link/aaa',
      pageUrl: `${BASE}/?p=film&id=1-heat`,
      size: Math.round(4.2 * 1024 ** 3),
      imdbId: 'tt0113277',
      year: 1995,
      contentType: 'movie',
    });
    // Dune does not match "Heat" and is never visited
    expect(fetched.some(u => u.includes('id=2-dune'))).toBe(false);
    expect(fetched[0]).toBe(`${BASE}/?p=films&linkType=hasDownloadLink&search=heat`);
  });

  it('filters on hoster and on year', async () => {
    servePages({ 'p=films&': movieSearchPage, 'p=film&id=1-heat': heatDetailPage });
    expect((await scraper.searchMovies({ q: 'Heat', hoster: 'rapidgator' })).map(r => r.title)).toEqual(['Heat.1995.HDLIGHT.1080P.MULTI.Rapidgator']);
    expect(await scraper.searchMovies({ q: 'Heat', year: '2024' })).toEqual([]);
  });

  it('follows pagination while a next link is enabled', async () => {
    const page1 = movieSearchPage.replace('<li class="disabled">', '<li>');
    servePages({ 'search=heat&page=2': '<p>no more results</p>', 'p=films&': page1, 'p=film&id=1-heat': heatDetailPage });
    await scraper.searchMovies({ q: 'Heat' });
    expect(fetched.filter(u => u.includes('p=films'))).toEqual([
      `${BASE}/?p=films&linkType=hasDownloadLink&search=heat`,
      `${BASE}/?p=films&linkType=hasDownloadLink&search=heat&page=2`,
    ]);
  });

  it('returns nothing without query and survives fetch errors', async () => {
    expect(await scraper.searchMovies({ q: '' })).toEqual([]);
    vi.mocked(fetchHtml).mockRejectedValue(new Error('503'));
    expect(await scraper.searchMovies({ q: 'Heat' })).toEqual([]);
  });
});

describe('WawacityScraper series', () => {
  const seriesSearchPage = `
    ${result('?p=serie&id=10-bb-s5', 'Breaking Bad - Saison 5 - VOSTFR <i>[HDTV 720p]</i>')}
    ${result('?p=serie&id=11-bb-s4', 'Breaking Bad - Saison 4 - VOSTFR <i>[HDTV 720p]</i>')}`;
  const seriesDetailPage = `
    <table id="DDLLinkѕ">
      <tr class="title episode-title"><td>Épisode 3</td></tr>
      ${linkRow('https://dl-protect.link/e3', '1fichier', '1.2 Go')}
      <tr class="title episode-title"><td>Épisode 4</td></tr>
      ${linkRow('https://dl-protect.link/e4', '1fichier', '1.2 Go')}
    </table>`;

  it('keeps the requested season and episode only', async () => {
    servePages({ 'p=series&': seriesSearchPage, 'id=10-bb-s5': seriesDetailPage });
    const results = await scraper.searchSeries({ q: 'Breaking Bad', season: '5', ep: '3' });
    expect(results.map(r => r.title)).toEqual(['Breaking.Bad.S05E03.720P.VOSTFR.1fichier']);
    expect(results[0]).toMatchObject({ season: 5, episode: 3, link: 'https://dl-protect.link/e3', contentType: 'series' });
    expect(fetched[0]).toContain('search=breaking+bad+saison+5');
    expect(fetched.some(u => u.includes('id=11-bb-s4'))).toBe(false);
  });

  it('returns every episode of the season when no episode is requested', async () => {
    servePages({ 'p=series&': seriesSearchPage, 'id=10-bb-s5': seriesDetailPage });
    const results = await scraper.searchSeries({ q: 'Breaking Bad', season: '5' });
    expect(results.map(r => r.episode)).toEqual([3, 4]);
  });
});
