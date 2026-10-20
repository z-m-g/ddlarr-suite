import { describe, expect, it } from 'vitest';
import { isCompletePage } from '../src/utils/flaresolverr.js';

describe('isCompletePage', () => {
  it('accepts a full HTML document', () => {
    expect(isCompletePage('<!doctype html><html><head></head><body><p>ok</p></body></html>')).toBe(true);
  });

  it('rejects fragments FlareSolverr sometimes returns as "ok"', () => {
    expect(isCompletePage('<input type="text" name="q">')).toBe(false);
    expect(isCompletePage('<html><body><p>truncated')).toBe(false);
    expect(isCompletePage('')).toBe(false);
    expect(isCompletePage(undefined)).toBe(false);
  });

  it('rejects a page that is still a Cloudflare challenge', () => {
    expect(isCompletePage('<html><head><title>Just a moment...</title></head><body></body></html>')).toBe(false);
  });
});
