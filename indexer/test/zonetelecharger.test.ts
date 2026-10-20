import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHtml } from '../src/utils/http.js';
import { ZoneTelechargerScraper } from '../src/scrapers/zonetelecharger.js';

vi.mock('../src/utils/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/http.js')>()),
  fetchHtml: vi.fn(),
}));

const BASE = 'https://www.zone-telechargement.test';
const scraper = new ZoneTelechargerScraper(BASE);
const fetched: string[] = [];

function servePages(pages: Record<string, string>) {
  vi.mocked(fetchHtml).mockImplementation(async (url: string) => {
    fetched.push(url);
    const key = Object.keys(pages).find(k => url.includes(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return pages[key];
  });
}

const cover = (href: string, title: string, lang: string) =>
  `<div class="cover_global"><div class="cover_infos_title"><a href="${href}">${title}</a><div class="detail_release"><span><b>${lang}</b></span></div></div></div>`;
const hoster = (name: string) => `<b><div>${name}</div></b>`;
const dl = (href: string, text: string) => `<b><a rel="external nofollow" href="${href}">${text}</a></b>`;

function detailPage(options: { originalTitle: string; year: string; quality: string; links: string }) {
  return `<div class="maincont">
<strong><u>Titre original</u> :</strong> ${options.originalTitle} <br>
<strong><u>Année de production</u> :</strong> ${options.year}<br>
<div>Qualité ${options.quality}</div>
<font color="red">film.mkv (4.2 Go)</font>
<a href="https://www.imdb.com/title/tt0113277/">IMDb</a>
<h2>Liens De Téléchargement :</h2>
<div><div class="postinfo">${options.links}</div></div>
</div>`;
}

const movieSearchPage = `
  ${cover('/?p=film&id=1-heat', 'Heat', 'MULTI')}
  ${cover('/?p=film&id=2-dune', 'Dune', 'VFF')}
  ${cover('/?p=film&id=3-solitaire', 'Le Solitaire', 'VFF')}`;
const heatDetail = detailPage({ originalTitle: 'Heat', year: '1995', quality: 'HDLIGHT 1080p | MULTI', links: `${hoster('1fichier')}${dl('https://dl-protect.link/aaa', 'Télécharger')}${hoster('Rapidgator')}${dl('https://dl-protect.link/bbb', 'Télécharger')}` });
const duneDetail = detailPage({ originalTitle: 'Dune', year: '2021', quality: '4K | MULTI', links: `${hoster('1fichier')}${dl('https://dl-protect.link/dune', 'Télécharger')}` });
const solitaireDetail = detailPage({ originalTitle: 'Heat', year: '1995', quality: 'DVDRIP | FRENCH', links: `${hoster('1fichier')}${dl('https://dl-protect.link/sol', 'Télécharger')}` });

beforeEach(() => {
  fetched.length = 0;
  vi.mocked(fetchHtml).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ZoneTelechargerScraper movies', () => {
  it('builds releases from the detail page and accepts a French title through its original title', async () => {
    servePages({ 'search=heat&p=films': movieSearchPage, 'id=1-heat': heatDetail, 'id=2-dune': duneDetail, 'id=3-solitaire': solitaireDetail });
    const results = await scraper.searchMovies({ q: 'Heat', year: '1995' });

    expect(results.map(r => r.title)).toEqual([
      'Heat.1995.HDLIGHT.1080p.MULTI.1fichier',
      'Heat.1995.HDLIGHT.1080p.MULTI.Rapidgator',
      'Le.Solitaire.1995.DVDRIP.FRENCH.1fichier',
    ]);
    expect(results[0]).toMatchObject({
      link: 'https://dl-protect.link/aaa',
      pageUrl: `${BASE}/?p=film&id=1-heat`,
      size: Math.round(4.2 * 1024 ** 3),
      imdbId: 'tt0113277',
      year: 1995,
      quality: 'HDLIGHT 1080p',
      language: 'MULTI',
    });
    expect(fetched[0]).toBe(`${BASE}/?search=heat&p=films`);
  });

  it('filters on hoster and year', async () => {
    servePages({ 'search=heat&p=films': movieSearchPage, 'id=1-heat': heatDetail, 'id=2-dune': duneDetail, 'id=3-solitaire': solitaireDetail });
    expect((await scraper.searchMovies({ q: 'Heat', hoster: 'rapidgator' })).map(r => r.title)).toEqual(['Heat.1995.HDLIGHT.1080p.MULTI.Rapidgator']);
    expect(await scraper.searchMovies({ q: 'Heat', year: '2024' })).toEqual([]);
  });
});

describe('ZoneTelechargerScraper series', () => {
  const seriesSearchPage = `
    ${cover('/?p=serie&id=10-bb-s5', 'Breaking Bad - Saison 5', 'VOSTFR')}
    ${cover('/?p=serie&id=11-bb-s4', 'Breaking Bad - Saison 4', 'VOSTFR')}
    ${cover('/?p=serie&id=12-other', 'Better Call Saul - Saison 5', 'VOSTFR')}`;
  const seriesDetail = detailPage({
    originalTitle: 'Breaking Bad', year: '2008', quality: 'HDTV 720p | VOSTFR',
    links: `${hoster('1fichier')}${dl('https://dl-protect.link/e3', 'Episode 3')}${dl('https://dl-protect.link/e4', 'Episode 4 FiNAL')}`,
  });

  it('keeps the requested season and episode only', async () => {
    servePages({ 'p=series': seriesSearchPage, 'id=10-bb-s5': seriesDetail });
    const results = await scraper.searchSeries({ q: 'Breaking Bad', season: '5', ep: '3' });
    expect(results.map(r => r.title)).toEqual(['Breaking.Bad.S05E03.HDTV.720p.VOSTFR.1fichier']);
    expect(results[0]).toMatchObject({ season: 5, episode: 3, link: 'https://dl-protect.link/e3' });
    expect(fetched.some(u => u.includes('id=11-bb-s4') || u.includes('id=12-other'))).toBe(false);
  });

  it('returns every episode of the season when no episode is requested', async () => {
    servePages({ 'p=series': seriesSearchPage, 'id=10-bb-s5': seriesDetail });
    expect((await scraper.searchSeries({ q: 'Breaking Bad', season: '5' })).map(r => r.episode)).toEqual([3, 4]);
  });
});
