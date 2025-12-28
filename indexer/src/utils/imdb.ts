import { fetchJson } from './http.js';

const IMDB_API_BASE = 'https://api.imdbapi.dev';

// Cache for IMDB titles (results never change, so no expiration needed)
const imdbTitlesCache = new Map<string, ImdbTitles>();

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
 */
export async function fetchOriginalTitle(imdbId: string): Promise<string | null> {
  const normalizedId = normalizeImdbId(imdbId);
  const url = `${IMDB_API_BASE}/titles/${normalizedId}`;

  try {
    console.log(`[IMDB] Fetching title info for ${normalizedId}`);
    const data = await fetchJson<ImdbTitle>(url);
    console.log(`[IMDB] Original title: "${data.originalTitle}"`);
    return data.originalTitle || null;
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
  const cached = imdbTitlesCache.get(normalizedId);
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
    imdbTitlesCache.set(normalizedId, result);
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
