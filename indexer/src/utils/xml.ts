import { XMLBuilder } from 'fast-xml-parser';
import { TorznabItem, TorznabCaps, TorznabCategory } from '../models/torznab.js';

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
});

function formatDate(date: Date): string {
  return date.toUTCString();
}

function categoryToName(category: TorznabCategory): string {
  const names: Record<TorznabCategory, string> = {
    [TorznabCategory.Movies]: 'Movies',
    [TorznabCategory.MoviesSD]: 'Movies/SD',
    [TorznabCategory.MoviesHD]: 'Movies/HD',
    [TorznabCategory.MoviesUHD]: 'Movies/UHD',
    [TorznabCategory.Movies3D]: 'Movies/3D',
    [TorznabCategory.TV]: 'TV',
    [TorznabCategory.TVSD]: 'TV/SD',
    [TorznabCategory.TVHD]: 'TV/HD',
    [TorznabCategory.TVUHD]: 'TV/UHD',
    [TorznabCategory.Anime]: 'Anime',
  };
  return names[category] || 'Other';
}

export function buildTorznabResponse(items: TorznabItem[], siteTitle: string, baseUrl?: string): string {
  const rssItems = items.map((item) => {
    // Si baseUrl est fourni, génère un lien vers /torrent qui créera un faux .torrent
    const torrentLink = baseUrl
      ? `${baseUrl}/torrent?link=${encodeURIComponent(item.link)}&name=${encodeURIComponent(item.title)}&size=${item.size || 0}`
      : item.link;
    const torznabAttrs: Array<{ '@_name': string; '@_value': string }> = [
      { '@_name': 'category', '@_value': String(item.category) },
    ];

    if (item.imdbId) {
      torznabAttrs.push({ '@_name': 'imdb', '@_value': item.imdbId });
    }
    if (item.tmdbId) {
      torznabAttrs.push({ '@_name': 'tmdbid', '@_value': item.tmdbId });
    }
    if (item.tvdbId) {
      torznabAttrs.push({ '@_name': 'tvdbid', '@_value': item.tvdbId });
    }
    if (item.season !== undefined) {
      torznabAttrs.push({ '@_name': 'season', '@_value': String(item.season) });
    }
    if (item.episode !== undefined) {
      torznabAttrs.push({ '@_name': 'episode', '@_value': String(item.episode) });
    }
    if (item.size) {
      torznabAttrs.push({ '@_name': 'size', '@_value': String(item.size) });
    }
    if (item.year) {
      torznabAttrs.push({ '@_name': 'year', '@_value': String(item.year) });
    }

    // DDL n'a pas de seeders, mais on met une valeur pour éviter le filtrage par les *arr apps
    torznabAttrs.push({ '@_name': 'seeders', '@_value': '100' });
    torznabAttrs.push({ '@_name': 'peers', '@_value': '100' });

    // Determine content type
    const isTV = item.category >= 5000 && item.category < 6000;
    torznabAttrs.push({ '@_name': 'type', '@_value': isTV ? 'series' : 'movie' });

    const rssItem: Record<string, unknown> = {
      title: item.title,
      guid: {
        '@_isPermaLink': 'true',
        '#text': item.guid,
      },
      link: torrentLink,
      pubDate: item.pubDate ? formatDate(item.pubDate) : formatDate(new Date()),
      category: categoryToName(item.category),
      size: item.size || 0,
      description: item.title,
      enclosure: {
        '@_url': torrentLink,
        '@_length': String(item.size || 0),
        '@_type': 'application/x-bittorrent',
      },
      'torznab:attr': torznabAttrs,
    };

    if (item.comments) {
      rssItem.comments = item.comments;
    }

    return rssItem;
  });

  const rss = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    rss: {
      '@_version': '1.0',
      '@_xmlns:atom': 'http://www.w3.org/2005/Atom',
      '@_xmlns:torznab': 'http://torznab.com/schemas/2015/feed',
      channel: {
        'atom:link': {
          '@_rel': 'self',
          '@_type': 'application/rss+xml',
        },
        title: `DDL Torznab - ${siteTitle}`,
        description: `DDL indexer for ${siteTitle}`,
        link: 'https://github.com',
        language: 'fr-fr',
        category: 'search',
        item: rssItems,
      },
    },
  };

  return xmlBuilder.build(rss);
}

export function buildCapsResponse(caps: TorznabCaps): string {
  const capsXml = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    caps: {
      server: {
        '@_version': '1.0',
        '@_title': caps.server.title,
        '@_strapline': 'DDL Indexer for Sonarr/Radarr',
      },
      limits: {
        '@_max': String(caps.limits.max),
        '@_default': String(caps.limits.default),
      },
      searching: {
        search: {
          '@_available': caps.searching.search.available ? 'yes' : 'no',
          '@_supportedParams': 'q',
        },
        'tv-search': {
          '@_available': caps.searching.tvsearch.available ? 'yes' : 'no',
          '@_supportedParams': 'q,season,ep,year',
        },
        'movie-search': {
          '@_available': caps.searching.moviesearch.available ? 'yes' : 'no',
          '@_supportedParams': 'q,year,imdbid,tmdbid',
        },
      },
      categories: {
        category: [
          {
            '@_id': '2000',
            '@_name': 'Movies',
            subcat: [
              { '@_id': '2030', '@_name': 'Movies/SD' },
              { '@_id': '2040', '@_name': 'Movies/HD' },
              { '@_id': '2045', '@_name': 'Movies/UHD' },
              { '@_id': '2060', '@_name': 'Movies/3D' },
            ],
          },
          {
            '@_id': '5000',
            '@_name': 'TV',
            subcat: [
              { '@_id': '5030', '@_name': 'TV/SD' },
              { '@_id': '5040', '@_name': 'TV/HD' },
              { '@_id': '5045', '@_name': 'TV/UHD' },
              { '@_id': '5070', '@_name': 'Anime' },
            ],
          },
        ],
      },
    },
  };

  return xmlBuilder.build(capsXml);
}

export function buildErrorResponse(code: number, description: string): string {
  const errorXml = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    error: {
      '@_code': String(code),
      '@_description': description,
    },
  };

  return xmlBuilder.build(errorXml);
}
