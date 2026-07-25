import { fetchJson } from './http.js';
import { config } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';

// Titles are resolved from Wikidata (no API key required). When TMDB_API_KEY is set,
// TMDB is queried first since its coverage and French titles are more reliable.
// The previous source (api.imdbapi.dev) is gone: the domain is parked and no longer resolves.
const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';

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

interface SparqlBinding {
  value: string;
  'xml:lang'?: string;
}

interface SparqlResponse {
  results?: {
    bindings?: Record<string, SparqlBinding>[];
  };
}

interface TmdbFindResult {
  title?: string; // movies, localized to the requested language
  original_title?: string;
  name?: string; // TV shows, localized to the requested language
  original_name?: string;
}

interface TmdbFindResponse {
  movie_results?: TmdbFindResult[];
  tv_results?: TmdbFindResult[];
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

function buildWikidataQuery(imdbId: string): string {
  return `SELECT ?title ?origLangCode ?frLabel ?enLabel ?frSitelink ?enSitelink WHERE {
  ?item wdt:P345 "${imdbId}".
  OPTIONAL { ?item wdt:P1476 ?title. }
  OPTIONAL { ?item wdt:P364 ?origLang. ?origLang wdt:P218 ?origLangCode. }
  OPTIONAL { ?item rdfs:label ?frLabel. FILTER(lang(?frLabel) = "fr") }
  OPTIONAL { ?item rdfs:label ?enLabel. FILTER(lang(?enLabel) = "en") }
  OPTIONAL { ?frArticle schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>; schema:name ?frSitelink. }
  OPTIONAL { ?enArticle schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?enSitelink. }
} LIMIT 50`;
}

/**
 * Collect the distinct values bound to a SPARQL variable, preserving result order
 */
function collectBindings(rows: Record<string, SparqlBinding>[], key: string): SparqlBinding[] {
  const seen = new Set<string>();
  const bindings: SparqlBinding[] = [];
  for (const row of rows) {
    const binding = row[key];
    if (binding && !seen.has(binding.value)) {
      seen.add(binding.value);
      bindings.push(binding);
    }
  }
  return bindings;
}

/**
 * Fetch original and French titles from Wikidata (no API key required)
 */
async function fetchFromWikidata(normalizedId: string): Promise<ImdbTitles | null> {
  // The ID is interpolated into the SPARQL query, so only accept the canonical shape
  if (!/^tt\d+$/.test(normalizedId)) {
    console.warn(`[IMDB] Malformed IMDB ID, skipping Wikidata lookup: ${normalizedId}`);
    return null;
  }

  console.log(`[IMDB] Fetching titles from Wikidata for ${normalizedId}`);
  const data = await fetchJson<SparqlResponse>(WIKIDATA_SPARQL_ENDPOINT, {
    params: { query: buildWikidataQuery(normalizedId), format: 'json' },
    headers: { Accept: 'application/sparql-results+json' },
  });

  const rows = data.results?.bindings ?? [];
  if (rows.length === 0) {
    console.log(`[IMDB] No Wikidata entity for ${normalizedId}`);
    return null;
  }

  const titles = collectBindings(rows, 'title');
  const frLabels = collectBindings(rows, 'frLabel');
  const enLabels = collectBindings(rows, 'enLabel');
  const frSitelinks = collectBindings(rows, 'frSitelink');
  const enSitelinks = collectBindings(rows, 'enSitelink');
  const originalLanguage = collectBindings(rows, 'origLangCode')[0]?.value;

  // Some items carry no label at all (e.g. Q79784 "Friends"), so fall back on the Wikipedia
  // article name, which is the release title in that language.
  const frenchTitle = frLabels[0]?.value ?? frSitelinks[0]?.value ?? null;

  // P1476 ("title") is the most accurate original title, but a work can carry several
  // (working titles, renames). Only trust it when exactly one matches the original language.
  const titlesInOriginalLanguage = originalLanguage
    ? titles.filter(title => title['xml:lang'] === originalLanguage)
    : [];
  const originalTitle = titlesInOriginalLanguage.length === 1
    ? titlesInOriginalLanguage[0].value
    : enSitelinks[0]?.value ?? enLabels[0]?.value ?? titles[0]?.value ?? null;

  return { originalTitle, frenchTitle };
}

/**
 * Fetch original and French titles from TMDB (requires TMDB_API_KEY)
 */
async function fetchFromTmdb(normalizedId: string): Promise<ImdbTitles | null> {
  console.log(`[IMDB] Fetching titles from TMDB for ${normalizedId}`);
  const data = await fetchJson<TmdbFindResponse>(`${TMDB_API_BASE}/find/${normalizedId}`, {
    params: {
      api_key: config.tmdbApiKey,
      external_source: 'imdb_id',
      language: 'fr-FR',
    },
  });

  const match = data.movie_results?.[0] ?? data.tv_results?.[0];
  if (!match) {
    console.log(`[IMDB] No TMDB match for ${normalizedId}`);
    return null;
  }

  return {
    originalTitle: match.original_title ?? match.original_name ?? null,
    frenchTitle: match.title ?? match.name ?? null,
  };
}

/**
 * Fetch both original and French titles, trying each configured source in order
 * Results are cached since the data never changes
 */
export async function fetchImdbTitles(imdbId: string): Promise<ImdbTitles> {
  const normalizedId = normalizeImdbId(imdbId);

  // Check cache first
  const cached = imdbTitlesCache[normalizedId];
  if (cached) {
    console.log(`[IMDB] Cache hit for ${normalizedId}`);
    return cached;
  }

  // TMDB first when a key is configured (better coverage), Wikidata otherwise / as fallback
  const sources: { name: string; fetch: () => Promise<ImdbTitles | null> }[] = [];
  if (config.tmdbApiKey) {
    sources.push({ name: 'TMDB', fetch: () => fetchFromTmdb(normalizedId) });
  }
  sources.push({ name: 'Wikidata', fetch: () => fetchFromWikidata(normalizedId) });

  let result: ImdbTitles = { originalTitle: null, frenchTitle: null };

  for (const source of sources) {
    try {
      const titles = await source.fetch();
      if (titles && (titles.originalTitle || titles.frenchTitle)) {
        console.log(`[IMDB] ${source.name}: original="${titles.originalTitle}", french="${titles.frenchTitle}"`);
        result = titles;
        break;
      }
    } catch (error) {
      console.error(`[IMDB] ${source.name} lookup failed for ${normalizedId}:`, error);
    }
  }

  // Only cache successful results (at least one title found)
  if (result.originalTitle || result.frenchTitle) {
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
    console.warn(`[IMDB] No search queries available for ${imdbId} - no title source returned a match and no fallback query provided`);
  } else {
    console.log(`[IMDB] Search queries: ${Array.from(queries).join(', ')}`);
  }

  return Array.from(queries);
}
