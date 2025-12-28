import * as cheerio from 'cheerio';
import { BaseScraper, parseQuality, parseLanguage, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtml, encodeSearchQuery } from '../utils/http.js';
import { isNameMatch, extractName, generateAccentVariants } from '../utils/text.js';

type ZTContentType = 'films' | 'series' | 'mangas';

// Mapping pour le paramètre de recherche
const CONTENT_TYPE_MAP: Record<string, ZTContentType> = {
  movie: 'films',
  series: 'series',
  anime: 'mangas',
};

interface SearchResult {
  title: string;
  pageUrl: string;
  quality?: string;
  language?: string;
  season?: number;
  needsOriginalTitleCheck?: boolean; // True if French title didn't match, need to check original title
}

export class ZoneTelechargerScraper implements BaseScraper {
  readonly name = 'Zone-Téléchargement';

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

    const ztType = CONTENT_TYPE_MAP[contentType];

    // Génère les variantes avec accents français
    const searchVariants = generateAccentVariants(params.q, 5);
    console.log(`[ZoneTelecharger] Search variants for "${params.q}":`, searchVariants);

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

        // Zone-Téléchargement limit: max 36 caractères (espaces inclus)
        // Si la limite est dépassée, la liste complète des films est renvoyée au lieu des résultats de recherche
        if (searchTerm.length > 36) {
          searchTerm = searchTerm.substring(0, 36).trim();
          console.log(`[ZoneTelecharger] Truncated search term to 36 chars: "${searchTerm}"`);
        }

        const baseSearchUrl = `${this.baseUrl}/?search=${encodeSearchQuery(searchTerm)}&p=${ztType}`;
        console.log(`[ZoneTelecharger] Searching ${contentType} with variant "${variant}": ${baseSearchUrl}`);

