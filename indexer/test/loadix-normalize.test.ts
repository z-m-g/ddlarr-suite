import { describe, expect, it } from 'vitest';
import { normalizeLoadixLanguage, normalizeLoadixQuality } from '../src/scrapers/loadix.js';

describe('normalizeLoadixQuality', () => {
  it.each([
    ['HDLight 1080p (x265)', '1080p.HDLight.x265'],
    ['HDLight 720p', '720p.HDLight'],
    ['Ultra HDLight (x265)', '2160p.HDLight.x265'],
    ['ULTRA HD (x265)', '2160p.x265'],
    ['REMUX UHD', '2160p.BluRay.REMUX'],
    ['REMUX BLURAY', '1080p.BluRay.REMUX'],
    ['ISO 4K', '2160p.BluRay.ISO'],
    ['Full ISO 1080p', '1080p.BluRay.ISO'],
    ['Blu-Ray 1080p (x265)', '1080p.BluRay.x265'],
    ['Blu-Ray 720p', '720p.BluRay'],
    ['WEB 1080p', '1080p.WEB-DL'],
    ['WEB-DL', 'WEB-DL'],
    ['WEB', 'WEB-DL'],
    ['WEBRIP', 'WEBRip'],
    ['4K', '2160p.WEB-DL'],
    ['4K HDR', '2160p.HDR'],
    ['UHD', '2160p.BluRay'],
    ['HDTV 720p', '720p.HDTV'],
    ['DVDRIP MKV', 'DVDRip'],
    ['DVD-R', 'DVD-R'],
    ['CAM', 'CAM'],
    ['HD 1080p', '1080p'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeLoadixQuality(raw)).toBe(expected);
  });

  it('keeps unknown labels in dotted form and ignores empty values', () => {
    expect(normalizeLoadixQuality('Some (odd) label')).toBe('Some.odd.label');
    expect(normalizeLoadixQuality(null)).toBeUndefined();
    expect(normalizeLoadixQuality('')).toBeUndefined();
  });
});

describe('normalizeLoadixLanguage', () => {
  it('dots multi-word labels and uppercases MULTi', () => {
    expect(normalizeLoadixLanguage('MULTi TRUEFRENCH')).toBe('MULTI.TRUEFRENCH');
    expect(normalizeLoadixLanguage('VFF+VOSTFR')).toBe('VFF.VOSTFR');
    expect(normalizeLoadixLanguage('VOSTFR')).toBe('VOSTFR');
    expect(normalizeLoadixLanguage(undefined)).toBeUndefined();
  });
});
