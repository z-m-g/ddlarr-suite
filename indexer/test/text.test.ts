import { describe, expect, it } from 'vitest';
import {
  extractMovieName,
  extractName,
  extractSeriesName,
  getAllowedDistance,
  isMovieNameMatch,
  isNameMatch,
  isSeriesNameMatch,
  levenshteinDistance,
  normalizeForMatch,
  removeBrackets,
} from '../src/utils/text.js';

describe('removeBrackets', () => {
  it('strips bracketed tags and surrounding whitespace', () => {
    expect(removeBrackets('Heat [1080p] [VF] ')).toBe('Heat');
    expect(removeBrackets('No brackets')).toBe('No brackets');
  });
});

describe('normalizeForMatch', () => {
  it('lowercases, removes accents, punctuation and brackets', () => {
    expect(normalizeForMatch('Zone-Téléchargement [VF]')).toBe('zonetelechargement');
    expect(normalizeForMatch("L'Été meurtrier (1983)")).toBe('letemeurtrier1983');
  });
});

describe('levenshteinDistance', () => {
  it('computes the edit distance', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('getAllowedDistance', () => {
  it('scales with the query length', () => {
    expect(getAllowedDistance(3)).toBe(1);
    expect(getAllowedDistance(8)).toBe(2);
    expect(getAllowedDistance(20)).toBe(4);
  });
});

describe('name matching', () => {
  it('matches series names within the allowed distance only', () => {
    expect(isSeriesNameMatch('Breaking Bad', 'Breaking Bad')).toBe(true);
    expect(isSeriesNameMatch('Breaking Bad', 'Breaking Bàd')).toBe(true);
    expect(isSeriesNameMatch('Breaking Bad', 'Better Call Saul')).toBe(false);
  });

  it('lets a movie query be contained in the found title', () => {
    expect(isMovieNameMatch('Heat', 'Heat (1995)')).toBe(true);
    expect(isMovieNameMatch('Heat', 'Dune')).toBe(false);
  });

  it('dispatches on the content type', () => {
    expect(isNameMatch('Heat', 'Heat 1995', 'movie')).toBe(true);
    // Containment is a movie-only rule
    expect(isNameMatch('Heat', 'Heat 1995 Saison 1', 'series')).toBe(false);
  });
});

describe('title extraction', () => {
  it('extracts the movie name from a listing title', () => {
    expect(extractMovieName('<b>Heat</b> [1080p] - HDLight - MULTI')).toBe('Heat');
  });

  it('extracts the series name and season', () => {
    expect(extractSeriesName('Breaking Bad - Saison 5 - VOSTFR')).toEqual({ seriesName: 'Breaking Bad', season: 5 });
    expect(extractSeriesName('Breaking Bad - VOSTFR')).toEqual({ seriesName: 'Breaking Bad', season: undefined });
    expect(extractSeriesName('Breaking Bad')).toEqual({ seriesName: 'Breaking Bad' });
  });

  it('extractName follows the content type', () => {
    expect(extractName('Heat - 1080p', 'movie')).toEqual({ name: 'Heat' });
    expect(extractName('Dark - Saison 2 - VF', 'series')).toEqual({ name: 'Dark', season: 2 });
  });
});
