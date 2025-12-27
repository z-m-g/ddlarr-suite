import axios from 'axios';
import { DownloadClient } from './base.js';
import { getConfig } from '../utils/config.js';

// Type definitions for the JDownloader library
interface MyJDDevice {
  id: string;
  type: string;
  name: string;
  status: string;
}

interface MyJDDevicesResponse {
  list: MyJDDevice[];
  rid: number;
}

interface MyJDClient {
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  listDevices(): Promise<MyJDDevicesResponse>;
  linkgrabberV2: {
    addLinks(deviceId: string, links: string[], options?: { packageName?: string; autostart?: boolean }): Promise<void>;
  };
}

// Dynamic import workaround for ESM/CJS interop
async function createMyJDClient(email: string, password: string): Promise<MyJDClient> {
  const mod = await import('myjdownloader');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const JDownloader = (mod as any).default;
  return new JDownloader(email, password) as MyJDClient;
}

/**
 * JDownloader client via MyJDownloader API or local API
 */
export class JDownloaderClient implements DownloadClient {
  name = 'JDownloader';

  isEnabled(): boolean {
    const config = getConfig().jdownloader;
    if (!config.enabled) return false;

    const mode = config.apiMode || 'auto';
    const hasLocal = !!config.localHost;
    const hasRemote = !!config.email && !!config.password && !!config.deviceName;

    if (mode === 'local') return hasLocal;
    if (mode === 'remote') return hasRemote;
    return hasLocal || hasRemote; // auto mode
  }

  private canUseLocalApi(): boolean {
    const config = getConfig().jdownloader;
    const mode = config.apiMode || 'auto';
    return (mode === 'local' || mode === 'auto') && !!config.localHost;
  }

  private canUseRemoteApi(): boolean {
    const config = getConfig().jdownloader;
    const mode = config.apiMode || 'auto';
    return (mode === 'remote' || mode === 'auto') &&
           !!config.email && !!config.password && !!config.deviceName;
  }

  // ==================== Test Connection ====================

  async testConnection(): Promise<boolean> {
    const config = getConfig().jdownloader;
    const mode = config.apiMode || 'auto';
    console.log('[JDownloader] Testing connection...');
    console.log(`[JDownloader] Config: mode=${mode}, localHost=${config.localHost || 'N/A'}, localPort=${config.localPort}, email=${config.email || 'N/A'}, device=${config.deviceName || 'N/A'}`);

    const canLocal = this.canUseLocalApi();
    const canRemote = this.canUseRemoteApi();

    if (!canLocal && !canRemote) {
      console.log('[JDownloader] Missing required fields for the selected mode');
      return false;
    }

    // Test based on mode
    if (mode === 'local') {
      console.log('[JDownloader] Testing local API only...');
      return await this.testLocalConnection();
    }

    if (mode === 'remote') {
      console.log('[JDownloader] Testing MyJDownloader API only...');
      return await this.testMyJDownloaderConnection();
    }

    // Auto mode: try local first, then remote
    if (canLocal) {
      console.log('[JDownloader] Testing local API...');
      const localResult = await this.testLocalConnection();
      if (localResult) return true;
      console.log('[JDownloader] Local API failed, trying MyJDownloader...');
    }

    if (canRemote) {
      console.log('[JDownloader] Testing MyJDownloader API...');
      return await this.testMyJDownloaderConnection();
    }

    return false;
  }

  private async testLocalConnection(): Promise<boolean> {
    const config = getConfig().jdownloader;
    const baseUrl = `http://${config.localHost}:${config.localPort}`;
    console.log(`[JDownloader] Testing local API at ${baseUrl}`);

    try {
      const response = await axios.get(`${baseUrl}/jdcheck.js`, { timeout: 5000 });
      console.log('[JDownloader] Local API OK');
      return true;
    } catch {
      try {
        await axios.post(
          `${baseUrl}/linkgrabberv2/queryLinks`,
          { params: [] },
          { timeout: 5000, headers: { 'Content-Type': 'application/json' } }
        );
        console.log('[JDownloader] Local API v2 OK');
        return true;
      } catch (error: any) {
        console.error('[JDownloader] Local API error:', error.message);
        return false;
      }
    }
  }