        try {
          return await this.fetchAllPages(baseSearchUrl, contentType, params);
        } catch (error) {
          console.error(`[ZoneTelecharger] Error searching variant "${variant}":`, error);
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

      console.log(`[ZoneTelecharger] Found ${allSearchResults.length} unique search results across all variants`);

      if (allSearchResults.length === 0) {
        return [];
      }

      // Pour chaque résultat, visite la page et récupère les liens de téléchargement
      const allResults: ScraperResult[] = [];

      // Limite à 10 résultats pour éviter trop de requêtes
      const pagesToVisit = allSearchResults.slice(0, 10);

      for (const result of pagesToVisit) {
        try {
          const episodes = await this.parseDetailPage(result, contentType, params, result.needsOriginalTitleCheck);
          allResults.push(...episodes);
        } catch (error) {
          console.error(`[ZoneTelecharger] Error parsing detail page ${result.pageUrl}:`, error);
        }
      }

      console.log(`[ZoneTelecharger] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[ZoneTelecharger] Search error for ${contentType}:`, error);
      return [];
    }
  }

  private async fetchAllPages(baseSearchUrl: string, contentType: ContentType, params: SearchParams): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;
    const maxPages = 5; // Limite pour éviter trop de requêtes

    while (currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? baseSearchUrl : `${baseSearchUrl}&page=${currentPage}`;
      console.log(`[ZoneTelecharger] Fetching page ${currentPage}: ${pageUrl}`);

      try {
        const html = await fetchHtml(pageUrl);
        const results = this.parseSearchResults(html, contentType, params);

        if (results.length === 0) {
          console.log(`[ZoneTelecharger] No results on page ${currentPage}, stopping pagination`);
          break;
        }

        allResults.push(...results);

        // Vérifie s'il y a une page suivante (div.navigation a[rel="next"])
        const $ = cheerio.load(html);
        const hasNextPage = $('div.navigation a[rel="next"]').length > 0;

        if (!hasNextPage) {
          console.log(`[ZoneTelecharger] No more pages after page ${currentPage}`);
          break;
        }

        currentPage++;
      } catch (error) {
        console.error(`[ZoneTelecharger] Error fetching page ${currentPage}:`, error);
        break;
      }
    }

    return allResults;
  }

  private parseSearchResults(html: string, contentType: ContentType, params: SearchParams): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    console.log(`[ZoneTelecharger] Parsing search results for ${contentType}`);

    // Parse les blocs .cover_global
    $('.cover_global').each((_, block) => {
      try {
        const $block = $(block);

        // Titre et lien dans div.cover_infos_title > a
        const $titleLink = $block.find('div.cover_infos_title > a').first();

        if ($titleLink.length === 0) return;

        const titleHtml = $titleLink.html() || '';
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';

        if (!title || !href) return;

        // Langue dans div.cover_infos_title > .detail_release > span > b
        const langText = $block.find('div.cover_infos_title .detail_release > span > b').text().trim();
        const language = parseLanguage(langText) || parseLanguage(title);

        // Extrait le nom et la saison depuis le titre (selon le type de contenu)
        const { name, season: extractedSeason } = extractName(titleHtml, contentType);

        console.log(`[ZoneTelecharger] Parsed title: "${title}" -> name="${name}", season=${extractedSeason}, lang="${langText}"`);

        // Vérifie que le nom correspond à la recherche (Levenshtein, adapté au type de contenu)
        // Pour les films, on est moins strict car on vérifiera le titre original sur la page détail
        let needsOriginalTitleCheck = false;
        if (params.q && name) {
          if (!isNameMatch(params.q, name, contentType, '[ZoneTelecharger]')) {
            if (contentType !== 'movie') {
              console.log(`[ZoneTelecharger] Skipping "${name}" - too different from "${params.q}"`);
              return;
            }
            console.log(`[ZoneTelecharger] Keeping "${name}" (movie) - will check original title on detail page`);
            needsOriginalTitleCheck = true;
          }
        }

        // Si on cherche une saison spécifique, vérifie que la saison correspond
        if (params.season && contentType === 'series') {
          const seasonNum = parseInt(params.season, 10);
          if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
            console.log(`[ZoneTelecharger] Skipping "${title}" - season ${extractedSeason} != ${seasonNum}`);
            return;
          }
        }

        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

        const quality = parseQuality(title);

        console.log(`[ZoneTelecharger] Found matching result: ${title}`);

        results.push({
          title,
          pageUrl,
          quality,
          language,
          season: extractedSeason,
          needsOriginalTitleCheck,
        });
      } catch {
        // Skip invalid items
      }
    });

    return results;
  }

  private async parseDetailPage(
    searchResult: SearchResult,
    contentType: ContentType,
    params: SearchParams,
    needsOriginalTitleCheck: boolean = false
  ): Promise<ScraperResult[]> {
    console.log(`[ZoneTelecharger] Fetching detail page: ${searchResult.pageUrl}`);

    const html = await fetchHtml(searchResult.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Extrait le titre original depuis "<strong><u>Titre original</u> :</strong> Title <br"
    let originalTitle: string | undefined;
    const bodyText = $('div.maincont, div.corps').text();
    const originalTitleMatch = html.match(/<strong><u>Titre original<\/u>\s*:<\/strong>\s*([^<]+)/i);
    if (originalTitleMatch) {
      originalTitle = originalTitleMatch[1].trim();
      console.log(`[ZoneTelecharger] Found original title: ${originalTitle}`);
    }

    // Si on doit vérifier le titre original et qu'il ne correspond pas, on skip
    if (needsOriginalTitleCheck && params.q) {
      const { name } = extractName(searchResult.title, contentType);
      const frenchMatches = name ? isNameMatch(params.q, name, contentType, '[ZoneTelecharger]') : false;
      const originalMatches = originalTitle ? isNameMatch(params.q, originalTitle, contentType, '[ZoneTelecharger]') : false;

      if (!frenchMatches && !originalMatches) {
        console.log(`[ZoneTelecharger] Skipping "${searchResult.title}" - neither French title "${name}" nor original "${originalTitle}" match "${params.q}"`);
        return [];
      }
      if (originalMatches && !frenchMatches) {
        console.log(`[ZoneTelecharger] Matched via original title: "${originalTitle}"`);
      }
    }

    // Extrait la taille du fichier depuis la page
    let fileSize: number | undefined;

    // Méthode 1: "Taille du fichier : X Go"
    const sizeMatch1 = bodyText.match(/Taille du fichier\s*:\s*([\d.,]+)\s*(Go|Mo|Ko|GB|MB|KB)/i);
    if (sizeMatch1) {
      fileSize = parseSize(`${sizeMatch1[1]} ${sizeMatch1[2]}`);
      console.log(`[ZoneTelecharger] Found file size (method 1): ${sizeMatch1[1]} ${sizeMatch1[2]}`);
    }

    // Méthode 2: "filename.mkv (X Go)" dans le font color="red"
    if (!fileSize) {
      const redText = $('font[color="red"]').text();
      const sizeMatch2 = redText.match(/\(([\d.,]+)\s*(Go|Mo|Ko|GB|MB|KB)\)/i);
      if (sizeMatch2) {
        fileSize = parseSize(`${sizeMatch2[1]} ${sizeMatch2[2]}`);
        console.log(`[ZoneTelecharger] Found file size (method 2): ${sizeMatch2[1]} ${sizeMatch2[2]}`);
      }
    }

    // Extrait qualité et langue depuis "Qualité HDLIGHT 1080p | VOSTFR"
    let pageQuality: string | undefined;
    let pageLanguage: string | undefined;

    const qualityDiv = $('div').filter((_, el) => {
      const text = $(el).text();
      return text.includes('Qualité') && text.includes('|');
    }).first();

    if (qualityDiv.length > 0) {
      const qualityText = qualityDiv.text().trim();
      const qualityMatch = qualityText.match(/Qualité\s+(.+?)\s*\|\s*(.+)/i);
      if (qualityMatch) {
        pageQuality = qualityMatch[1].trim();
        pageLanguage = qualityMatch[2].trim();
        console.log(`[ZoneTelecharger] Found quality: ${pageQuality}, language: ${pageLanguage}`);
      }
    }

    // Extrait l'IMDb ID depuis les liens ou le texte (tt1234567)
    let imdbId: string | undefined;
    const imdbMatch = html.match(/imdb\.com\/title\/(tt\d{7,8})/i) || html.match(/\b(tt\d{7,8})\b/);
    if (imdbMatch) {
      imdbId = imdbMatch[1];
      console.log(`[ZoneTelecharger] Found IMDb ID: ${imdbId}`);
    }

    // Extrait l'année de production depuis "<strong><u>Année de production</u> :</strong> 2006"
    let pageYear: string | undefined;
    const yearMatch = bodyText.match(/Année de production[^:]*:\s*(\d{4})/i);
    if (yearMatch) {
      pageYear = yearMatch[1];
      console.log(`[ZoneTelecharger] Found production year: ${pageYear}`);
    }

    // Filtre par année si le paramètre est fourni et l'année est trouvée dans la page
    if (params.year && pageYear) {
      if (pageYear !== params.year) {
        console.log(`[ZoneTelecharger] Skipping "${searchResult.title}" - year ${pageYear} != ${params.year}`);
        return [];
      }
      console.log(`[ZoneTelecharger] Year filter passed: ${pageYear}`);
    } else if (params.year && !pageYear) {
      console.log(`[ZoneTelecharger] Year filter requested (${params.year}) but no year found on page - not filtering`);
    }

    // Trouve le h2 contenant "Liens De Téléchargement :" puis le div.postinfo qui suit (imbriqué dans un div)
    const $h2 = $('h2').filter((_, el) => $(el).text().includes('Liens De Téléchargement'));

    // Le div.postinfo est dans un des éléments frères suivants du h2
    let $postinfo = $(''); // cheerio selection vide
    $h2.nextAll().each((_, el) => {
      const $el = $(el);
      // Vérifie si c'est directement un div.postinfo
      if ($el.is('div.postinfo')) {
        $postinfo = $el;
        return false; // break
      }
      // Sinon cherche un div.postinfo à l'intérieur
      const $found = $el.find('div.postinfo').first();
      if ($found.length > 0) {
        $postinfo = $found;
        return false; // break
      }
    });

    if ($postinfo.length === 0) {
      console.log(`[ZoneTelecharger] No download section found on ${searchResult.pageUrl}`);
    }

    if ($postinfo.length > 0) {
      let currentHoster = '';

      // Parcourt tous les éléments <b> dans le bloc
      $postinfo.find('> b').each((_, bElement) => {
        const $b = $(bElement);

        // Si c'est un <b><div>Hoster</div></b>, c'est le nom de l'hébergeur
        const $hosterDiv = $b.find('> div');
        if ($hosterDiv.length > 0) {
          currentHoster = $hosterDiv.text().trim();
          console.log(`[ZoneTelecharger] Found hoster: ${currentHoster}`);
          return; // continue
        }

        // Si c'est un <b><a>Episode X</a></b>, c'est un lien de téléechargement
        const $link = $b.find('> a[rel="external nofollow"]');
        if ($link.length > 0 && currentHoster) {
          const downloadLink = $link.attr('href');
          const linkText = $link.text().trim();

          if (!downloadLink) return;

          const hosterLower = currentHoster.toLowerCase();

          // Filtre par hébergeur si spécifié dans les params
          if (params.hoster) {
            const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
            if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
              console.log(`[ZoneTelecharger] Skipping hoster "${currentHoster}" - not in allowed list: ${params.hoster}`);
              return;
            }
          }

          // Extrait le numéro d'épisode depuis le texte du lien (ex: "Episode 1", "Episode 12 FiNAL")
          let episode: number | undefined;
          const episodeMatch = linkText.match(/[ÉE]pisode\s*(\d+)/i);
          if (episodeMatch) {
            episode = parseInt(episodeMatch[1], 10);
          }

          // Filtre par épisode si spécifié dans les params
          if (params.ep && episode !== undefined && episode !== parseInt(params.ep, 10)) {
            return;
          }

          const quality = pageQuality || searchResult.quality || parseQuality(searchResult.title);
          const language = pageLanguage || searchResult.language || parseLanguage(searchResult.title);

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
          if (currentHoster) parts.push(currentHoster.replace(/\s+/g, '.'));

          const title = parts.join('.');

          results.push({
            title,
            link: downloadLink,
            pageUrl: searchResult.pageUrl,
            size: fileSize,
            quality,
            language,
            imdbId,
            season: searchResult.season,
            episode,
            contentType,
            pubDate: new Date(),
            year: pageYear ? parseInt(pageYear, 10) : undefined,
          });
        }
      });
    }

    console.log(`[ZoneTelecharger] Found ${results.length} download links on detail page`);
    return results;
  }

  async getDownloadLinks(pageUrl: string): Promise<string[]> {
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      const links: string[] = [];

      // Parse les blocs div.postinfo
      $('div.postinfo b > a[rel="external nofollow"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) links.push(href);
      });

      // Fallback
      if (links.length === 0) {
        $('a[href*="dl-protect"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) links.push(href);
        });
      }

      console.log(`[ZoneTelecharger] Found ${links.length} download links`);
      return links;
    } catch (error) {
      console.error('[ZoneTelecharger] Error fetching download links:', error);
      return [];
    }
  }
}
