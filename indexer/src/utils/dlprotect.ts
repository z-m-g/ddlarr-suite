import axios from 'axios';

// Botasaurus service URL
const DLPROTECT_SERVICE_URL = process.env.DLPROTECT_SERVICE_URL || 'http://localhost:5000';

// Domains that need resolution
const DLPROTECT_DOMAINS = [
  'dl-protect.link',
  'dl-protect.net',
  'dl-protect.org',
];

/**
 * Check if URL is a dl-protect link
 */
export function isDlProtectLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DLPROTECT_DOMAINS.some(domain => parsed.hostname.includes(domain));
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
  const cleanedUrl = cleanDlProtectUrl(url);

  try {
    console.log(`[DLProtect] Calling Botasaurus service for: ${cleanedUrl}`);

    const response = await axios.post<{
      resolved_url: string;
      cached: boolean;
      cache_source?: string;
      error?: string;
    }>(
      `${DLPROTECT_SERVICE_URL}/resolve`,
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
  try {
    const response = await axios.get<{ status: string; cache_entries: number }>(
      `${DLPROTECT_SERVICE_URL}/health`,
      { timeout: 5000 }
    );
    return response.data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Get cache stats from Botasaurus service
 */
export async function getServiceCacheStats(): Promise<{ entries: number; directory: string } | null> {
  try {
    const response = await axios.get<{ entries: number; directory: string }>(
      `${DLPROTECT_SERVICE_URL}/cache/stats`,
      { timeout: 5000 }
    );
    return response.data;
  } catch {
    return null;
  }
}

/**
 * No-op for compatibility (browser cleanup not needed with service approach)
 */
export async function closeBrowser(): Promise<void> {
  // No-op - browser is managed by Botasaurus service
}
