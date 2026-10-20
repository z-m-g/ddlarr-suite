import axios from 'axios';
import { getConfig } from '../config.js';

const BOOKYS_PATTERN = /bookys-ebooks\.com\/.+\/dl\//i;

/**
 * Check if URL is a Bookys download link (/dl/ intermediate page)
 */
export function isBookysLink(url: string): boolean {
  return BOOKYS_PATTERN.test(url);
}

/**
 * Extract the final hoster link from the Bookys /dl/ page HTML
 * Looks for: <a href="https://1fichier.com/..." class="bys-link bys-host">Cliquez ici...</a>
 */
function extractFinalLink(html: string): string | undefined {
  // Match <a ... class="..bys-host.." href="..."> where href is NOT a bookys-ebooks.com URL
  // The link is inside a div.bg-gray-300
  const patterns = [
    // Pattern 1: a.bys-host with external href (most specific)
    /<a\s+[^>]*href="([^"]+)"[^>]*class="[^"]*bys-host[^"]*"[^>]*>/gi,
    // Pattern 2: reversed order (class before href)
    /<a\s+[^>]*class="[^"]*bys-host[^"]*"[^>]*href="([^"]+)"[^>]*>/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = match[1];
      if (href && !href.includes('bookys-ebooks.com')) {
        // Decode HTML entities
        return href
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"');
      }
    }
  }

  return undefined;
}

const FLARESOLVERR_TIMEOUT = parseInt(process.env.FLARESOLVERR_TIMEOUT || '120000', 10);
const FLARESOLVERR_RETRIES = parseInt(process.env.FLARESOLVERR_RETRIES || '3', 10);

/**
 * Fetch a page through FlareSolverr, retrying when it times out or returns
 * an incomplete page (it sometimes reports "ok" with only a page fragment)
 */
async function fetchViaFlaresolverr(flaresolverrUrl: string, url: string): Promise<string> {
  const attempts = Math.max(1, FLARESOLVERR_RETRIES);
  let lastError: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const fsResponse = await axios.post<{
        status: string;
        message?: string;
        solution: { response: string };
      }>(
        `${flaresolverrUrl}/v1`,
        { cmd: 'request.get', url, maxTimeout: FLARESOLVERR_TIMEOUT },
        { timeout: FLARESOLVERR_TIMEOUT + 10000, headers: { 'Content-Type': 'application/json' } }
      );
      if (fsResponse.data.status !== 'ok') {
        throw new Error(`FlareSolverr failed: ${fsResponse.data.status} - ${fsResponse.data.message}`);
      }
      const html = fsResponse.data.solution?.response || '';
      if (!/<\/body>/i.test(html)) {
        throw new Error(`incomplete response (${html.length} chars)`);
      }
      return html;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Bookys] FlareSolverr attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Resolve a Bookys /dl/ link to the final hoster URL
 *
 * Flow: /journaux/{id}-{slug}/dl/{dlId} → page with "Cliquez ici" → final link (e.g., 1fichier.com)
 */
export async function resolveBookysLink(url: string): Promise<string> {
  try {
    console.log(`[Bookys] Resolving download link: ${url}`);

    const config = getConfig();
    let html: string;

    // Try direct fetch first, fallback to FlareSolverr if configured
    try {
      const response = await axios.get<string>(url, {
        timeout: 30000,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      html = response.data;
    } catch (directError: any) {
      const status = directError?.response?.status;
      if ((status === 403 || status === 503) && config.flaresolverrUrl) {
        console.log(`[Bookys] Direct fetch failed (${status}), trying FlareSolverr`);
        html = await fetchViaFlaresolverr(config.flaresolverrUrl, url);
      } else {
        throw directError;
      }
    }

    const finalLink = extractFinalLink(html);

    if (finalLink) {
      console.log(`[Bookys] Resolved: ${url} -> ${finalLink}`);
      return finalLink;
    }

    console.warn(`[Bookys] Could not find final download link on page: ${url}`);
    return url;
  } catch (error: any) {
    console.error(`[Bookys] Error resolving link ${url}:`, error.message);
    return url;
  }
}
