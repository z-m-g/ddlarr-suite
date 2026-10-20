import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Download } from '../src/types/download.js';

const { fakeManager, dataPath } = vi.hoisted(() => {
  const dataPath = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ddl-qb-test-'));
  process.env.DATA_PATH = dataPath;
  process.env.DOWNLOAD_PATH = '/downloads';
  process.env.QB_USERNAME = 'tester';
  process.env.QB_PASSWORD = 'secret';
  const downloads: Download[] = [];
  const fakeManager = {
    downloads,
    getAll: () => downloads,
    getByHash: (hash: string) => downloads.find(d => d.hash === hash) || null,
    addTorrent: vi.fn(async () => 'HASH'),
    addUrl: vi.fn(async () => 'HASH'),
    delete: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
    forceStart: vi.fn(),
  };
  return { fakeManager, dataPath };
});

vi.mock('../src/services/download-manager.js', () => ({ downloadManager: fakeManager }));

import { buildApp } from '../src/app.js';

function download(overrides: Partial<Download>): Download {
  return {
    hash: 'ABC123',
    name: 'Heat.1995.1080p',
    type: 'ddl',
    originalLink: 'https://1fichier.com/?abc',
    debridedLink: null,
    debridTorrentId: null,
    savePath: '/downloads/radarr',
    totalSize: 1000,
    downloadedSize: 250,
    downloadSpeed: 50,
    state: 'downloading',
    statusMessage: null,
    errorMessage: null,
    addedAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    completedAt: null,
    category: 'radarr',
    priority: 0,
    ...overrides,
  };
}

let app: FastifyInstance;
let sid: string;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  app = await buildApp();
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: 'username=tester&password=secret', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  sid = login.cookies.find(c => c.name === 'SID')!.value;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataPath, { recursive: true, force: true });
});

beforeEach(() => {
  fakeManager.downloads.length = 0;
  fakeManager.addTorrent.mockClear();
  fakeManager.addUrl.mockClear();
  fakeManager.delete.mockClear();
});

const authed = (opts: { method?: 'GET' | 'POST'; url: string; payload?: string | Buffer; headers?: Record<string, string> }) =>
  app.inject({ method: opts.method || 'GET', url: opts.url, payload: opts.payload, headers: { cookie: `SID=${sid}`, ...(opts.headers || {}) } });

