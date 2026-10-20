import { describe, expect, it } from 'vitest';
import { BookysScraper } from '../src/scrapers/bookys.js';

const BASE = 'https://www7.bookys-ebooks.com';

// parseListPage is private; tests reach it through the instance on purpose
function parse(html: string) {
  const scraper = new BookysScraper(BASE) as unknown as { parseListPage(html: string): Array<{ title: string; pageUrl: string }> };
  return scraper.parseListPage(html);
}

describe('BookysScraper.parseListPage', () => {
  it('reads the grid layout used by listing pages', () => {
    const html = `
      <div class="bys-items-container">
        <a class="bys-item" href="/journaux/123-liberation">
          <div class="item-details"><b class="font-bold">Libération du 20 octobre 2026</b></div>
        </a>
        <a class="bys-item" href="${BASE}/journaux/124-le-monde">
          <div class="item-details"><b class="font-bold">Le Monde</b></div>
        </a>
        <a class="bys-item" href="/journaux/125-no-title"></a>
      </div>`;
    expect(parse(html)).toEqual([
      { title: 'Libération du 20 octobre 2026', pageUrl: `${BASE}/journaux/123-liberation` },
      { title: 'Le Monde', pageUrl: `${BASE}/journaux/124-le-monde` },
    ]);
  });

  it('reads the table layout used by search results', () => {
    const html = `
      <table id="search_table">
        <tr><td><a class="bys-link" href="/journaux/200-liberation"> Libération </a></td></tr>
        <tr><td><a class="bys-link" href="/magazines/201-geo">Géo</a></td></tr>
      </table>`;
    expect(parse(html)).toEqual([
      { title: 'Libération', pageUrl: `${BASE}/journaux/200-liberation` },
      { title: 'Géo', pageUrl: `${BASE}/magazines/201-geo` },
    ]);
  });

  it('returns nothing for a Cloudflare challenge page', () => {
    expect(parse('<html><head><title>Just a moment...</title></head><body></body></html>')).toEqual([]);
  });
});
