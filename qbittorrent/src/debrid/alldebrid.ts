import axios from 'axios';
import { getConfig } from '../config.js';
import { DebridService, DebridTorrentStatus, DebridFileInfo } from './base.js';

const ALLDEBRID_API_BASE = 'https://api.alldebrid.com/v4';
const ALLDEBRID_API_V41 = 'https://api.alldebrid.com/v4.1';

interface AllDebridResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface DebridLink {
  link: string;
  filename?: string;
  host?: string;
  filesize?: number;
}

interface MagnetUploadResponse {
  magnets: Array<{
    id: number;
    name: string;
    hash: string;
    ready: boolean;
  }>;
}

interface MagnetUploadFileResponse {
  files: Array<{
    file: string;
    name: string;
    hash: string;
    id: number;
    size: number;
    ready: boolean;
  }>;
}

// v4.1 magnet status response
// When querying by id: magnets is a single object
// When querying all: magnets is an array
interface MagnetStatusResponse {
  magnets: MagnetStatusItem | MagnetStatusItem[];
}

interface MagnetStatusItem {
  id: number;
  filename: string;
  size: number;
  status: string;
  statusCode: number;
  downloaded?: number;
  uploaded?: number;
  seeders?: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  uploadDate: number;
  completionDate: number;
  files?: MagnetFile[];  // Files are included when ready
}

interface MagnetFile {
  n: string;  // filename
  s: number;  // size
  l?: string; // download link (only for files, not folders)
  e?: MagnetFile[]; // nested files/folders
}

/**
 * AllDebrid client for debriding links
 * Documentation: https://docs.alldebrid.com/
 */
export class AllDebridClient implements DebridService {
  readonly name = 'AllDebrid';

  isConfigured(): boolean {
    const config = getConfig().debrid.alldebrid;
    return !!config.apiKey;
  }

