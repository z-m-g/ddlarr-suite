import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { cleanDlProtectUrl, isDlProtectLink } from '../src/utils/dlprotect.js';
import { extractLoadixLinkId, isLoadixLink } from '../src/utils/loadix.js';
import { extractLinkFromTorrent, extractNameFromTorrent } from '../src/utils/torrent.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const LINK = 'https://dl-protect.link/abc123';
const NAME = 'Héat.1995.1080p';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-downloader-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeTorrent(file: string, content: string): string {
  const full = path.join(dir, file);
  fs.writeFileSync(full, Buffer.from(content, 'utf8'));
  return full;
}

describe('blackhole torrent parsing', () => {
  const nameBytes = Buffer.byteLength(NAME, 'utf8');
  const withComment = writeTorrent('ddl.torrent', `d7:comment${LINK.length}:${LINK}4:infod4:name${nameBytes}:${NAME}ee`);
  const withUrlList = writeTorrent('urllist.torrent', `d4:infod4:name3:fooe8:url-list${LINK.length}:${LINK}e`);
  const withoutLink = writeTorrent('none.torrent', 'd4:infod4:name3:fooee');

  it('reads the link from the comment, then from url-list', () => {
    expect(extractLinkFromTorrent(withComment)).toBe(LINK);
    expect(extractLinkFromTorrent(withUrlList)).toBe(LINK);
    expect(extractLinkFromTorrent(withoutLink)).toBeNull();
  });

  it('decodes the name as UTF-8 even though offsets are computed in latin1', () => {
    expect(extractNameFromTorrent(withComment)).toBe(NAME);
  });

  it('returns null for a missing file', () => {
    expect(extractLinkFromTorrent(path.join(dir, 'missing.torrent'))).toBeNull();
  });
});

describe('intermediate link detection', () => {
  it('recognises dl-protect and Loadix links', () => {
    expect(isDlProtectLink(LINK)).toBe(true);
    expect(cleanDlProtectUrl(`${LINK}?fn=x`)).toBe(LINK);
    const id = 'b8647072-79a7-4420-b523-5700a79c7091';
    expect(isLoadixLink(`https://api.loadix.fun/api/links/${id}/reveal`)).toBe(true);
    expect(extractLoadixLinkId(`https://api.loadix.fun/api/links/${id}/reveal`)).toBe(id);
  });
});
