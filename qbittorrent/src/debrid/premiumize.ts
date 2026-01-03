import axios from 'axios';
import { getConfig } from '../config.js';
import { DebridService } from './base.js';

const PREMIUMIZE_API_BASE = 'https://www.premiumize.me/api';

interface PremiumizeResponse<T> {
  status: 'success' | 'error';
  message?: string;
  content?: T;
}

interface PremiumizeAccountInfo {
  customer_id: string;
  premium_until: number; // Unix timestamp
  limit_used: number;
  space_used: number;
}

interface PremiumizeDirectDL {
  location: string;
  filename: string;
  filesize: number;
}

/**
 * Premiumize client for debriding links
 * Documentation: https://www.premiumize.me/api
 */
export class PremiumizeClient implements DebridService {
  readonly name = 'Premiumize';

  isConfigured(): boolean {
    const config = getConfig().debrid.premiumize;
    return !!config.apiKey;
  }

  isEnabled(): boolean {
    const config = getConfig().debrid.premiumize;
    return config.enabled && this.isConfigured();
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().debrid.premiumize;

    if (!config.apiKey) {
      console.log('[Premiumize] No API key configured');
      return false;
    }

    try {
      console.log('[Premiumize] Testing connection...');

      const response = await axios.get<PremiumizeResponse<PremiumizeAccountInfo>>(
        `${PREMIUMIZE_API_BASE}/account/info`,
        {
          params: {
            apikey: config.apiKey,
          },
          timeout: 10000,
        }
      );

      if (response.data.status === 'success') {
        const isPremium = response.data.content?.premium_until
          ? response.data.content.premium_until > Date.now() / 1000
          : false;
        console.log(`[Premiumize] Connected, premium: ${isPremium}`);
        return true;
      }

      if (response.data.message) {
        console.error(`[Premiumize] Error: ${response.data.message}`);
      }

      return false;
    } catch (error: any) {
      console.error('[Premiumize] Connection test failed:', error.message || error);
      return false;
    }
  }

  async debridLink(link: string): Promise<string> {
    const config = getConfig().debrid.premiumize;

    if (!config.apiKey) {
      throw new Error('Premiumize not configured');
    }

    console.log(`[Premiumize] Debriding: ${link}`);

    const response = await axios.post<PremiumizeResponse<PremiumizeDirectDL>>(
      `${PREMIUMIZE_API_BASE}/transfer/directdl`,
      `src=${encodeURIComponent(link)}`,
      {
        params: {
          apikey: config.apiKey,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      }
    );

    if (response.data.status === 'success' && response.data.content?.location) {
      console.log(`[Premiumize] Success: ${response.data.content.location}`);
      return response.data.content.location;
    }

    if (response.data.message) {
      throw new Error(response.data.message);
    }

    throw new Error('Unknown error');
  }
}