describe('authentication', () => {
  it('answers like qBittorrent and sets the SID cookie', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: 'username=tester&password=secret', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(ok.body).toBe('Ok.');
    expect(ok.cookies.find(c => c.name === 'SID')).toMatchObject({ httpOnly: true, path: '/' });

    const ko = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: 'username=tester&password=nope', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(ko.body).toBe('Fails.');
    expect(ko.cookies).toHaveLength(0);
  });

  it('protects the API but not the health check or the UI', async () => {
    expect((await app.inject({ url: '/api/v2/app/version' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v2/app/version', headers: { cookie: 'SID=bogus' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ url: '/some/spa/route' })).statusCode).toBe(200);
    expect((await authed({ url: '/api/v2/app/version' })).body).toBe('v4.6.0');
  });
});

describe('app endpoints', () => {
  it('exposes preferences derived from the configuration', async () => {
    const prefs = (await authed({ url: '/api/v2/app/preferences' })).json();
    expect(prefs).toMatchObject({ save_path: '/downloads', web_ui_username: 'tester', max_active_downloads: 3 });
    expect((await authed({ url: '/api/v2/app/webapiVersion' })).body).toBe('2.9.3');
  });
});

describe('torrents', () => {
  it('maps downloads to the qBittorrent torrent list', async () => {
    fakeManager.downloads.push(
      download({ hash: 'AAA', state: 'downloading' }),
      download({ hash: 'BBB', state: 'completed', completedAt: 1_700_000_100_000, downloadedSize: 900 }),
      download({ hash: 'CCC', state: 'error', errorMessage: 'Debrid failed' }),
    );
    const list = (await authed({ url: '/api/v2/torrents/info' })).json() as Array<Record<string, unknown>>;
    expect(list.map(t => [t.hash, t.state])).toEqual([['AAA', 'downloading'], ['BBB', 'stoppedUP'], ['CCC', 'error']]);
    expect(list[0]).toMatchObject({ progress: 0.25, dlspeed: 50, eta: 15, category: 'radarr', save_path: '/downloads/radarr' });
    // Completed downloads report 100%, no remaining bytes and a ratio Sonarr/Radarr consider satisfied
    expect(list[1]).toMatchObject({ progress: 1, amount_left: 0, downloaded: 1000, ratio: 999, completion_on: 1_700_000_100 });
    expect(list[2].tracker).toBe('DDL Error: Debrid failed');
  });

  it('filters the list by hashes and by state', async () => {
    fakeManager.downloads.push(download({ hash: 'AAA', state: 'downloading' }), download({ hash: 'BBB', state: 'completed' }));
    expect(((await authed({ url: '/api/v2/torrents/info?hashes=bbb' })).json() as Array<{ hash: string }>).map(t => t.hash)).toEqual(['BBB']);
    expect(((await authed({ url: '/api/v2/torrents/info?filter=completed' })).json() as Array<{ hash: string }>).map(t => t.hash)).toEqual(['BBB']);
  });

  it('looks up properties case-insensitively', async () => {
    fakeManager.downloads.push(download({ hash: 'ABC123' }));
    const res = await authed({ url: '/api/v2/torrents/properties?hash=abc123' });
    expect(res.json()).toMatchObject({ hash: 'ABC123', comment: 'https://1fichier.com/?abc', save_path: '/downloads/radarr' });
    expect((await authed({ url: '/api/v2/torrents/properties?hash=nope' })).statusCode).toBe(404);
    expect((await authed({ url: '/api/v2/torrents/properties' })).statusCode).toBe(400);
  });

  it('accepts a torrent file upload with its category', async () => {
    const boundary = 'ddlboundary';
    const torrent = Buffer.from('d4:infod4:name4:testee');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nradarr\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="paused"\r\n\r\nfalse\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="heat.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n`),
      torrent,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await authed({ method: 'POST', url: '/api/v2/torrents/add', payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(res.body).toBe('Ok.');
    expect(fakeManager.addTorrent).toHaveBeenCalledTimes(1);
    expect(fakeManager.addTorrent.mock.calls[0][0]).toEqual(torrent);
    expect(fakeManager.addTorrent.mock.calls[0][1]).toEqual({ savePath: undefined, category: 'radarr', paused: false });
  });

  it('accepts URLs as a form, one per line', async () => {
    const res = await authed({
      method: 'POST', url: '/api/v2/torrents/add',
      payload: 'urls=https%3A%2F%2Fa%2F1.torrent%0Ahttps%3A%2F%2Fa%2F2.torrent&category=sonarr&paused=true',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.body).toBe('Ok.');
    expect(fakeManager.addUrl.mock.calls.map(c => c[0])).toEqual(['https://a/1.torrent', 'https://a/2.torrent']);
    expect(fakeManager.addUrl.mock.calls[0][1]).toEqual({ savePath: undefined, category: 'sonarr', paused: true });
  });

  it('deletes by hash list or all, normalising the case', async () => {
    fakeManager.downloads.push(download({ hash: 'AAA' }), download({ hash: 'BBB' }));
    await authed({ method: 'POST', url: '/api/v2/torrents/delete', payload: 'hashes=aaa%7Cbbb&deleteFiles=true', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(fakeManager.delete).toHaveBeenCalledWith(['AAA', 'BBB'], true);
    await authed({ method: 'POST', url: '/api/v2/torrents/delete', payload: 'hashes=all', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(fakeManager.delete).toHaveBeenLastCalledWith(['AAA', 'BBB'], false);
  });
});
