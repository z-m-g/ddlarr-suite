import * as cheerio from 'cheerio';
import { BaseScraper, parseQuality, parseLanguage, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtml, encodeSearchQuery } from '../utils/http.js';
import { isNameMatch, extractName, generateAccentVariants } from '../utils/text.js';

type WawaContentType = 'films' | 'series' | 'mangas';

// Mapping pour le paramètre de recherche
const CONTENT_TYPE_MAP: Record<string, WawaContentType> = {
  movie: 'films',
  series: 'series',
  anime: 'mangas',
};

// Sélecteurs pour les résultats de recherche
const RESULT_SELECTORS: Record<string, string> = {
  movie: 'a[href^="?p=film&id="]',
  series: 'a[href^="?p=serie&id="]',
  anime: 'a[href^="?p=manga&id="]',
};

interface SearchResult {
  title: string;
  pageUrl: string;
  quality?: string;
  language?: string;
  season?: number;
}

export class WawacityScraper implements BaseScraper {
  readonly name = 'WawaCity';

  constructor(public readonly baseUrl: string) {}

  async search(params: SearchParams): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    const [movies, series, anime] = await Promise.allSettled([
      this.searchMovies(params),
      this.searchSeries(params),
      this.searchAnime(params),
    ]);

    if (movies.status === 'fulfilled') results.push(...movies.value);
    if (series.status === 'fulfilled') results.push(...series.value);
    if (anime.status === 'fulfilled') results.push(...anime.value);

