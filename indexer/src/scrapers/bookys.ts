import * as cheerio from 'cheerio';
import { BaseScraper, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtmlSmart } from '../utils/flaresolverr.js';
import { encodeSearchQuery } from '../utils/http.js';
import { config } from '../config.js';

interface BookysItem {
  title: string;
  pageUrl: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ResultCache {
  results: ScraperResult[];
  fetchedAt: number;
}

export class BookysScraper implements BaseScraper {
  readonly name = 'Bookys';
  private cache: ResultCache | null = null;
  private fetching = false;

  constructor(public readonly baseUrl: string) {
    // Pre-warm cache at startup
    this.fetching = true;
    console.log(`[Bookys] Pre-warming cache at startup...`);
    this.refreshCache({ q: '', limit: 100, offset: 0 }).finally(() => { this.fetching = false; });
  }

  /**
   * Generic search — only searches ebooks (journaux)
   */
  async search(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchEbooks(params);
  }

  async searchMovies(_params: SearchParams): Promise<ScraperResult[]> {
    return [];
  }

  async searchSeries(_params: SearchParams): Promise<ScraperResult[]> {
    return [];
  }

  async searchAnime(_params: SearchParams): Promise<ScraperResult[]> {
    return [];
  }

  /**
   * Search ebooks (journaux)
   * - With query: uses /search?q=...
   * - Without query: RSS mode, scrapes /journaux/new
   */
  async searchEbooks(params: SearchParams): Promise<ScraperResult[]> {
    try {
      // RSS mode (no query): use cache, refresh in background to avoid timeouts
      if (!params.q) {
        const now = Date.now();
        const cacheValid = this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS;

        if (cacheValid) {
          console.log(`[Bookys] Returning cached results (${this.cache!.results.length} items, age: ${Math.round((now - this.cache!.fetchedAt) / 1000)}s)`);
          return this.cache!.results;
        }

        // Cache miss or expired: trigger background refresh and return immediately
        if (!this.fetching) {
          this.fetching = true;
          console.log(`[Bookys] Cache miss — starting background scrape`);
          this.refreshCache(params).finally(() => { this.fetching = false; });
        } else {
          console.log(`[Bookys] Background scrape already in progress`);
        }

        // Return stale cache if available, empty otherwise
        if (this.cache) {
          console.log(`[Bookys] Returning stale cache while refreshing`);
          return this.cache.results;
        }
        console.log(`[Bookys] No cache yet — returning empty (will be ready on next poll)`);
        return [];
      }

      // Search mode (with query): scrape synchronously
      const items = await this.searchByQuery(params.q!);
      console.log(`[Bookys] Found ${items.length} items for query "${params.q}"`);
      if (items.length === 0) return [];

      const pagesToVisit = items.slice(0, 20);
      const concurrency = 5;
      const allResults: ScraperResult[] = [];
      for (let i = 0; i < pagesToVisit.length; i += concurrency) {
        const batch = pagesToVisit.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(item => this.parseDetailPage(item, params)));
        for (const result of batchResults) {
          if (result.status === 'fulfilled') allResults.push(...result.value);
          else console.error(`[Bookys] Error parsing detail page:`, result.reason);
        }
      }
      console.log(`[Bookys] Total results: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[Bookys] Search error:`, error);
      return [];
    }
  }

