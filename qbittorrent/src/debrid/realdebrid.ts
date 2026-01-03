import axios from 'axios';
import { getConfig } from '../config.js';
import { DebridService } from './base.js';

const REALDEBRID_API_BASE = 'https://api.real-debrid.com/rest/1.0';

interface RealDebridUser {
  id: number;
  username: string;
  email: string;
  premium: number; // Unix timestamp when premium expires, 0 if not premium
  type: string;
}

interface RealDebridUnrestrictLink {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  download: string;
}

/**
 * Real-Debrid client for debriding links
 * Documentation: https://api.real-debrid.com/
 */
export class RealDebridClient implements DebridService {
  readonly name = 'Real-Debrid';

  isConfigured(): boolean {
    const config = getConfig().debrid.realdebrid;
    return !!config.apiKey;
  }

  isEnabled(): boolean {
    const config = getConfig().debrid.realdebrid;
    return config.enabled && this.isConfigured();
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().debrid.realdebrid;

    if (!config.apiKey) {
      console.log('[Real-Debrid] No API key configured');
      return false;
    }

    try {
      console.log('[Real-Debrid] Testing connection...');

      const response = await axios.get<RealDebridUser>(
        `${REALDEBRID_API_BASE}/user`,
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
          timeout: 10000,
        }
      );

      const isPremium = response.data.premium > 0 && response.data.premium > Date.now() / 1000;
      console.log(`[Real-Debrid] Connected as ${response.data.username}, premium: ${isPremium}`);
      return true;
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.error('[Real-Debrid] Invalid API key');
      } else {
        console.error('[Real-Debrid] Connection test failed:', error.message || error);
      }
      return false;
    }
  }

  async debridLink(link: string): Promise<string> {
    const config = getConfig().debrid.realdebrid;

    if (!config.apiKey) {
      throw new Error('Real-Debrid not configured');
    }

    console.log(`[Real-Debrid] Debriding: ${link}`);

    const response = await axios.post<RealDebridUnrestrictLink>(
      `${REALDEBRID_API_BASE}/unrestrict/link`,
      `link=${encodeURIComponent(link)}`,
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      }
    );

    if (response.data.download) {
      console.log(`[Real-Debrid] Success: ${response.data.download}`);
      return response.data.download;
    }

    throw new Error('No download link returned');
  }
}
