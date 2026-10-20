import { describe, expect, it } from 'vitest';
import { extractLinkFromTorrent, generateFakeTorrent } from '../src/utils/torrent.js';

describe('generateFakeTorrent', () => {
  const link = 'https://1fichier.com/?abc123&af=456';
  const torrent = generateFakeTorrent({ name: 'Heat.1995.1080p', link, size: 123 });

  it('produces a bencoded dictionary tagged as DDL-Torznab', () => {
    const text = torrent.toString('latin1');
    expect(text.startsWith('d8:announce')).toBe(true);
    expect(text).toContain('10:created by11:DDL-Torznab');
    expect(text).toContain('4:name15:Heat.1995.1080p');
    expect(text.endsWith('e')).toBe(true);
  });

  it('stores the DDL link in the comment and as a web seed', () => {
    const text = torrent.toString('latin1');
    expect(text).toContain(`7:comment${link.length}:${link}`);
    expect(text).toContain(`8:url-list${link.length}:${link}`);
  });

  it('round-trips the link through extractLinkFromTorrent', () => {
    expect(extractLinkFromTorrent(torrent.toString('latin1'))).toBe(link);
  });

  it('returns null when there is no comment', () => {
    expect(extractLinkFromTorrent('d4:infod4:name3:fooee')).toBeNull();
  });
});