  private async testMyJDownloaderConnection(): Promise<boolean> {
    const config = getConfig().jdownloader;

    if (!config.email || !config.password || !config.deviceName) {
      console.log('[JDownloader] MyJD: Missing credentials');
      return false;
    }

    try {
      console.log('[JDownloader] MyJD: Connecting...');
      const client = await createMyJDClient(config.email, config.password);
      await client.connect();
      console.log('[JDownloader] MyJD: Connected, listing devices...');

      const response = await client.listDevices();
      const deviceList = response.list || [];
      console.log(`[JDownloader] MyJD: Found ${deviceList.length} device(s):`, deviceList.map(d => d.name));

      const device = deviceList.find(d =>
        d.name.toLowerCase() === config.deviceName?.toLowerCase()
      );

      await client.disconnect();

      if (device) {
        console.log(`[JDownloader] MyJD: Device "${config.deviceName}" found (id: ${device.id})`);
        return true;
      } else {
        console.error(`[JDownloader] MyJD: Device "${config.deviceName}" not found. Available:`, deviceList.map(d => d.name));
        return false;
      }
    } catch (error: any) {
      console.error('[JDownloader] MyJDownloader test error:', error.message);
      return false;
    }
  }

  // ==================== Add Download ====================

  async addDownload(url: string, filename?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[JDownloader] Not enabled');
      return false;
    }

    const config = getConfig().jdownloader;
    const mode = config.apiMode || 'auto';

    // Mode-specific handling
    if (mode === 'local') {
      return await this.addDownloadLocal(url, filename);
    }

    if (mode === 'remote') {
      return await this.addDownloadMyJDownloader(url, filename);
    }

    // Auto mode: try local first, then remote
    if (this.canUseLocalApi()) {
      try {
        const result = await this.addDownloadLocal(url, filename);
        if (result) return true;
      } catch {
        console.log('[JDownloader] Local API failed, trying MyJDownloader...');
      }
    }

    if (this.canUseRemoteApi()) {
      return await this.addDownloadMyJDownloader(url, filename);
    }

    return false;
  }

  private async addDownloadLocal(url: string, filename?: string): Promise<boolean> {
    const config = getConfig().jdownloader;
    try {
      await axios.post(
        `http://${config.localHost}:${config.localPort}/linkgrabberv2/addLinks`,
        {
          links: url,
          packageName: filename || 'DDL Download',
          autostart: true,
        },
        { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
      );

      console.log(`[JDownloader] Added via local API: ${filename || url}`);
      return true;
    } catch (error: any) {
      console.error('[JDownloader] Local API error:', error.message);
      return false;
    }
  }

  private async addDownloadMyJDownloader(url: string, filename?: string): Promise<boolean> {
    const config = getConfig().jdownloader;

    if (!config.email || !config.password || !config.deviceName) {
      console.error('[JDownloader] MyJD: Missing credentials');
      return false;
    }

    try {
      console.log('[JDownloader] MyJD: Connecting...');
      const client = await createMyJDClient(config.email, config.password);
      await client.connect();

      const response = await client.listDevices();
      const deviceList = response.list || [];
      const device = deviceList.find(d =>
        d.name.toLowerCase() === config.deviceName?.toLowerCase()
      );

      if (!device) {
        console.error(`[JDownloader] MyJD: Device "${config.deviceName}" not found. Available:`, deviceList.map(d => d.name));
        await client.disconnect();
        return false;
      }

      console.log(`[JDownloader] MyJD: Adding link to device ${device.name} (${device.id})...`);
      await client.linkgrabberV2.addLinks(device.id, [url], { autostart: true });

      console.log(`[JDownloader] Added via MyJDownloader: ${filename || url}`);
      await client.disconnect();
      return true;
    } catch (error: any) {
      console.error('[JDownloader] MyJDownloader error:', error.message);
      return false;
    }
  }
}
