import axios, { AxiosInstance } from 'axios';
import { DownloadClient } from './base.js';
import { getConfig } from '../utils/config.js';

/**
 * Synology Download Station API client
 * Documentation: https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/DownloadStation/All/enu/Synology_Download_Station_Web_API.pdf
 */
export class DownloadStationClient implements DownloadClient {
  name = 'Download Station';
  private sid: string | null = null;
  private client: AxiosInstance | null = null;

  private getBaseUrl(): string {
    const config = getConfig().downloadStation;
    const protocol = config.useSsl ? 'https' : 'http';
    return `${protocol}://${config.host}:${config.port}`;
  }

  private getClient(): AxiosInstance {
    if (!this.client) {
      this.client = axios.create({
        baseURL: this.getBaseUrl(),
        timeout: 10000,
      });
    }
    return this.client;
  }

  isEnabled(): boolean {
    const config = getConfig().downloadStation;
    return config.enabled && !!config.host && !!config.username;
  }

  private async login(): Promise<boolean> {
    const config = getConfig().downloadStation;

    try {
      const response = await this.getClient().get('/webapi/auth.cgi', {
        params: {
          api: 'SYNO.API.Auth',
          version: 3,
          method: 'login',
          account: config.username,
          passwd: config.password,
          session: 'DownloadStation',
          format: 'sid',
        },
      });

      if (response.data.success) {
        this.sid = response.data.data.sid;
        console.log('[DownloadStation] Login successful');
        return true;
      } else {
        console.error('[DownloadStation] Login failed:', response.data.error);
        return false;
      }
    } catch (error) {
      console.error('[DownloadStation] Login error:', error);
      return false;
    }
  }

  private async ensureLoggedIn(): Promise<boolean> {
    if (this.sid) {
      return true;
    }
    return this.login();
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().downloadStation;
    console.log('[DownloadStation] Testing connection...');
    console.log(`[DownloadStation] Config: host=${config.host}, port=${config.port}, ssl=${config.useSsl}, user=${config.username}`);

    // Check only connection requirements, not "enabled" flag
    if (!config.host || !config.username) {
      const missing = [];
      if (!config.host) missing.push('host');
      if (!config.username) missing.push('username');
      console.log(`[DownloadStation] Missing required fields: ${missing.join(', ')}`);
      return false;
    }

    try {
      // Reset session
      this.sid = null;
      this.client = null;

      console.log(`[DownloadStation] Connecting to ${this.getBaseUrl()}`);
      const loggedIn = await this.login();
      if (!loggedIn) {
        console.log('[DownloadStation] Login failed');
        return false;
      }

      // Test API info
      console.log('[DownloadStation] Login OK, testing API info...');
      const response = await this.getClient().get('/webapi/DownloadStation/info.cgi', {
        params: {
          api: 'SYNO.DownloadStation.Info',
          version: 1,
          method: 'getinfo',
          _sid: this.sid,
        },
      });

      console.log('[DownloadStation] API response:', JSON.stringify(response.data));
      return response.data.success === true;
    } catch (error: any) {
      console.error('[DownloadStation] Connection test failed:', error.message || error);
      if (error.response) {
        console.error('[DownloadStation] Response status:', error.response.status);
        console.error('[DownloadStation] Response data:', JSON.stringify(error.response.data));
      }
      if (error.code) {
        console.error('[DownloadStation] Error code:', error.code);
      }
      return false;
    }
  }

  async addDownload(url: string, filename?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[DownloadStation] Not enabled');
      return false;
    }

    try {
      if (!await this.ensureLoggedIn()) {
        return false;
      }

      const config = getConfig().downloadStation;

      const params: Record<string, string> = {
        api: 'SYNO.DownloadStation.Task',
        // version: '1',
        version: '3',
        method: 'create',
        uri: url,
        _sid: this.sid!,
      };

      if (config.destination) {
        params.destination = config.destination;
      }

      console.log(`[DownloadStation] Params for adding : ${JSON.stringify(params)}`);

      // Use POST with URLSearchParams for proper encoding (especially for paths with spaces)
      const formData = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        formData.append(key, value);
      }

      const response = await this.getClient().post('/webapi/DownloadStation/task.cgi', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      console.log(`[DownloadStation] Response: ${JSON.stringify(response.data)}`);

      if (response.data.success) {
        console.log(`[DownloadStation] Added download: ${filename || url}`);
        return true;
      } else {
        const errorCode = response.data.error?.code;
        const errorMessages: Record<number, string> = {
          400: 'File upload failed',
          401: 'Max number of tasks reached',
          402: 'Destination denied (permission issue)',
          403: 'Destination does not exist (check path format, e.g., "downloads" not "/volume1/downloads")',
          404: 'Invalid task id',
          405: 'Invalid task action',
          406: 'No default destination configured in Download Station',
        };
        const errorMsg = errorMessages[errorCode] || `Unknown error code ${errorCode}`;
        console.error(`[DownloadStation] Failed to add download: ${errorMsg}`, response.data.error);
        return false;
      }
    } catch (error) {
      console.error('[DownloadStation] Error adding download:', error);
      // Reset session on error
      this.sid = null;
      return false;
    }
  }
}
