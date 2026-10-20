import axios from 'axios';
import { fetchHtml } from './http.js';
import { config } from '../config.js';

interface FlaresolverrSolution {
  url: string;
  status: number;
  headers: Record<string, string>;
  response: string;
  cookies: Array<{ name: string; value: string }>;
  userAgent: string;
}

interface Clearance {
  cookie: string;
  userAgent: string;
}

// Cloudflare clearance (cookies + matching User-Agent) obtained from FlareSolverr, per origin.
// Reusing it lets us fetch pages directly instead of going through FlareSolverr every time.
const clearances = new Map<string, Clearance>();

// FlareSolverr handles concurrent requests poorly (truncated "ok" responses, timeouts),
// so requests to it are serialized through this chain.
let flaresolverrQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = flaresolverrQueue.then(task, task);
  flaresolverrQueue = run.catch(() => undefined);
  return run;
}

function isBlockedError(error: any): boolean {
  const status = error?.response?.status;
  return status === 403 || status === 503;
}

/**
 * A usable page is a complete HTML document that is not a Cloudflare challenge.
 * FlareSolverr sometimes reports "ok" with only a fragment of the page.
 */
export function isCompletePage(html: string | undefined): boolean {
  if (!html) return false;
  if (!/<html[\s>]/i.test(html) || !/<\/body>/i.test(html)) return false;
  return !/<title>\s*Just a moment/i.test(html);
}

/**
 * Fetch directly with a stored clearance.
 * Returns null when there is no clearance or Cloudflare rejected it.
 */
async function fetchWithClearance(url: string): Promise<string | null> {
  const origin = new URL(url).origin;
  const clearance = clearances.get(origin);
  if (!clearance) return null;

  try {
    const response = await axios.get<string>(url, {
      timeout: 30000,
      responseType: 'text',
      headers: {
        'User-Agent': clearance.userAgent,
        'Cookie': clearance.cookie,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (isCompletePage(response.data)) {
      return response.data;
    }
  } catch (error: any) {
    if (!isBlockedError(error)) throw error;
  }

  console.log(`[FlareSolverr] Clearance for ${origin} rejected, solving the challenge again`);
  clearances.delete(origin);
  return null;
}

/**
 * Fetch HTML with FlareSolverr fallback
 * 1. Reuse a Cloudflare clearance from a previous FlareSolverr solve, if any
 * 2. Otherwise try direct fetch via axios (uses existing cache)
 * 3. If 403/503 (Cloudflare), fallback to FlareSolverr
 */
export async function fetchHtmlSmart(url: string): Promise<string> {
  const viaClearance = await fetchWithClearance(url);
  if (viaClearance) return viaClearance;

  try {
    return await fetchHtml(url);
  } catch (error: any) {
    if (isBlockedError(error) && config.flaresolverrUrl) {
      console.log(`[FlareSolverr] Direct fetch failed (${error.response.status}), trying FlareSolverr for: ${url}`);
      return await fetchViaFlaresolverr(url);
    }
    throw error;
  }
}

/**
 * Fetch HTML via FlareSolverr service (serialized, with retries)
 */
function fetchViaFlaresolverr(url: string): Promise<string> {
  return serialize(async () => {
    // Another queued request may have obtained a clearance while this one was waiting
    const viaClearance = await fetchWithClearance(url);
    if (viaClearance) return viaClearance;

    const attempts = Math.max(1, config.flaresolverrRetries);
    let lastError: any;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const solution = await requestFlaresolverr(url);
        if (!isCompletePage(solution.response)) {
          throw new Error(`incomplete response (${solution.response?.length ?? 0} chars)`);
        }
        if (solution.cookies?.length && solution.userAgent) {
          clearances.set(new URL(url).origin, {
            cookie: solution.cookies.map(c => `${c.name}=${c.value}`).join('; '),
            userAgent: solution.userAgent,
          });
        }
        console.log(`[FlareSolverr] Successfully fetched: ${url}`);
        return solution.response;
      } catch (error: any) {
        lastError = error;
        console.warn(`[FlareSolverr] Attempt ${attempt}/${attempts} failed for ${url}: ${error.message}`);
        if (attempt < attempts) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    console.error(`[FlareSolverr] Error fetching ${url}:`, lastError?.message);
    throw lastError;
  });
}

async function requestFlaresolverr(url: string): Promise<FlaresolverrSolution> {
  const flaresolverrUrl = config.flaresolverrUrl;
  if (!flaresolverrUrl) {
    throw new Error('FlareSolverr URL not configured');
  }

  const response = await axios.post<{
    status: string;
    message: string;
    solution: FlaresolverrSolution;
  }>(
    `${flaresolverrUrl}/v1`,
    {
      cmd: 'request.get',
      url,
      maxTimeout: config.flaresolverrTimeout,
    },
    {
      timeout: config.flaresolverrTimeout + 10000, // Slightly more than maxTimeout
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.data.status === 'ok' && response.data.solution) {
    return response.data.solution;
  }

  throw new Error(`FlareSolverr returned status: ${response.data.status} - ${response.data.message}`);
}

/**
 * Check if FlareSolverr service is available
 */
export async function checkFlaresolverrHealth(): Promise<boolean> {
  if (!config.flaresolverrUrl) return false;
  try {
    const response = await axios.get(`${config.flaresolverrUrl}/health`, { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}
