import { describe, expect, it } from 'vitest';
import { TorznabCategory } from '../src/models/torznab.js';
import { buildErrorResponse, buildTorznabResponse } from '../src/utils/xml.js';

describe('buildTorznabResponse', () => {
  const items = [
    {
      title: 'Heat.1995.1080p.HDLight.VFF',
      guid: 'guid-1',
      link: 'https://api.loadix.fun/api/links/abc/reveal',
      size: 4_000_000_000,
      category: TorznabCategory.MoviesHD,
      imdbId: 'tt0113277',
      pubDate: new Date('2026-10-20T10:00:00Z'),
    },
    {
      title: 'Breaking.Bad.S05E03.1080p',
      guid: 'guid-2',
      link: 'https://1fichier.com/?xyz',
      size: 1_000,
      category: TorznabCategory.TVHD,
      season: 5,
      episode: 3,
    },
  ];

  it('wraps items in an RSS feed with torznab attributes', () => {
    const xml = buildTorznabResponse(items, 'Loadix');
    expect(xml).toContain('<rss');
    expect(xml).toContain('<title>Heat.1995.1080p.HDLight.VFF</title>');
    expect(xml).toContain('name="imdb" value="tt0113277"');
    expect(xml).toContain('name="season" value="5"');
    expect(xml).toContain('name="episode" value="3"');
    // RFC1123Z date with a numeric offset, not "GMT"
    expect(xml).toContain('Tue, 20 Oct 2026 10:00:00 +0000');
  });

  it('points enclosures at the /torrent endpoint when a base URL is given', () => {
    const xml = buildTorznabResponse(items, 'Loadix', 'http://indexer:9117');
    expect(xml).toContain('http://indexer:9117/torrent?link=https%3A%2F%2Fapi.loadix.fun%2Fapi%2Flinks%2Fabc%2Freveal&amp;name=Heat.1995.1080p.HDLight.VFF&amp;size=4000000000');
  });

  it('builds error responses', () => {
    const xml = buildErrorResponse(201, 'Incorrect parameter');
    expect(xml).toContain('code="201"');
    expect(xml).toContain('Incorrect parameter');
  });
});
