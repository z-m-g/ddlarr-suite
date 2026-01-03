import axios from 'axios';
import { getConfig } from '../config.js';

// Pattern to match dl-protect domains with any TLD (dl-protect.link, dl-protect.xyz, etc.)
const DLPROTECT_PATTERN = /^(www\.)?dl-protect\.[a-z]+$/i;

/**
 * Check if URL is a dl-protect link (any TLD)
 */
export function isDlProtectLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DLPROTECT_PATTERN.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Clean a dl-protect link by removing query parameters
 */
export function cleanDlProtectUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (isDlProtectLink(url)) {
      return `${parsed.origin}${parsed.pathname}`;
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Resolve a dl-protect link via Botasaurus service
 * Cache is handled entirely by the Botasaurus service (local + remote)
 */
export async function resolveDlProtectLink(url: string): Promise<string> {
  const config = getConfig();
  const cleanedUrl = cleanDlProtectUrl(url);

  try {
    console.log(`[DLProtect] Calling Botasaurus service for: ${cleanedUrl}`);

    const response = await axios.post<{
      resolved_url: string;
      cached: boolean;
      cache_source?: string;
      error?: string;
    }>(
      `${config.dlprotectServiceUrl}/resolve`,
      { url: cleanedUrl },
      {
        timeout: 60000, // 60 seconds timeout
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.resolved_url && !isDlProtectLink(response.data.resolved_url)) {
      const cacheInfo = response.data.cached ? ` (cached: ${response.data.cache_source})` : '';
      console.log(`[DLProtect] Resolved: ${cleanedUrl} -> ${response.data.resolved_url}${cacheInfo}`);
      return response.data.resolved_url;
    }

    if (response.data.error) {
      console.warn(`[DLProtect] Service error: ${response.data.error}`);
    }

    return cleanedUrl;
  } catch (error) {
    console.error(`[DLProtect] Error calling Botasaurus service:`, error);
    return cleanedUrl;
  }
}

/**
 * Check if Botasaurus service is available
 */
export async function checkServiceHealth(): Promise<boolean> {
  const config = getConfig();
  try {
    const response = await axios.get<{ status: string; cache_entries: number }>(
      `${config.dlprotectServiceUrl}/health`,
      { timeout: 5000 }
    );
    return response.data.status === 'ok';
  } catch {
    return false;
  }
}
