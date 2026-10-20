import { describe, expect, it } from 'vitest';
import { contentTypeToCategory, parseLanguage, parseQuality, parseSeasonEpisode, parseSize } from '../src/scrapers/base.js';

describe('parseQuality', () => {
  it.each([
    ['Heat [HDLIGHT 1080p]', 'HDLIGHT.1080P'],
    ['Dune 2160p MULTI', '2160P'],
    ['Film 4K', '4K'],
    ['Serie HDTV 720p', '720P'],
    ['Film WEB-DL', 'WEB-DL'],
    ['Film BluRay', 'BLURAY'],
    ['Film DVDRip', 'DVDRIP'],
    ['Sans qualite', undefined],
  ])('parses %s', (title, expected) => {
    expect(parseQuality(title)).toBe(expected);
  });
});

describe('parseLanguage', () => {
  it('combines MULTI, French variants and VOSTFR', () => {
    expect(parseLanguage('Heat MULTI (TRUEFRENCH/VFF)')).toBe('MULTI.TRUEFRENCH');
    expect(parseLanguage('Serie VOSTFR')).toBe('VOSTFR');
    expect(parseLanguage('Film VFQ')).toBe('VFQ');
    expect(parseLanguage('Movie ENGLISH')).toBe('English');
    expect(parseLanguage('Film')).toBeUndefined();
  });
});

describe('parseSeasonEpisode', () => {
  it('reads SxxEyy and "Saison N"', () => {
    expect(parseSeasonEpisode('Show S02E05')).toEqual({ season: 2, episode: 5 });
    expect(parseSeasonEpisode('Show - Saison 3')).toEqual({ season: 3 });
    expect(parseSeasonEpisode('Film')).toEqual({});
  });
});

describe('parseSize', () => {
  it('converts French and English units with comma decimals', () => {
    expect(parseSize('4.2 Go')).toBe(Math.round(4.2 * 1024 ** 3));
    expect(parseSize('700,5 Mo')).toBe(Math.round(700.5 * 1024 ** 2));
    expect(parseSize('1 TB')).toBe(1024 ** 4);
    expect(parseSize('n/a')).toBeUndefined();
  });
});

describe('contentTypeToCategory', () => {
  it('maps content type and quality to Torznab categories', () => {
    expect(contentTypeToCategory('movie', '2160p')).toBe(2045);
    expect(contentTypeToCategory('movie', 'HDLIGHT.1080p')).toBe(2040);
    expect(contentTypeToCategory('movie', 'DVDRip')).toBe(2030);
    expect(contentTypeToCategory('movie')).toBe(2030);
    expect(contentTypeToCategory('series', '4K')).toBe(5045);
    expect(contentTypeToCategory('series', 'WEB-DL')).toBe(5040);
    expect(contentTypeToCategory('series', '480p')).toBe(5030);
    expect(contentTypeToCategory('anime', '1080p')).toBe(5070);
    expect(contentTypeToCategory('ebook')).toBe(7020);
  });
});
