import axios from 'axios';
import { DownloadClient } from './base.js';
import { getConfig } from '../utils/config.js';

/**
 * aria2 client via JSON-RPC
 * Documentation: https://aria2.github.io/manual/en/html/aria2c.html#rpc-interface
 */
export class Aria2Client implements DownloadClient {
  name = 'aria2';

  isEnabled(): boolean {
    const config = getConfig().aria2;
    return config.enabled && !!config.host;
  }

  private getUrl(): string {
    const config = getConfig().aria2;
    return `http://${config.host}:${config.port}/jsonrpc`;
  }

  private async rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
    const config = getConfig().aria2;

    // If secret is set, prepend it to params
    const rpcParams = config.secret
      ? [`token:${config.secret}`, ...params]
      : params;

    const response = await axios.post(this.getUrl(), {
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method,
      params: rpcParams,
    }, {
      timeout: 10000,
    });

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    return response.data.result;
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().aria2;
    console.log('[aria2] Testing connection...');
    console.log(`[aria2] Config: host=${config.host}, port=${config.port}, secret=${config.secret ? '***' : 'N/A'}`);

    // Check only connection requirements, not "enabled" flag
    if (!config.host) {
      console.log('[aria2] Missing required field: host');
      return false;
    }

    try {
      console.log(`[aria2] Connecting to ${this.getUrl()}`);
      const version = await this.rpcCall('aria2.getVersion');
      console.log('[aria2] Version:', JSON.stringify(version));
      return true;
    } catch (error: any) {
      console.error('[aria2] Connection test failed:', error.message || error);
      if (error.code) {
        console.error('[aria2] Error code:', error.code);
      }
      if (error.response) {
        console.error('[aria2] Response status:', error.response.status);
        console.error('[aria2] Response data:', JSON.stringify(error.response.data));
      }
      return false;
    }
  }

  async addDownload(url: string, filename?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[aria2] Not enabled');
      return false;
    }

    try {
      const config = getConfig().aria2;

      const options: Record<string, string> = {};

      if (filename) {
        options.out = filename;
      }

      if (config.dir) {
        options.dir = config.dir;
      }

      const gid = await this.rpcCall('aria2.addUri', [[url], options]);
      console.log(`[aria2] Added download with GID ${gid}: ${filename || url}`);
      return true;
    } catch (error) {
      console.error('[aria2] Error adding download:', error);
      return false;
    }
  }
}
