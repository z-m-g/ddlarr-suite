import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { downloadManager } from '../services/download-manager.js';
import { getConfig } from '../config.js';
import type { Download, DownloadState } from '../types/download.js';
import type { QBTorrentInfo, QBTorrentState, QBTorrentProperties } from '../types/qbittorrent.js';

// Map internal states to qBittorrent states
function mapState(state: DownloadState): QBTorrentState {
  switch (state) {
    case 'queued': return 'queuedDL';
    case 'checking': return 'checkingDL';
    case 'downloading': return 'downloading';
    case 'paused': return 'pausedDL';
    case 'completed': return 'uploading'; // qBittorrent shows "uploading" when seeding
    case 'error': return 'error';
    case 'stalled': return 'stalledDL';
    default: return 'unknown';
  }
}

// Convert internal Download to qBittorrent format
function toQBTorrentInfo(download: Download): QBTorrentInfo {
  // Force 100% progress when completed, regardless of byte counts
  const progress = download.state === 'completed'
    ? 1.0
    : (download.totalSize > 0 ? download.downloadedSize / download.totalSize : 0);

  const eta = download.state === 'completed'
    ? 0
    : (download.downloadSpeed > 0 && download.totalSize > 0
      ? Math.ceil((download.totalSize - download.downloadedSize) / download.downloadSpeed)
      : 8640000); // Infinity

  // Use totalSize for completed downloads if downloadedSize is incomplete
  const effectiveDownloaded = download.state === 'completed' && download.totalSize > 0
    ? download.totalSize
    : download.downloadedSize;

  return {
    hash: download.hash,
    name: download.name,
    size: download.totalSize,
    progress,
    dlspeed: download.downloadSpeed,
    upspeed: 0,
    priority: download.priority,
    num_seeds: 0,
    num_complete: 0,
    num_leechs: 0,
    num_incomplete: 0,
    ratio: 0,
    eta,
    state: mapState(download.state),
    seq_dl: false,
    f_l_piece_prio: false,
    category: download.category || '',
    tags: '',
    super_seeding: false,
    force_start: false,
    save_path: download.savePath,
    added_on: Math.floor(download.addedAt / 1000),
    completion_on: download.completedAt ? Math.floor(download.completedAt / 1000) : -1,
    tracker: '',
    dl_limit: 0,
    up_limit: 0,
    downloaded: effectiveDownloaded,
    uploaded: 0,
    downloaded_session: effectiveDownloaded,
    uploaded_session: 0,
    amount_left: download.state === 'completed' ? 0 : download.totalSize - download.downloadedSize,
    completed: effectiveDownloaded,
    ratio_limit: -2,
    seen_complete: download.completedAt ? Math.floor(download.completedAt / 1000) : -1,
    last_activity: Math.floor(Date.now() / 1000),
    total_size: download.totalSize,
    time_active: download.startedAt
      ? Math.floor((Date.now() - download.startedAt) / 1000)
      : 0,
    seeding_time: 0,
    content_path: `${download.savePath}/${download.name}`,
    magnet_uri: '',
    // Custom fields for DDL-qBittorrent UI
    status_message: download.statusMessage || undefined,
    error_message: download.errorMessage || undefined,
  };
}