  /**
   * Full scrape: fetch list + all detail pages, store in cache
   */
  private async refreshCache(params: SearchParams): Promise<void> {
    try {
      const items = await this.fetchNewItems();
      console.log(`[Bookys] Background scrape: found ${items.length} items, fetching detail pages...`);
      const pagesToVisit = items.slice(0, 20);
      const concurrency = 5;
      const allResults: ScraperResult[] = [];
      for (let i = 0; i < pagesToVisit.length; i += concurrency) {
        const batch = pagesToVisit.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(item => this.parseDetailPage(item, params)));
        for (const result of batchResults) {
          if (result.status === 'fulfilled') allResults.push(...result.value);
        }
      }
      this.cache = { results: allResults, fetchedAt: Date.now() };
      console.log(`[Bookys] Background scrape complete: ${allResults.length} results cached`);
    } catch (error) {
      console.error(`[Bookys] Background scrape failed:`, error);
    }
  }

  /**
   * Fetch newest items from /journaux/new (RSS mode)
   */
  private async fetchNewItems(): Promise<BookysItem[]> {
    const allItems: BookysItem[] = [];
    const maxPages = config.searchMaxPages;

    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1
        ? `${this.baseUrl}/journaux/new`
        : `${this.baseUrl}/journaux/new?page=${page}`;

      console.log(`[Bookys] Fetching new items page ${page}: ${url}`);

      try {
        const html = await fetchHtmlSmart(url);
        const items = this.parseListPage(html);
        allItems.push(...items);

        // Check for next page
        const $ = cheerio.load(html);
        const hasNextPage = $('a[rel="next"]').length > 0;
        if (!hasNextPage) {
          console.log(`[Bookys] No more pages after page ${page}`);
          break;
        }
      } catch (error) {
        console.error(`[Bookys] Error fetching page ${page}:`, error);
        break;
      }
    }

    return allItems;
  }

  /**
   * Search by query using /search endpoint
   */
  private async searchByQuery(query: string): Promise<BookysItem[]> {
    const searchUrl = `${this.baseUrl}/search?q=${encodeSearchQuery(query)}`;
    console.log(`[Bookys] Searching: ${searchUrl}`);

    try {
      const html = await fetchHtmlSmart(searchUrl);
      // Filter only /journaux/ results
      const allItems = this.parseListPage(html);
      // Search results are not sorted by date: item IDs grow over time, so newest first
      const itemId = (item: BookysItem) => parseInt(item.pageUrl.match(/\/journaux\/(\d+)/)?.[1] || '0', 10);
      const journauxItems = allItems
        .filter(item => item.pageUrl.includes('/journaux/'))
        .sort((a, b) => itemId(b) - itemId(a));

      console.log(`[Bookys] Search returned ${allItems.length} items, ${journauxItems.length} journaux`);
      return journauxItems;
    } catch (error) {
      console.error(`[Bookys] Search error:`, error);
      return [];
    }
  }

  /**
   * Parse a list page (new or search results) to extract item links
   */
  private parseListPage(html: string): BookysItem[] {
    const $ = cheerio.load(html);
    const items: BookysItem[] = [];

    $('.bys-items-container a.bys-item').each((_, element) => {
      try {
        const $item = $(element);
        const href = $item.attr('href');
        const title = $item.find('.item-details b.font-bold').first().text().trim();

        if (!href || !title) return;

        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

        items.push({ title, pageUrl });
      } catch {
        // Skip invalid items
      }
    });

    // Search results page: table rows with a plain title link
    $('#search_table a.bys-link').each((_, element) => {
      const href = $(element).attr('href');
      const title = $(element).text().trim();
      if (!href || !title) return;
      const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
      items.push({ title, pageUrl });
    });

    return items;
  }

  /**
   * Resolve a Bookys /dl/ intermediate page to the final hoster URL
   */
  private async resolveDownloadLink(dlUrl: string): Promise<string> {
    const html = await fetchHtmlSmart(dlUrl);
    const $ = cheerio.load(html);

    // Find the external hoster link (not pointing back to bookys-ebooks.com)
    let finalLink: string | undefined;
    $('a.bys-host').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('bookys-ebooks.com')) {
        finalLink = href.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        return false; // break
      }
    });

    return finalLink || dlUrl;
  }

  /**
   * Parse a detail page to extract download links
   */
  private async parseDetailPage(
    item: BookysItem,
    params: SearchParams
  ): Promise<ScraperResult[]> {
    console.log(`[Bookys] Fetching detail page: ${item.pageUrl}`);

    const html = await fetchHtmlSmart(item.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Extract title from h1
    const pageTitle = $('h1[itemprop="name"]').text().trim() || item.title;

    // Extract date from meta tag
    let pubDate: Date | undefined;
    const releaseDateStr = $('meta[name="book:release_date"]').attr('content');
    if (releaseDateStr) {
      pubDate = new Date(releaseDateStr);
      if (isNaN(pubDate.getTime())) {
        pubDate = undefined;
      }
    }

    // Extract item ID
    const itemId = $('meta[name="item_id"]').attr('content');

    // Parse download table
    $('#links-wrapper table tbody tr[data-id]').each((_, row) => {
      try {
        const $row = $(row);
        const cells = $row.find('td');
        if (cells.length < 4) return;

        // Hoster name and download link
        const $hostLink = $(cells[0]).find('a.bys-host').first();
        const hoster = $hostLink.text().trim();
        const downloadLink = $hostLink.attr('href');

        if (!hoster || !downloadLink) return;

        const hosterLower = hoster.toLowerCase();

        // Filter by hoster (params.hoster if set, otherwise default from config)
        const hosterFilter = params.hoster || config.bookysHoster;
        const allowedHosters = hosterFilter.toLowerCase().split(',').map(h => h.trim());
        if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
          console.log(`[Bookys] Skipping hoster "${hoster}" - not in allowed list: ${hosterFilter}`);
          return;
        }

        // Format
        const format = $(cells[1]).text().trim(); // e.g., "PDF"

        // Language
        const language = $(cells[2]).text().trim(); // e.g., "Français"

        // Size
        const sizeText = $(cells[3]).text().trim(); // e.g., "653 MB"
        const size = parseSize(sizeText);

        // Build formatted title
        // "Journaux Français Locaux Du Lundi 23 Février 2026" → "Journaux.Français.Locaux.Du.Lundi.23.Février.2026.PDF.FRENCH.1fichier"
        const cleanTitle = pageTitle
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, '.')
          .replace(/\.{2,}/g, '.');

        const titleParts: string[] = [cleanTitle];
        if (format) titleParts.push(format.toUpperCase());
        if (language) {
          // Normalize language
          const langUpper = language.toUpperCase();
          if (langUpper.includes('FRAN')) {
            titleParts.push('FRENCH');
          } else {
            titleParts.push(langUpper);
          }
        }
        titleParts.push(hoster);

        const formattedTitle = titleParts.join('.');

        // Full download link
        const fullDownloadLink = downloadLink.startsWith('http')
          ? downloadLink
          : `${this.baseUrl}${downloadLink}`;

        results.push({
          title: formattedTitle,
          link: fullDownloadLink,
          pageUrl: item.pageUrl,
          size,
          quality: format || undefined,
          language: language || undefined,
          pubDate,
          contentType: 'ebook' as ContentType,
        });

        console.log(`[Bookys] Found download: ${formattedTitle} (${hoster}, ${sizeText})`);
      } catch {
        // Skip invalid rows
      }
    });

    // Resolve intermediate /dl/ links to final hoster URLs
    const resolvedResults = await Promise.all(
      results.map(async (result) => {
        if (result.link.includes('/dl/')) {
          try {
            const finalLink = await this.resolveDownloadLink(result.link);
            console.log(`[Bookys] Resolved link: ${result.link} → ${finalLink}`);
            return { ...result, link: finalLink };
          } catch (err) {
            console.error(`[Bookys] Failed to resolve link ${result.link}:`, err);
            return result;
          }
        }
        return result;
      })
    );

    console.log(`[Bookys] Found ${resolvedResults.length} download links on detail page`);
    return resolvedResults;
  }
}
