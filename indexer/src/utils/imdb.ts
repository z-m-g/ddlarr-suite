import { fetchJson } from './http.js';
import * as fs from 'fs';
import * as path from 'path';

const IMDB_API_BASE = 'https://api.imdbapi.dev';

// Cache file path (persistent across restarts)
const CACHE_DIR = process.env.CACHE_DIR || './cache';
const CACHE_FILE = path.join(CACHE_DIR, 'imdb-titles.json');

// In-memory cache (loaded from file on startup)
let imdbTitlesCache: Record<string, ImdbTitles> = {};

// Load cache from file on module initialization
function loadCache(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      imdbTitlesCache = JSON.parse(data);
      console.log(`[IMDB] Loaded ${Object.keys(imdbTitlesCache).length} cached titles from disk`);
    }
  } catch (error) {
    console.error('[IMDB] Error loading cache:', error);
    imdbTitlesCache = {};
  }
}

// Save cache to file
function saveCache(): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(imdbTitlesCache, null, 2));
  } catch (error) {
    console.error('[IMDB] Error saving cache:', error);
  }
}

// Load cache on module initialization
loadCache();

interface ImdbTitle {
  id: string;
  type: string;
  primaryTitle: string;
  originalTitle: string;
}

interface ImdbAka {
  text: string;
  country?: {
    code: string;
    name: string;
  };
  language?: {
    code: string;
    name: string;
  };
}

interface ImdbAkasResponse {
  akas: ImdbAka[];
}

export interface ImdbTitles {
  originalTitle: string | null;
  frenchTitle: string | null;
}

/**
 * Normalize IMDB ID to include "tt" prefix
 * Sonarr/Radarr send IDs without the prefix
 */
export function normalizeImdbId(imdbId: string): string {
  if (imdbId.startsWith('tt')) {
    return imdbId;
  }
  return `tt${imdbId}`;
}

/**
 * Fetch original title from IMDB API
 * Falls back to primaryTitle if originalTitle is not available
 */
export async function fetchOriginalTitle(imdbId: string): Promise<string | null> {
  const normalizedId = normalizeImdbId(imdbId);
  const url = `${IMDB_API_BASE}/titles/${normalizedId}`;

  try {
    console.log(`[IMDB] Fetching title info for ${normalizedId}`);
    const data = await fetchJson<ImdbTitle>(url);
    const title = data.originalTitle || data.primaryTitle || null;
    console.log(`[IMDB] Original title: "${title}"${!data.originalTitle && data.primaryTitle ? ' (from primaryTitle)' : ''}`);
    return title;
  } catch (error) {
    console.error(`[IMDB] Error fetching title:`, error);
    return null;
  }
}

/**
 * Fetch French title from IMDB API (akas endpoint)
 */
export async function fetchFrenchTitle(imdbId: string): Promise<string | null> {
  const normalizedId = normalizeImdbId(imdbId);
  const url = `${IMDB_API_BASE}/titles/${normalizedId}/akas`;

  try {
    console.log(`[IMDB] Fetching akas for ${normalizedId}`);
    const data = await fetchJson<ImdbAkasResponse>(url);

    // Find French title (country code "FR")
    const frenchAka = data.akas.find(aka => aka.country?.code === 'FR');

    if (frenchAka) {
      console.log(`[IMDB] French title: "${frenchAka.text}"`);
      return frenchAka.text;
    }

    console.log(`[IMDB] No French title found`);
    return null;
  } catch (error) {
    console.error(`[IMDB] Error fetching akas:`, error);
    return null;
  }
}

/**
 * Fetch both original and French titles from IMDB API
 * Results are cached since IMDB data never changes
 */
export async function fetchImdbTitles(imdbId: string): Promise<ImdbTitles> {
  const normalizedId = normalizeImdbId(imdbId);

  // Check cache first
  const cached = imdbTitlesCache[normalizedId];
  if (cached) {
    console.log(`[IMDB] Cache hit for ${normalizedId}`);
    return cached;
  }

  // Fetch both in parallel
  const [originalTitle, frenchTitle] = await Promise.all([
    fetchOriginalTitle(imdbId),
    fetchFrenchTitle(imdbId),
  ]);

  const result: ImdbTitles = { originalTitle, frenchTitle };

  // Only cache successful results (at least one title found)
  if (originalTitle || frenchTitle) {
    imdbTitlesCache[normalizedId] = result;
    saveCache();
    console.log(`[IMDB] Cached titles for ${normalizedId}`);
  }

  return result;
}

/**
 * Get search queries based on IMDB ID
 * Returns an array of unique titles to search for (lowercase, deduplicated)
 * Always includes the raw query from Sonarr/Radarr as fallback
 */
export async function getSearchQueriesFromImdb(imdbId: string, fallbackQuery?: string): Promise<string[]> {
  const { originalTitle, frenchTitle } = await fetchImdbTitles(imdbId);

  // Use lowercase for deduplication since platforms search case-insensitively
  const queries = new Set<string>();

  // Add original title if available
  if (originalTitle) {
    queries.add(originalTitle.toLowerCase());
  }

  // Add French title if available
  if (frenchTitle) {
    queries.add(frenchTitle.toLowerCase());
  }

  // Always add the raw query from Sonarr/Radarr (useful as fallback)
  if (fallbackQuery) {
    queries.add(fallbackQuery.toLowerCase());
  }

  if (queries.size === 0) {
    console.warn(`[IMDB] No search queries available for ${imdbId} - IMDB API returned no titles and no fallback query provided`);
  } else {
    console.log(`[IMDB] Search queries: ${Array.from(queries).join(', ')}`);
  }

  return Array.from(queries);
}
