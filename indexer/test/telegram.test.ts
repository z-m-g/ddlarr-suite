import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchHtml } from '../src/utils/http.js';
import { fetchSiteUrlFromTelegram, getDefaultTelegramChannel, getSiteUrlFromTelegram } from '../src/utils/telegram.js';

vi.mock('../src/utils/http.js', () => ({ fetchHtml: vi.fn() }));

beforeEach(() => {
  vi.mocked(fetchHtml).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Telegram site URL detection', () => {
  it('builds the site URL from the channel og:title', async () => {
    vi.mocked(fetchHtml).mockResolvedValue('<html><head><meta property="og:title" content="Wawacity.IRISH"></head></html>');
    await expect(fetchSiteUrlFromTelegram('https://t.me/s/Wawacityofficiel', 'wawacity')).resolves.toBe('https://www.wawacity.irish/');
  });

  it('returns null when the title is missing or is not a domain', async () => {
    vi.mocked(fetchHtml).mockResolvedValueOnce('<html><head><title>Telegram</title></head></html>');
    await expect(fetchSiteUrlFromTelegram('https://t.me/x', 'wawacity')).resolves.toBeNull();
    vi.mocked(fetchHtml).mockResolvedValueOnce('<meta property="og:title" content="Wawacity">');
    await expect(fetchSiteUrlFromTelegram('https://t.me/x', 'wawacity')).resolves.toBeNull();
  });

  it('returns null instead of throwing when Telegram is unreachable', async () => {
    vi.mocked(fetchHtml).mockRejectedValue(new Error('timeout'));
    await expect(fetchSiteUrlFromTelegram('https://t.me/x', 'wawacity')).resolves.toBeNull();
  });

  it('uses the default channel of each site unless one is given', async () => {
    vi.mocked(fetchHtml).mockResolvedValue('<meta property="og:title" content="zone-telechargement.fitness">');
    await getSiteUrlFromTelegram('zonetelecharger');
    expect(vi.mocked(fetchHtml).mock.calls[0][0]).toBe(getDefaultTelegramChannel('zonetelecharger'));
    await getSiteUrlFromTelegram('zonetelecharger', 'https://t.me/custom');
    expect(vi.mocked(fetchHtml).mock.calls[1][0]).toBe('https://t.me/custom');
  });
});
