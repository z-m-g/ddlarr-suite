import { describe, expect, it } from 'vitest';
import { cleanDlProtectUrl, isDlProtectLink } from '../src/utils/dlprotect.js';
import { normalizeImdbId } from '../src/utils/imdb.js';
import { buildLoadixLink, extractLoadixLinkId, isLoadixLink } from '../src/utils/loadix.js';

describe('dl-protect links', () => {
  it('detects dl-protect on any TLD', () => {
    expect(isDlProtectLink('https://dl-protect.link/abc?fn=foo')).toBe(true);
    expect(isDlProtectLink('https://www.dl-protect.xyz/abc')).toBe(true);
    expect(isDlProtectLink('https://1fichier.com/?abc')).toBe(false);
    expect(isDlProtectLink('not a url')).toBe(false);
  });

  it('strips query parameters from dl-protect links only', () => {
    expect(cleanDlProtectUrl('https://dl-protect.link/abc?fn=foo&rl=a1')).toBe('https://dl-protect.link/abc');
    expect(cleanDlProtectUrl('https://1fichier.com/?abc')).toBe('https://1fichier.com/?abc');
  });
});

describe('normalizeImdbId', () => {
  it('adds the tt prefix when missing', () => {
    expect(normalizeImdbId('0113277')).toBe('tt0113277');
    expect(normalizeImdbId('tt0113277')).toBe('tt0113277');
  });
});

describe('Loadix pseudo links', () => {
  const id = 'b8647072-79a7-4420-b523-5700a79c7091';

  it('builds and recognises the reveal pseudo link', () => {
    const link = buildLoadixLink('https://api.loadix.fun/', id);
    expect(link).toBe(`https://api.loadix.fun/api/links/${id}/reveal`);
    expect(isLoadixLink(link)).toBe(true);
    expect(extractLoadixLinkId(link)).toBe(id);
  });

  it('rejects other hosts and paths', () => {
    expect(isLoadixLink(`https://example.com/api/links/${id}/reveal`)).toBe(false);
    expect(isLoadixLink('https://api.loadix.fun/api/media/123')).toBe(false);
    expect(isLoadixLink('garbage')).toBe(false);
    expect(extractLoadixLinkId('https://api.loadix.fun/api/media/123')).toBeNull();
  });
});
