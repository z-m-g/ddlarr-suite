import * as crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  analyzeTorrent,
  computeInfoHash,
  extractCreatedByFromTorrentBuffer,
  extractFilesFromTorrentBuffer,
  extractLinkFromTorrentBuffer,
  extractNameFromTorrentBuffer,
  extractSizeFromTorrentBuffer,
} from '../src/utils/torrent.js';
import { bencode } from './bencode-helper.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const LINK = 'https://api.loadix.fun/api/links/b8647072-79a7-4420-b523-5700a79c7091/reveal';

const ddlInfo = { length: 1024, name: 'Héat.1995.1080p', 'piece length': 1024, pieces: Buffer.alloc(20, 1) };
const ddlTorrent = bencode({
  announce: 'http://tracker.fake/announce',
  comment: LINK,
  'created by': 'DDL-Torznab',
  'creation date': 1760000000,
  info: ddlInfo,
  'url-list': LINK,
});

const realInfo = {
  files: [
    { length: 700, path: ['Season 1', 'épisode.01.mkv'] },
    { length: 300, path: ['Season 1', 'episode.02.mkv'], attr: 'p' },
  ],
  name: 'Some.Show.S01',
  'piece length': 16384,
  pieces: Buffer.alloc(20, 2),
};
const realTorrent = bencode({ announce: 'http://tracker/announce', 'created by': 'qBittorrent', info: realInfo });

describe('fake DDL torrents', () => {
  it('reads the fields written by the indexer', () => {
    expect(extractCreatedByFromTorrentBuffer(ddlTorrent)).toBe('DDL-Torznab');
    expect(extractNameFromTorrentBuffer(ddlTorrent)).toBe('Héat.1995.1080p');
    expect(extractSizeFromTorrentBuffer(ddlTorrent)).toBe(1024);
    expect(extractLinkFromTorrentBuffer(ddlTorrent)).toBe(LINK);
  });

  it('computes the info hash over the exact info dictionary bytes', () => {
    const expected = crypto.createHash('sha1').update(bencode(ddlInfo)).digest('hex').toUpperCase();
    expect(computeInfoHash(ddlTorrent)).toBe(expected);
    expect(computeInfoHash(Buffer.from('d3:fooi1ee'))).toBeNull();
  });

  it('analyzes a DDL torrent as such', () => {
    expect(analyzeTorrent(ddlTorrent)).toEqual({
      type: 'ddl',
      name: 'Héat.1995.1080p',
      size: 1024,
      infoHash: computeInfoHash(ddlTorrent),
      ddlLink: LINK,
    });
  });

  it('falls back to url-list when there is no comment', () => {
    const noComment = bencode({ info: ddlInfo, 'url-list': LINK });
    expect(extractLinkFromTorrentBuffer(noComment)).toBe(LINK);
    expect(extractLinkFromTorrentBuffer(bencode({ info: ddlInfo }))).toBeNull();
  });
});

describe('real torrents', () => {
  it('analyzes a multi-file torrent as real and lists its files', () => {
    const analysis = analyzeTorrent(realTorrent);
    expect(analysis?.type).toBe('real');
    expect(analysis?.name).toBe('Some.Show.S01');
    expect(analysis?.ddlLink).toBeUndefined();

    expect(extractFilesFromTorrentBuffer(realTorrent)).toEqual([
      { path: 'Season 1/épisode.01.mkv', size: 700 },
      { path: 'Season 1/episode.02.mkv', size: 300 },
    ]);
  });

  it('lists a single-file torrent as one entry', () => {
    expect(extractFilesFromTorrentBuffer(ddlTorrent)).toEqual([{ path: 'Héat.1995.1080p', size: 1024 }]);
  });

  it('returns null for garbage', () => {
    expect(analyzeTorrent(Buffer.from('not a torrent'))).toBeNull();
  });
});
