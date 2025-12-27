import { ContentType } from '../models/torznab.js';

/**
 * Retire les textes entre crochets [VF], [1080p], etc.
 */
export function removeBrackets(str: string): string {
  return str.replace(/\[[^\]]*\]/g, '').trim();
}

/**
 * Normalise une chaîne pour la comparaison (minuscules, sans accents, sans caractères spéciaux)
 */
export function normalizeForMatch(str: string): string {
  return removeBrackets(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
    .replace(/[^a-z0-9]/g, ''); // Garde uniquement lettres et chiffres
}

/**
 * Calcule la distance de Levenshtein entre deux chaînes
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // suppression
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calcule la distance autorisée en fonction de la longueur de la recherche
 */
export function getAllowedDistance(queryLength: number): number {
  if (queryLength <= 5) {
    return 1;
  } else if (queryLength <= 10) {
    return 2;
  } else {
    return Math.floor(queryLength * 0.2);
  }
}

/**
 * Vérifie si deux noms de séries sont suffisamment proches
 */
export function isSeriesNameMatch(searchQuery: string, foundName: string, logPrefix = '[Scraper]'): boolean {
  const normalizedQuery = normalizeForMatch(searchQuery);
  const normalizedFound = normalizeForMatch(foundName);

  if (normalizedQuery === normalizedFound) {
    console.log(`${logPrefix} Series exact match: "${searchQuery}" = "${foundName}"`);
    return true;
  }

  const distance = levenshteinDistance(normalizedQuery, normalizedFound);
  const allowedDistance = getAllowedDistance(normalizedQuery.length);

  console.log(`${logPrefix} Series comparing "${searchQuery}" with "${foundName}": distance=${distance}, allowed=${allowedDistance}`);

  return distance <= allowedDistance;
}

/**
 * Vérifie si deux noms de films sont suffisamment proches
 * Pour les films, on vérifie aussi si la recherche est contenue dans le titre trouvé
 */
export function isMovieNameMatch(searchQuery: string, foundName: string, logPrefix = '[Scraper]'): boolean {
  const normalizedQuery = normalizeForMatch(searchQuery);
  const normalizedFound = normalizeForMatch(foundName);

  if (normalizedQuery === normalizedFound) {
    console.log(`${logPrefix} Movie exact match: "${searchQuery}" = "${foundName}"`);
    return true;
  }

  // Pour les films, on vérifie aussi si la recherche est contenue dans le titre trouvé
  // Utile pour "Heat" qui peut trouver "Heat 1995" ou "Heat (1995)"
  if (normalizedFound.includes(normalizedQuery)) {
    console.log(`${logPrefix} Movie contains match: "${searchQuery}" in "${foundName}"`);
    return true;
  }

  const distance = levenshteinDistance(normalizedQuery, normalizedFound);
  const allowedDistance = getAllowedDistance(normalizedQuery.length);

  console.log(`${logPrefix} Movie comparing "${searchQuery}" with "${foundName}": distance=${distance}, allowed=${allowedDistance}`);

  return distance <= allowedDistance;
}

/**
 * Vérifie si un nom correspond à la recherche (selon le type de contenu)
 */
export function isNameMatch(searchQuery: string, foundName: string, contentType: ContentType, logPrefix = '[Scraper]'): boolean {
  if (contentType === 'movie') {
    return isMovieNameMatch(searchQuery, foundName, logPrefix);
  }
  return isSeriesNameMatch(searchQuery, foundName, logPrefix);
}

/**
 * Extrait le nom du film depuis le titre (enlève les infos techniques et les crochets)
 */
export function extractMovieName(titleHtml: string): string {
  // Enlève les tags HTML
  let cleanTitle = titleHtml
    .replace(/<[^>]+>/g, '') // Supprime les tags HTML
    .replace(/\s+/g, ' ')    // Normalise les espaces
    .trim();

  // Retire les textes entre crochets [VF], [1080p], etc.
  cleanTitle = removeBrackets(cleanTitle);

  // Split sur " - " pour séparer les parties (titre - qualité - langue)
  const parts = cleanTitle.split(' - ');

  // Le premier élément est généralement le titre du film
  return parts[0].trim();
}

/**
 * Extrait le nom de la série depuis le titre (enlève la partie "Saison X" et langue)
 */
export function extractSeriesName(titleHtml: string): { seriesName: string; season?: number } {
  // Enlève les tags HTML
  let cleanTitle = titleHtml
    .replace(/<[^>]+>/g, '') // Supprime les tags HTML
    .replace(/\s+/g, ' ')    // Normalise les espaces
    .trim();

  // Retire les textes entre crochets [VF], [1080p], etc.
  cleanTitle = removeBrackets(cleanTitle);

  // Split sur " - " pour séparer les parties
  const parts = cleanTitle.split(' - ');

  if (parts.length >= 2) {
    // La dernière partie est souvent la langue (VF, VOSTFR, etc.) ou la saison
    // On cherche la partie "Saison X"
    let seriesName = '';
    let season: number | undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      const seasonMatch = part.match(/^saison\s*(\d+)$/i);

      if (seasonMatch) {
        season = parseInt(seasonMatch[1], 10);
        // Le nom de la série est tout ce qui précède
        seriesName = parts.slice(0, i).join(' - ').trim();
        break;
      }
    }

    // Si on n'a pas trouvé de saison explicite, prend tout sauf le dernier élément
    if (!seriesName) {
      seriesName = parts.slice(0, -1).join(' - ').trim();
    }

    return { seriesName, season };
  }

  return { seriesName: cleanTitle };
}

/**
 * Extrait le nom selon le type de contenu
 */
export function extractName(titleHtml: string, contentType: ContentType): { name: string; season?: number } {
  if (contentType === 'movie') {
    return { name: extractMovieName(titleHtml) };
  }
  const { seriesName, season } = extractSeriesName(titleHtml);
  return { name: seriesName, season };
}