  isEnabled(): boolean {
    const config = getConfig().debrid.alldebrid;
    return config.enabled && this.isConfigured();
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().debrid.alldebrid;

    if (!config.apiKey) {
      console.log('[AllDebrid] No API key configured');
      return false;
    }

    try {
      console.log('[AllDebrid] Testing connection...');

      const response = await axios.get<AllDebridResponse<{ user: { username: string; isPremium: boolean } }>>(
        `${ALLDEBRID_API_BASE}/user`,
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
          timeout: 10000,
        }
      );

      if (response.data.status === 'success' && response.data.data?.user) {
        const user = response.data.data.user;
        console.log(`[AllDebrid] Connected as ${user.username}, premium: ${user.isPremium}`);
        return true;
      }

      if (response.data.error) {
        console.error(`[AllDebrid] Error: ${response.data.error.message}`);
      }

      return false;
    } catch (error: any) {
      console.error('[AllDebrid] Connection test failed:', error.message || error);
      return false;
    }
  }

  async debridLink(link: string): Promise<string> {
    const config = getConfig().debrid.alldebrid;

    if (!config.apiKey) {
      throw new Error('AllDebrid not configured');
    }

    console.log(`[AllDebrid] Debriding: ${link}`);

    const formData = new FormData();
    formData.append('link', link);

    const response = await axios.post<AllDebridResponse<DebridLink>>(
      `${ALLDEBRID_API_BASE}/link/unlock`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 30000,
      }
    );

    if (response.data.status === 'success' && response.data.data?.link) {
      console.log(`[AllDebrid] Success: ${response.data.data.link}`);
      return response.data.data.link;
    }

    if (response.data.error) {
      throw new Error(`${response.data.error.message} (${response.data.error.code})`);
    }

    throw new Error('Unknown error');
  }

  supportsTorrents(): boolean {
    return true;
  }

  async uploadTorrent(torrentBuffer: Buffer, filename: string = 'file.torrent'): Promise<string> {
    const config = getConfig().debrid.alldebrid;

    if (!config.apiKey) {
      throw new Error('AllDebrid not configured');
    }

    console.log(`[AllDebrid] Uploading torrent file: ${filename}`);

    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const blob = new Blob([new Uint8Array(torrentBuffer)], { type: 'application/x-bittorrent' });
    formData.append('files[]', blob, filename);

    // Use /magnet/upload/file for torrent files (not /magnet/upload which is for magnet URIs)
    const response = await axios.post<AllDebridResponse<MagnetUploadFileResponse>>(
      `${ALLDEBRID_API_BASE}/magnet/upload/file`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 60000,
      }
    );

    if (response.data.status === 'success' && response.data.data?.files?.[0]) {
      const file = response.data.data.files[0];
      console.log(`[AllDebrid] Torrent uploaded, id: ${file.id}, name: ${file.name}, ready: ${file.ready}`);
      return String(file.id);
    }

    if (response.data.error) {
      throw new Error(`${response.data.error.message} (${response.data.error.code})`);
    }

    throw new Error('Failed to upload torrent');
  }

  async uploadMagnet(magnetUri: string): Promise<string> {
    const config = getConfig().debrid.alldebrid;

    if (!config.apiKey) {
      throw new Error('AllDebrid not configured');
    }

    console.log(`[AllDebrid] Uploading magnet URI`);

    const formData = new FormData();
    formData.append('magnets[]', magnetUri);

    const response = await axios.post<AllDebridResponse<MagnetUploadResponse>>(
      `${ALLDEBRID_API_BASE}/magnet/upload`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 60000,
      }
    );

    if (response.data.status === 'success' && response.data.data?.magnets?.[0]) {
      const magnet = response.data.data.magnets[0];
      console.log(`[AllDebrid] Magnet uploaded, id: ${magnet.id}, name: ${magnet.name}, ready: ${magnet.ready}`);
      return String(magnet.id);
    }

    if (response.data.error) {
      throw new Error(`${response.data.error.message} (${response.data.error.code})`);
    }

    throw new Error('Failed to upload magnet');
  }

  async getTorrentStatus(torrentId: string): Promise<DebridTorrentStatus> {
    const config = getConfig().debrid.alldebrid;

    if (!config.apiKey) {
      throw new Error('AllDebrid not configured');
    }

    // Use v4.1 API for status (POST method)
    const formData = new FormData();
    formData.append('id', torrentId);

    const response = await axios.post<AllDebridResponse<MagnetStatusResponse>>(
      `${ALLDEBRID_API_V41}/magnet/status`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 30000,
      }
    );

    if (process.env.DEBUG === 'true') {
      console.log(`[AllDebrid] Status response:`, JSON.stringify(response.data, null, 2));
    }

    const magnetsData = response.data.data?.magnets;
    if (response.data.status === 'success' && magnetsData) {
      // The API sometimes answers with the whole magnet list instead of the requested
      // one: pick ours by id rather than trusting the first entry
      const wantedId = Number(torrentId);
      const magnet = Array.isArray(magnetsData)
        ? magnetsData.find(m => m.id === wantedId) ?? (magnetsData.length === 1 ? magnetsData[0] : undefined)
        : magnetsData;
      if (!magnet) {
        throw new Error(`Magnet ${torrentId} not found in status response`);
      }
      console.log(`[AllDebrid] Magnet ${magnet.id}: ${magnet.status} (code ${magnet.statusCode}${magnet.size > 0 && magnet.downloaded ? `, ${Math.round((magnet.downloaded / magnet.size) * 100)}%` : ''})`);

      // AllDebrid v4.1 statusCode:
      // 0: In Queue
      // 1: Downloading
      // 2: Compressing/Moving
      // 3: Uploading
      // 4: Ready
      // 5-15: Error states

      let status: DebridTorrentStatus['status'];
      let progress = 0;

      if (magnet.statusCode === 0) {
        status = 'queued';
      } else if (magnet.statusCode >= 1 && magnet.statusCode <= 3) {
        status = 'downloading';
        if (magnet.size > 0 && magnet.downloaded) {
          progress = Math.round((magnet.downloaded / magnet.size) * 100);
        }
      } else if (magnet.statusCode === 4) {
        status = 'ready';
        progress = 100;
      } else {
        status = 'error';
      }

      const result: DebridTorrentStatus = {
        id: torrentId,
        name: magnet.filename || undefined,
        status,
        progress,
        totalSize: magnet.size,
      };

      // Files are included in the status response when ready
      // Links need to be unlocked via /link/unlock to get actual download URLs
      if (status === 'ready' && magnet.files && magnet.files.length > 0) {
        const rawLinks = this.extractLinksFromFiles(magnet.files);
        const unlockedLinks: string[] = [];

        for (const link of rawLinks) {
          try {
            const unlocked = await this.debridLink(link);
            unlockedLinks.push(unlocked);
          } catch (error: any) {
            console.error(`[AllDebrid] Failed to unlock link ${link}: ${error.message}`);
          }
        }

        if (unlockedLinks.length > 0) {
          result.downloadLinks = unlockedLinks;
        }
      }

      if (status === 'error') {
        result.errorMessage = magnet.status || 'Unknown error';
      }

      return result;
    }

    if (response.data.error) {
      return {
        id: torrentId,
        status: 'error',
        progress: 0,
        errorMessage: response.data.error.message,
      };
    }

    throw new Error('Failed to get torrent status');
  }

  /**
   * Extract download links from files array (recursive for nested folders)
   */
  private extractLinksFromFiles(files: MagnetFile[]): string[] {
    const links: string[] = [];

    const extractLinks = (fileList: MagnetFile[]) => {
      for (const file of fileList) {
        if (file.l) {
          links.push(file.l);
        }
        if (file.e) {
          extractLinks(file.e);
        }
      }
    };

    extractLinks(files);
    return links;
  }
}
