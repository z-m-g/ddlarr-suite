import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cache HTML en mémoire
interface CacheEntry {
  html: string;
  timestamp: number;
}

const htmlCache = new Map<string, CacheEntry>();
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 jours

function getCachedHtml(url: string): string | null {
  const entry = htmlCache.get(url);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    console.log(`[Cache] HIT for ${url}`);
    return entry.html;
  }
  if (entry) {
    console.log(`[Cache] EXPIRED for ${url}`);
    htmlCache.delete(url);
  } else {
    console.log(`[Cache] MISS for ${url}`);
  }
  return null;
}

function setCachedHtml(url: string, html: string): void {
  htmlCache.set(url, { html, timestamp: Date.now() });
  console.log(`[Cache] Stored ${url} (${html.length} chars)`);
}

// Nettoie le cache périodiquement (toutes les 10 minutes)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [url, entry] of htmlCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      htmlCache.delete(url);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Cache] Cleaned ${cleaned} expired entries`);
  }
}, 10 * 60 * 1000);

export function createHttpClient(baseURL?: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
}

async function fetchDirect(url: string, configOpts?: AxiosRequestConfig): Promise<string> {
  const client = createHttpClient();
  const response = await client.get<string>(url, {
    ...configOpts,
    responseType: 'text',
  });
  return response.data;
}

export async function fetchHtml(url: string, configOpts?: AxiosRequestConfig): Promise<string> {
  // Vérifie le cache d'abord
  const cached = getCachedHtml(url);
  if (cached) {
    return cached;
  }

  const html = await fetchDirect(url, configOpts);
  setCachedHtml(url, html);
  return html;
}

export async function fetchJson<T>(url: string, configOpts?: AxiosRequestConfig): Promise<T> {
  const client = createHttpClient();
  const response = await client.get<T>(url, {
    ...configOpts,
    responseType: 'json',
  });
  return response.data;
}

export function encodeSearchQuery(query: string): string {
  return encodeURIComponent(query.trim().toLowerCase());
}
