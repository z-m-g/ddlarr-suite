import axios from 'axios';
import { getConfig } from './config.js';

const ALLDEBRID_API_BASE = 'https://api.alldebrid.com/v4';

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

/**
 * AllDebrid client for debriding links before download
 */
export class AllDebridClient {
  isConfigured(): boolean {
    const apiKey = getConfig().alldebridApiKey;
    return !!apiKey;
  }

  /**
   * Debrid a single link
   * Returns the debrided link or the original if debrid fails
   */
  async debridLink(link: string): Promise<string> {
    const apiKey = getConfig().alldebridApiKey;

    if (!apiKey) {
      console.log('[AllDebrid] Not configured, returning original link');
      return link;
    }

    try {
      console.log(`[AllDebrid] Debriding: ${link}`);

      const formData = new FormData();
      formData.append('link', link);

      const response = await axios.post<AllDebridResponse<DebridLink>>(
        `${ALLDEBRID_API_BASE}/link/unlock`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      );

      if (response.data.status === 'success' && response.data.data?.link) {
        console.log(`[AllDebrid] Success: ${response.data.data.link}`);
        return response.data.data.link;
      }

      if (response.data.error) {
        console.warn(`[AllDebrid] Error: ${response.data.error.message} (${response.data.error.code})`);
      }

      return link;
    } catch (error: any) {
      console.error('[AllDebrid] Request failed:', error.message || error);
      return link;
    }
  }

  /**
   * Test connection to AllDebrid API
   */
  async testConnection(): Promise<boolean> {
    const apiKey = getConfig().alldebridApiKey;

    if (!apiKey) {
      console.log('[AllDebrid] No API key configured');
      return false;
    }

    try {
      console.log('[AllDebrid] Testing connection...');

      const response = await axios.get<AllDebridResponse<{ user: { username: string; isPremium: boolean } }>>(
        `${ALLDEBRID_API_BASE}/user`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
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
}

export const alldebrid = new AllDebridClient();
