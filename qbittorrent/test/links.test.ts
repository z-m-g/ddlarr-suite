import { describe, expect, it } from 'vitest';
import { isBookysLink } from '../src/utils/bookys.js';
import { cleanDlProtectUrl, isDlProtectLink } from '../src/utils/dlprotect.js';
import { extractLoadixLinkId, isLoadixLink } from '../src/utils/loadix.js';

describe('intermediate link detection', () => {
  it('recognises Bookys /dl/ pages', () => {
    expect(isBookysLink('https://www7.bookys-ebooks.com/journaux/123/dl/456')).toBe(true);
    expect(isBookysLink('https://www7.bookys-ebooks.com/journaux/123')).toBe(false);
    expect(isBookysLink('https://1fichier.com/?abc')).toBe(false);
  });

  it('recognises dl-protect links and strips their query string', () => {
    expect(isDlProtectLink('https://dl-protect.link/abc?fn=x')).toBe(true);
    expect(cleanDlProtectUrl('https://dl-protect.link/abc?fn=x')).toBe('https://dl-protect.link/abc');
    expect(isDlProtectLink('https://1fichier.com/?abc')).toBe(false);
  });

  it('recognises Loadix pseudo links', () => {
    const id = 'b8647072-79a7-4420-b523-5700a79c7091';
    expect(isLoadixLink(`https://api.loadix.fun/api/links/${id}/reveal`)).toBe(true);
    expect(extractLoadixLinkId(`https://api.loadix.fun/api/links/${id}/reveal`)).toBe(id);
    expect(isLoadixLink('https://loadix.fun/media/123')).toBe(false);
  });
});