    return results;
  }

  async searchMovies(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'movie');
  }

  async searchSeries(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'series');
  }

  async searchAnime(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'anime');
  }

  private async searchByType(params: SearchParams, contentType: ContentType): Promise<ScraperResult[]> {
    if (!params.q) return [];

    const wawaType = CONTENT_TYPE_MAP[contentType];

    // Génère les variantes avec accents français
    const searchVariants = generateAccentVariants(params.q, 5);
    console.log(`[WawaCity] Search variants for "${params.q}":`, searchVariants);

    try {
      // Collecte tous les résultats de recherche pour toutes les variantes
      const allSearchResults: SearchResult[] = [];
      const seenPageUrls = new Set<string>();

      // Recherche pour chaque variante (en parallèle)
      const variantPromises = searchVariants.map(async (variant) => {
        let searchTerm = variant;
        if (params.season) {
          searchTerm += ` Saison ${params.season}`;
        }

        // WawaCity limite: max 32 caractères (espaces inclus)
        // Si la limite est dépassée, la liste complète des films est renvoyée au lieu des résultats de recherche
        if (searchTerm.length > 32) {
          searchTerm = searchTerm.substring(0, 32).trim();
          console.log(`[WawaCity] Truncated search term to 32 chars: "${searchTerm}"`);
        }

        const baseSearchUrl = `${this.baseUrl}/?p=${wawaType}&linkType=hasDownloadLink&search=${encodeSearchQuery(searchTerm)}`;
        console.log(`[WawaCity] Searching ${contentType} with variant "${variant}": ${baseSearchUrl}`);

        try {
          return await this.fetchAllPages(baseSearchUrl, contentType, params);
        } catch (error) {
          console.error(`[WawaCity] Error searching variant "${variant}":`, error);
          return [];
        }
      });

      const variantResults = await Promise.all(variantPromises);

      // Déduplique par URL de page de détail
      for (const results of variantResults) {
        for (const result of results) {
          if (!seenPageUrls.has(result.pageUrl)) {
            seenPageUrls.add(result.pageUrl);
            allSearchResults.push(result);
          }
        }
      }

      console.log(`[WawaCity] Found ${allSearchResults.length} unique search results across all variants`);

      if (allSearchResults.length === 0) {
        return [];
      }

      // Pour chaque résultat, visite la page et récupère les liens de téléchargement
      const allResults: ScraperResult[] = [];

      // Limite à 10 résultats pour éviter trop de requêtes
      const pagesToVisit = allSearchResults.slice(0, 10);

      for (const result of pagesToVisit) {
        try {
          const episodes = await this.parseDetailPage(result, contentType, params);
          allResults.push(...episodes);
        } catch (error) {
          console.error(`[WawaCity] Error parsing detail page ${result.pageUrl}:`, error);
        }
      }

      console.log(`[WawaCity] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[WawaCity] Search error for ${contentType}:`, error);
      return [];
    }
  }

  private async fetchAllPages(baseSearchUrl: string, contentType: ContentType, params: SearchParams): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;
    const maxPages = 5; // Limite pour éviter trop de requêtes

    while (currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? baseSearchUrl : `${baseSearchUrl}&page=${currentPage}`;
      console.log(`[WawaCity] Fetching page ${currentPage}: ${pageUrl}`);

      try {
        const html = await fetchHtml(pageUrl);
        const results = this.parseSearchResults(html, contentType, params);

        if (results.length === 0) {
          console.log(`[WawaCity] No results on page ${currentPage}, stopping pagination`);
          break;
        }

        allResults.push(...results);

        // Vérifie s'il y a une page suivante
        const $ = cheerio.load(html);
        const hasNextPage = $('ul.pagination li:not(.disabled) a[rel="next"]').length > 0;

        if (!hasNextPage) {
          console.log(`[WawaCity] No more pages after page ${currentPage}`);
          break;
        }

        currentPage++;
      } catch (error) {
        console.error(`[WawaCity] Error fetching page ${currentPage}:`, error);
        break;
      }
    }

    return allResults;
  }

  private parseSearchResults(html: string, contentType: ContentType, params: SearchParams): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    console.log(`[WawaCity] Parsing search results for ${contentType}`);

    // Parse les blocs .wa-sub-block.wa-post-detail-item
    $('.wa-sub-block.wa-post-detail-item').each((_, block) => {
      try {
        const $block = $(block);
        const $titleLink = $block.find('.wa-sub-block-title a[href^="?p="]').first();

        if ($titleLink.length === 0) return;

        // Récupère le HTML du lien pour extraire le nom sans les tags <i>
        const titleHtml = $titleLink.html() || '';
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';

        if (!title || !href) return;

        // Extrait le nom et la saison depuis le titre (selon le type de contenu)
        const { name, season: extractedSeason } = extractName(titleHtml, contentType);

        console.log(`[WawaCity] Parsed title: "${title}" -> name="${name}", season=${extractedSeason}`);

        // Vérifie que le nom correspond à la recherche (Levenshtein, adapté au type de contenu)
        // Pour les films, on est moins strict car le titre original sera vérifié sur la page détail
        if (params.q && name) {
          if (!isNameMatch(params.q, name, contentType, '[WawaCity]')) {
            // Pour les films, on garde le résultat pour vérifier le titre original plus tard
            if (contentType !== 'movie') {
              console.log(`[WawaCity] Skipping "${name}" - too different from "${params.q}"`);
              return;
            }
            console.log(`[WawaCity] Keeping "${name}" (movie) - will check original title on detail page`);
          }
        }

        // Si on cherche une saison spécifique, vérifie que la saison correspond
        if (params.season && contentType === 'series') {
          const seasonNum = parseInt(params.season, 10);
          if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
            console.log(`[WawaCity] Skipping "${title}" - season ${extractedSeason} != ${seasonNum}`);
            return;
          }
        }

        // Construit le lien complet
        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}/${href}`;

        const quality = parseQuality(title);
        const language = parseLanguage(title);

        console.log(`[WawaCity] Found matching result: ${title}`);

        results.push({
          title,
          pageUrl,
          quality,
          language,
          season: extractedSeason,
        });
      } catch {
        // Skip invalid items
      }
    });

    // Fallback: utilise les anciens sélecteurs si aucun résultat
    if (results.length === 0) {
      const selector = RESULT_SELECTORS[contentType];
      $(selector).each((_, element) => {
        try {
          const $link = $(element);
          const titleHtml = $link.html() || '';
          const title = $link.text().trim();
          const href = $link.attr('href') || '';

          if (!title || !href) return;

          // Extrait le nom et la saison (selon le type de contenu)
          const { name, season: extractedSeason } = extractName(titleHtml, contentType);

          // Vérifie que le nom correspond (Levenshtein, adapté au type de contenu)
          if (params.q && name) {
            if (!isNameMatch(params.q, name, contentType, '[WawaCity]')) {
              return;
            }
          }

          // Si on cherche une saison spécifique, vérifie
          if (params.season && contentType === 'series') {
            const seasonNum = parseInt(params.season, 10);
            if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
              return;
            }
          }

          const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}/${href}`;

          results.push({
            title,
            pageUrl,
            quality: parseQuality(title),
            language: parseLanguage(title),
            season: extractedSeason,
          });
        } catch {
          // Skip invalid items
        }
      });
    }

    return results;
  }

  private async parseDetailPage(
    searchResult: SearchResult,
    contentType: ContentType,
    params: SearchParams
  ): Promise<ScraperResult[]> {
    console.log(`[WawaCity] Fetching detail page: ${searchResult.pageUrl}`);

    const html = await fetchHtml(searchResult.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Extrait l'année et le titre original depuis .wa-block-body .detail-list li
    let pageYear: string | undefined;
    let originalTitle: string | undefined;

    $('.wa-block-body .detail-list li').each((_, li) => {
      const $li = $(li);
      const spanText = $li.find('span').first().text().trim();

      if (spanText.includes('Année')) {
        const yearText = $li.find('b').text().trim() || $li.find('a').text().trim();
        const yearMatch = yearText.match(/(\d{4})/);
        if (yearMatch) {
          pageYear = yearMatch[1];
          console.log(`[WawaCity] Found production year: ${pageYear}`);
        }
      }

      if (spanText.includes('Titre original')) {
        originalTitle = $li.find('b').text().trim();
        if (originalTitle) {
          console.log(`[WawaCity] Found original title: ${originalTitle}`);
        }
      }
    });

    // Vérifie si le titre original correspond mieux à la recherche
    if (params.q && originalTitle) {
      if (isNameMatch(params.q, originalTitle, contentType, '[WawaCity]')) {
        console.log(`[WawaCity] Original title "${originalTitle}" matches search query "${params.q}"`);
      }
    }

    // Extrait l'IMDb ID depuis les liens ou le texte (tt1234567)
    let imdbId: string | undefined;
    const imdbMatch = html.match(/imdb\.com\/title\/(tt\d{7,8})/i) || html.match(/\b(tt\d{7,8})\b/);
    if (imdbMatch) {
      imdbId = imdbMatch[1];
      console.log(`[WawaCity] Found IMDb ID: ${imdbId}`);
    }

    // Filtre par année si le paramètre est fourni et l'année est trouvée dans la page
    if (params.year && pageYear) {
      if (pageYear !== params.year) {
        console.log(`[WawaCity] Skipping "${searchResult.title}" - year ${pageYear} != ${params.year}`);
        return [];
      }
      console.log(`[WawaCity] Year filter passed: ${pageYear}`);
    } else if (params.year && !pageYear) {
      console.log(`[WawaCity] Year filter requested (${params.year}) but no year found on page - not filtering`);
    }

    // Parse le tableau #DDLLinkѕ (avec le ѕ cyrillique)
    const $table = $('#DDLLinkѕ, #DDLLinks');

    if ($table.length === 0) {
      console.log(`[WawaCity] No download table found on ${searchResult.pageUrl}`);
      return results;
    }

    // Variable pour tracker l'épisode courant (pour les séries)
    let currentEpisode: number | undefined;

    $table.find('tr').each((_, row) => {
      const $row = $(row);

      // Vérifie si c'est un titre d'épisode (tr.title.episode-title)
      if ($row.hasClass('title') && $row.hasClass('episode-title')) {
        const episodeText = $row.text();
        // Extrait le numéro d'épisode depuis "Épisode X" ou "Episode X"
        const episodeMatch = episodeText.match(/[ÉE]pisode\s*(\d+)/i);
        if (episodeMatch) {
          currentEpisode = parseInt(episodeMatch[1], 10);
          console.log(`[WawaCity] Found episode header: Episode ${currentEpisode}`);
        }
        return; // Passe à la ligne suivante
      }

      // Vérifie si c'est une ligne de lien (tr.link-row)
      if (!$row.hasClass('link-row')) {
        return;
      }

      const cells = $row.find('td');
      if (cells.length < 3) return;

      // Colonne 1: lien
      const $linkCell = $(cells[0]);
      const $link = $linkCell.find('a').first();
      const downloadLink = $link.attr('href');

      if (!downloadLink) {
        console.error(`[WawaCity] No download link found`);
        return;
      }

      // Colonne 2: hébergeur
      const hoster = $(cells[1]).text().trim();
      const hosterLower = hoster.toLowerCase();

      // Skip les liens "Anonyme" (pub)
      if (hosterLower === 'anonyme') {
        console.error(`[WawaCity] "Anonyme" hoster skipped`);
        return;
      }

      // Filtre par hébergeur si spécifié dans les params
      if (params.hoster) {
        const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
        if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
          console.log(`[WawaCity] Skipping hoster "${hoster}" - not in allowed list: ${params.hoster}`);
          return;
        }
        console.log(`[WawaCity] Accepted hoster "${hoster}" - in allowed list: ${params.hoster}`);
      }

      // Colonne 3: taille
      const sizeText = $(cells[2]).text().trim();
      const size = parseSize(sizeText);

      // Pour les séries, utilise l'épisode courant
      // Pour les films, currentEpisode sera undefined
      const episode = currentEpisode;

      // Filtre par épisode si spécifié dans les params
      if (params.ep && episode !== undefined && episode !== parseInt(params.ep, 10)) {
        return;
      }

      // Extrait qualité et langue du titre du résultat de recherche
      const quality = searchResult.quality || parseQuality(searchResult.title);
      const language = searchResult.language || parseLanguage(searchResult.title);

      // Construit le titre au format parsable par Radarr/Sonarr
      // Films: Titre.Année.Qualité.Language.Hoster
      // Séries: Titre.S01E05.Qualité.Language.Hoster
      // Nettoie le nom: enlève les crochets [xxx], les tirets et leur contenu, et les espaces multiples
      const baseName = searchResult.title
        .split(' - ')[0]
        .replace(/\[.*?\]/g, '')  // Enlève [HDLIGHT 1080p] etc.
        .replace(/\s+/g, ' ')     // Normalise les espaces
        .trim()
        .replace(/\s+/g, '.');    // Remplace les espaces par des points
      const parts: string[] = [baseName];

      if (contentType === 'movie' && pageYear) {
        parts.push(pageYear);
      }
      if (searchResult.season) {
        parts.push(`S${String(searchResult.season).padStart(2, '0')}${episode !== undefined ? `E${String(episode).padStart(2, '0')}` : ''}`);
      }
      if (quality) parts.push(quality.replace(/\s+/g, '.'));
      if (language) parts.push(language.replace(/\s+/g, '.'));
      if (hoster) parts.push(hoster.replace(/\s+/g, '.'));

      const title = parts.join('.');

      results.push({
        title,
        link: downloadLink,
        pageUrl: searchResult.pageUrl,
        size,
        quality,
        language,
        imdbId,
        season: searchResult.season,
        episode,
        contentType,
        pubDate: new Date(),
        year: pageYear ? parseInt(pageYear, 10) : undefined,
      });
    });

    console.log(`[WawaCity] Found ${results.length} download links on detail page`);
    return results;
  }

  async getDownloadLinks(pageUrl: string): Promise<string[]> {
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      const links: string[] = [];

      $('#DDLLinks tr, #DDLLinkѕ tr').each((index, row) => {
        if (index === 0) return; // Skip header
        const linkEl = $(row).find('a[href*="dl-protect"], a.link').first();
        const href = linkEl.attr('href');
        if (href) links.push(href);
      });

      // Fallback
      if (links.length === 0) {
        $('a[href*="dl-protect"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) links.push(href);
        });
      }

      console.log(`[WawaCity] Found ${links.length} download links`);
      return links;
    } catch (error) {
      console.error('[WawaCity] Error fetching download links:', error);
      return [];
    }
  }
}