export async function torrentsRoutes(fastify: FastifyInstance): Promise<void> {
  // Get torrent list
  fastify.get('/api/v2/torrents/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      filter?: string;
      category?: string;
      hashes?: string;
      sort?: string;
      reverse?: string;
      limit?: string;
      offset?: string;
    };

    let downloads = downloadManager.getAll();

    // Filter by state
    if (query.filter && query.filter !== 'all') {
      downloads = downloads.filter(d => {
        switch (query.filter) {
          case 'downloading': return d.state === 'downloading';
          case 'seeding': return d.state === 'completed';
          case 'completed': return d.state === 'completed';
          case 'paused': return d.state === 'paused';
          case 'active': return d.state === 'downloading';
          case 'inactive': return d.state !== 'downloading';
          case 'resumed': return d.state !== 'paused';
          case 'stalled': return d.state === 'stalled';
          case 'stalled_downloading': return d.state === 'stalled';
          case 'errored': return d.state === 'error';
          default: return true;
        }
      });
    }

    // Filter by category
    if (query.category) {
      downloads = downloads.filter(d => d.category === query.category);
    }

    // Filter by hashes
    if (query.hashes) {
      const hashList = query.hashes.split('|');
      downloads = downloads.filter(d => hashList.includes(d.hash));
    }

    // Sort
    if (query.sort) {
      const sortField = query.sort as keyof Download;
      const reverse = query.reverse === 'true';
      downloads.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        if (aVal < bVal) return reverse ? 1 : -1;
        if (aVal > bVal) return reverse ? -1 : 1;
        return 0;
      });
    }

    // Pagination
    if (query.offset) {
      const offset = parseInt(query.offset, 10);
      downloads = downloads.slice(offset);
    }
    if (query.limit) {
      const limit = parseInt(query.limit, 10);
      downloads = downloads.slice(0, limit);
    }

    const result = downloads.map(toQBTorrentInfo);
    return reply.send(result);
  });

  // Get torrent properties
  fastify.get('/api/v2/torrents/properties', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { hash?: string };
    if (!query.hash) {
      return reply.status(400).send('Missing hash');
    }

    const download = downloadManager.getByHash(query.hash);
    if (!download) {
      return reply.status(404).send('Not found');
    }

    const eta = download.downloadSpeed > 0 && download.totalSize > 0
      ? Math.ceil((download.totalSize - download.downloadedSize) / download.downloadSpeed)
      : 8640000;

    const properties: QBTorrentProperties = {
      hash: download.hash,
      name: download.name,
      save_path: download.savePath,
      creation_date: Math.floor(download.addedAt / 1000),
      piece_size: 0,
      comment: download.originalLink,
      total_wasted: 0,
      total_uploaded: 0,
      total_uploaded_session: 0,
      total_downloaded: download.downloadedSize,
      total_downloaded_session: download.downloadedSize,
      up_limit: 0,
      dl_limit: 0,
      time_elapsed: download.startedAt
        ? Math.floor((Date.now() - download.startedAt) / 1000)
        : 0,
      seeding_time: 0,
      nb_connections: 0,
      nb_connections_limit: 0,
      share_ratio: 0,
      addition_date: Math.floor(download.addedAt / 1000),
      completion_date: download.completedAt ? Math.floor(download.completedAt / 1000) : -1,
      created_by: 'DDL-qBittorrent',
      dl_speed_avg: download.downloadSpeed,
      dl_speed: download.downloadSpeed,
      eta,
      last_seen: Math.floor(Date.now() / 1000),
      peers: 0,
      peers_total: 0,
      pieces_have: 0,
      pieces_num: 0,
      reannounce: 0,
      seeds: 0,
      seeds_total: 0,
      total_size: download.totalSize,
      up_speed_avg: 0,
      up_speed: 0,
    };

    return reply.send(properties);
  });

  // Add torrent
  fastify.post('/api/v2/torrents/add', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parts = request.parts();
      const torrents: Buffer[] = [];
      let urls = '';
      let savepath: string | undefined = undefined;  // Don't default - let download-manager handle category path
      let category = '';
      let paused = false;

      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'torrents') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          torrents.push(Buffer.concat(chunks));
        } else if (part.type === 'field') {
          switch (part.fieldname) {
            case 'urls':
              urls = part.value as string;
              break;
            case 'savepath':
              savepath = part.value as string;
              break;
            case 'category':
              category = part.value as string;
              break;
            case 'paused':
              paused = part.value === 'true';
              break;
          }
        }
      }

      // Process torrent files
      for (const torrentData of torrents) {
        await downloadManager.addTorrent(torrentData, {
          savePath: savepath,
          category,
          paused,
        });
      }

      // Process URLs
      if (urls) {
        const urlList = urls.split('\n').filter(u => u.trim());
        for (const url of urlList) {
          await downloadManager.addUrl(url.trim(), {
            savePath: savepath,
            category,
            paused,
          });
        }
      }

      return reply.send('Ok.');
    } catch (error: any) {
      console.error('[Torrents] Add error:', error.message);
      return reply.status(415).send('Fails.');
    }
  });

  // Pause torrents
  fastify.post('/api/v2/torrents/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { hashes?: string };
    const hashesParam = body.hashes || '';

    let hashes: string[];
    if (hashesParam === 'all') {
      hashes = downloadManager.getAll().map(d => d.hash);
    } else {
      hashes = hashesParam.split('|').filter(h => h);
    }

    downloadManager.pause(hashes);
    return reply.send();
  });

  // Resume torrents
  fastify.post('/api/v2/torrents/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { hashes?: string };
    const hashesParam = body.hashes || '';

    let hashes: string[];
    if (hashesParam === 'all') {
      hashes = downloadManager.getAll().map(d => d.hash);
    } else {
      hashes = hashesParam.split('|').filter(h => h);
    }

    downloadManager.resume(hashes);
    return reply.send();
  });

  // Delete torrents
  fastify.post('/api/v2/torrents/delete', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { hashes?: string; deleteFiles?: string };
    const hashesParam = body.hashes || '';
    const deleteFiles = body.deleteFiles === 'true';

    let hashes: string[];
    if (hashesParam === 'all') {
      hashes = downloadManager.getAll().map(d => d.hash);
    } else {
      hashes = hashesParam.split('|').filter(h => h);
    }

    await downloadManager.delete(hashes, deleteFiles);
    return reply.send();
  });

  // Get torrent files
  fastify.get('/api/v2/torrents/files', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { hash?: string };
    if (!query.hash) {
      return reply.status(400).send('Missing hash');
    }

    const download = downloadManager.getByHash(query.hash);
    if (!download) {
      return reply.status(404).send('Not found');
    }

    // DDL downloads typically have a single file
    return reply.send([{
      index: 0,
      name: download.name,
      size: download.totalSize,
      progress: download.totalSize > 0
        ? download.downloadedSize / download.totalSize
        : (download.state === 'completed' ? 1 : 0),
      priority: 1,
      is_seed: false,
      piece_range: [0, 0],
      availability: 1,
    }]);
  });

  // Store created categories in memory (persists until restart)
  const createdCategories: Map<string, string> = new Map();

  // Get categories
  fastify.get('/api/v2/torrents/categories', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();

    // Get all unique categories from downloads
    const downloads = downloadManager.getAll();
    const categoriesFromDownloads = new Set(downloads.map(d => d.category).filter(c => c));

    // Build categories object in qBittorrent format
    const categories: Record<string, { name: string; savePath: string }> = {};

    // Add categories from existing downloads
    for (const cat of categoriesFromDownloads) {
      if (cat) {
        categories[cat] = {
          name: cat,
          savePath: `${config.downloadPath}/${cat}`,
        };
      }
    }

    // Add categories that were explicitly created
    for (const [cat, savePath] of createdCategories) {
      if (!categories[cat]) {
        categories[cat] = {
          name: cat,
          savePath: savePath || `${config.downloadPath}/${cat}`,
        };
      }
    }

    return reply.send(categories);
  });

  // Create category - accepts any category name and creates the folder
  fastify.post('/api/v2/torrents/createCategory', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { category?: string; savePath?: string };
    const config = getConfig();
    const fs = await import('fs');

    if (body.category) {
      const savePath = body.savePath || `${config.downloadPath}/${body.category}`;
      createdCategories.set(body.category, savePath);

      // Create the directory if it doesn't exist
      try {
        if (!fs.existsSync(savePath)) {
          fs.mkdirSync(savePath, { recursive: true });
          console.log(`[Torrents] Created category folder: ${savePath}`);
        }
      } catch (error: any) {
        console.error(`[Torrents] Failed to create category folder: ${error.message}`);
      }

      console.log(`[Torrents] Created category: ${body.category} -> ${savePath}`);
    }

    return reply.send();
  });

  // Set category
  fastify.post('/api/v2/torrents/setCategory', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { hashes?: string; category?: string };
    console.log(`[Torrents] Set category: ${body.category} for hashes: ${body.hashes}`);
    // For now, we don't persist category changes after creation
    return reply.send();
  });
}
