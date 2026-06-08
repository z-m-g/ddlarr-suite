import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config.js';
import { generateDownloadHash } from '../utils/hash.js';
import {
  analyzeTorrent,
  extractNameFromTorrentBuffer,
  extractSizeFromTorrentBuffer,
} from '../utils/torrent.js';
import { isDlProtectLink, resolveDlProtectLink } from '../utils/dlprotect.js';
import { isBookysLink, resolveBookysLink } from '../utils/bookys.js';
import { debridLink, debridTorrent, debridMagnet, isAnyDebridEnabled, getTorrentEnabledServices } from '../debrid/index.js';
import { startDownload, stopDownload, pauseDownload, getDownloadProgress, isDownloadActive, isDownloadPaused, getPausedDownloadInfo, RETRYABLE_CURL_CODES } from './downloader.js';
import * as repository from '../db/repository.js';
import type { Download, DownloadState, DownloadType } from '../types/download.js';

/**
 * Format bytes per second to human readable speed
 */
function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Get the real filename from a URL by checking Content-Disposition header
 */
// Known error URL patterns that indicate the file is not available
const ERROR_URL_PATTERNS = [
  '/article/premium',      // Rapidgator
  '/error',                // Generic
  '/404',                  // Generic
  '/not-found',            // Generic
  '/file-not-found',       // Generic
  '/deleted',              // Generic
  '/removed',              // Generic
  '/unavailable',          // Generic
];

/**
 * Check if a URL is an error/redirect page
 */
function isErrorUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.toLowerCase();
    return ERROR_URL_PATTERNS.some(pattern => path.includes(pattern));
  } catch {
    return false;
  }
}

async function getRealFilename(url: string, fallbackName: string): Promise<string> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });

    // Check for HTTP errors (404, etc.) - throw to be caught by caller
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check if we were redirected to an error page (e.g., rapidgator premium page)
    const finalUrl = response.url;
    if (isErrorUrl(finalUrl)) {
      throw new Error(`HTTP redirect to error page: ${finalUrl}`);
    }

    // Check Content-Type - if it's HTML when we expect a file, it's probably an error page
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      // Some hosters return HTML error pages with 200 status
      throw new Error(`HTTP invalid content-type: ${contentType} (expected file, got HTML)`);
    }

    // Check Content-Disposition header for filename
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      // Try filename*= (RFC 5987 - UTF-8 encoded)
      const utf8Match = contentDisposition.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
      if (utf8Match) {
        const filename = decodeURIComponent(utf8Match[1].replace(/['"]/g, ''));
        console.log(`[DownloadManager] Got filename from Content-Disposition (UTF-8): ${filename}`);
        return filename;
      }

      // Try regular filename=
      const match = contentDisposition.match(/filename=["']?([^"';\n]+)["']?/i);
      if (match) {
        const filename = match[1].trim();
        console.log(`[DownloadManager] Got filename from Content-Disposition: ${filename}`);
        return filename;
      }
    }

    // Try to get filename from final URL (after redirects)
    const urlPath = new URL(finalUrl).pathname;
    const urlFilename = decodeURIComponent(urlPath.split('/').pop() || '');
    if (urlFilename && urlFilename.includes('.')) {
      console.log(`[DownloadManager] Got filename from URL: ${urlFilename}`);
      return urlFilename;
    }
  } catch (error: any) {
    // Re-throw HTTP errors so they can be handled by the caller
    if (error.message.startsWith('HTTP ')) {
      throw error;
    }
    console.log(`[DownloadManager] Could not get real filename: ${error.message}`);
  }

  // Check if fallback already has an extension
  if (fallbackName.includes('.')) {
    return fallbackName;
  }

  // Try to extract extension from URL
  try {
    const urlPath = new URL(url).pathname;
    const ext = urlPath.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
    if (ext) {
      return `${fallbackName}.${ext[1]}`;
    }
  } catch {}

  return fallbackName;
}

class DownloadManager {
  private processing = false;
  // Track active debrid operations for cancellation
  private activeDebridOperations = new Map<string, { cancelled: boolean }>();
  // Downloads parked while the debrid service caches the torrent/magnet
  // server-side ("Queued on..."/"Downloading on debrid:"). They use no local
  // bandwidth, so they don't occupy a local download slot.
  private debridWaiting = new Set<string>();
  // Track retry attempts per download hash
  private retryCount = new Map<string, number>();
  private static readonly MAX_DOWNLOAD_RETRIES = 3;

  /**
   * Get the path where torrent files are stored
   */
  private getTorrentStoragePath(): string {
    const config = getConfig();
    const torrentDir = path.join(config.dataPath, 'torrents');
    if (!fs.existsSync(torrentDir)) {
      fs.mkdirSync(torrentDir, { recursive: true });
    }
    return torrentDir;
  }

  /**
   * Save torrent file for later use
   */
  private saveTorrentFile(hash: string, torrentData: Buffer): void {
    const torrentPath = path.join(this.getTorrentStoragePath(), `${hash}.torrent`);
    fs.writeFileSync(torrentPath, torrentData);
    console.log(`[DownloadManager] Saved torrent file: ${torrentPath}`);
  }

  /**
   * Load torrent file
   */
  private loadTorrentFile(hash: string): Buffer | null {
    const torrentPath = path.join(this.getTorrentStoragePath(), `${hash}.torrent`);
    if (fs.existsSync(torrentPath)) {
      return fs.readFileSync(torrentPath);
    }
    return null;
  }

  /**
   * Delete torrent file
   */
  private deleteTorrentFile(hash: string): void {
    const torrentPath = path.join(this.getTorrentStoragePath(), `${hash}.torrent`);
    if (fs.existsSync(torrentPath)) {
      fs.unlinkSync(torrentPath);
      console.log(`[DownloadManager] Deleted torrent file: ${torrentPath}`);
    }
  }

  /**
   * Add a torrent from file data
   */
  async addTorrent(
    torrentData: Buffer,
    options: { savePath?: string; category?: string; paused?: boolean } = {}
  ): Promise<string> {
    // Analyze torrent to determine type
    const analysis = analyzeTorrent(torrentData);
    if (!analysis) {
      throw new Error('Invalid torrent file');
    }

    const config = getConfig();

    // Build save path with category subfolder if specified
    let savePath = options.savePath || config.downloadPath;
    if (options.category && !options.savePath) {
      savePath = `${config.downloadPath}/${options.category}`;
    }

    if (analysis.type === 'ddl') {
      // DDL fake torrent - use info hash for Sonarr/Radarr tracking
      const hash = analysis.infoHash;

      const download: Omit<Download, 'downloadSpeed'> = {
        hash,
        name: analysis.name,
        type: 'ddl',
        originalLink: analysis.ddlLink!,
        debridedLink: null,
        debridTorrentId: null,
        savePath,
        totalSize: analysis.size,
        downloadedSize: 0,
        state: options.paused ? 'paused' : 'queued',
        statusMessage: null,
        errorMessage: null,
        addedAt: Date.now(),
        startedAt: null,
        completedAt: null,
        category: options.category || null,
        priority: 0,
      };

      repository.createDownload(download);
      console.log(`[DownloadManager] Added DDL download: ${analysis.name} (${hash})`);

      if (!options.paused) {
        this.processQueue();
      }

      return hash;
    } else {
      // Real torrent - check if debrid service supports it
      const torrentServices = getTorrentEnabledServices();
      if (torrentServices.length === 0) {
        throw new Error('No debrid service with torrent support is enabled');
      }

      const hash = analysis.infoHash!;

      // Save torrent file for later processing
      this.saveTorrentFile(hash, torrentData);

      const download: Omit<Download, 'downloadSpeed'> = {
        hash,
        name: analysis.name,
        type: 'real',
        originalLink: hash,  // Store info hash as original link for real torrents
        debridedLink: null,
        debridTorrentId: null,
        savePath,
        totalSize: analysis.size,
        downloadedSize: 0,
        state: options.paused ? 'paused' : 'queued',
        statusMessage: null,
        errorMessage: null,
        addedAt: Date.now(),
        startedAt: null,
        completedAt: null,
        category: options.category || null,
        priority: 0,
      };

      repository.createDownload(download);
      console.log(`[DownloadManager] Added real torrent: ${analysis.name} (${hash})`);

      if (!options.paused) {
        this.processQueue();
      }

      return hash;
    }
  }

  /**
   * Add a download from URL
   * If the URL points to a .torrent file, it will be downloaded and processed as a torrent
   */
  async addUrl(
    url: string,
    options: { savePath?: string; category?: string; paused?: boolean; name?: string } = {}
  ): Promise<string> {
    // Check if URL points to a .torrent file using HEAD request
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();

      // Quick check by extension first, then verify with HEAD request
      let isTorrentFile = pathname.endsWith('.torrent');

      if (!isTorrentFile) {
        // Check Content-Type via HEAD request
        try {
          const headResponse = await fetch(url, { method: 'HEAD', redirect: 'follow' });
          if (headResponse.ok) {
            const contentType = headResponse.headers.get('content-type') || '';
            isTorrentFile = contentType.includes('application/x-bittorrent') ||
                           contentType.includes('application/x-torrent');
          }
        } catch {
          // HEAD request failed, continue with extension-based detection
        }
      }

      if (isTorrentFile) {
        console.log(`[DownloadManager] URL points to .torrent file, downloading: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download torrent file: HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const torrentData = Buffer.from(arrayBuffer);
        return this.addTorrent(torrentData, options);
      }
    } catch (error: any) {
      // If it's a torrent download error, rethrow it
      if (error.message.includes('torrent')) {
        throw error;
      }
      // Otherwise continue with regular URL handling
      console.log(`[DownloadManager] URL parsing failed, treating as direct link: ${error.message}`);
    }

    // Detect magnet URIs
    if (url.startsWith('magnet:')) {
      const torrentServices = getTorrentEnabledServices();
      if (torrentServices.length === 0) {
        throw new Error('No debrid service with torrent support is enabled');
      }

      const hash = generateDownloadHash(url);
      const config = getConfig();

      // Extract name from magnet dn= parameter
      let name = options.name;
      if (!name) {
        try {
          const magnetUrl = new URL(url);
          const dn = magnetUrl.searchParams.get('dn');
          name = dn ? decodeURIComponent(dn) : `magnet_${Date.now()}`;
        } catch {
          name = `magnet_${Date.now()}`;
        }
      }

      let savePath = options.savePath || config.downloadPath;
      if (options.category && !options.savePath) {
        savePath = `${config.downloadPath}/${options.category}`;
      }

      const download: Omit<Download, 'downloadSpeed'> = {
        hash,
        name,
        type: 'magnet',
        originalLink: url,
        debridedLink: null,
        debridTorrentId: null,
        savePath,
        totalSize: 0,
        downloadedSize: 0,
        state: options.paused ? 'paused' : 'queued',
        statusMessage: null,
        errorMessage: null,
        addedAt: Date.now(),
        startedAt: null,
        completedAt: null,
        category: options.category || null,
        priority: 0,
      };

      repository.createDownload(download);
      console.log(`[DownloadManager] Added magnet download: ${name} (${hash})`);

      if (!options.paused) {
        this.processQueue();
      }

      return hash;
    }

    const hash = generateDownloadHash(url);
    const config = getConfig();

    let name = options.name;
    if (!name) {
      try {
        const urlObj = new URL(url);
        name = decodeURIComponent(urlObj.pathname.split('/').pop() || '') || `download_${Date.now()}`;
      } catch {
        name = `download_${Date.now()}`;
      }
    }

    // Build save path with category subfolder if specified
    let savePath = options.savePath || config.downloadPath;
    if (options.category && !options.savePath) {
      savePath = `${config.downloadPath}/${options.category}`;
    }

    const download: Omit<Download, 'downloadSpeed'> = {
      hash,
      name,
      type: 'ddl',  // URL downloads are always treated as DDL
      originalLink: url,
      debridedLink: null,
      debridTorrentId: null,
      savePath,
      totalSize: 0,
      downloadedSize: 0,
      state: options.paused ? 'paused' : 'queued',
      statusMessage: null,
      errorMessage: null,
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      category: options.category || null,
      priority: 0,
    };

    repository.createDownload(download);
    console.log(`[DownloadManager] Added URL download: ${name} (${hash})`);

    if (!options.paused) {
      this.processQueue();
    }

    return hash;
  }

  /**
   * Pause downloads
   */
  pause(hashes: string[]): void {
    for (const hash of hashes) {
      const download = repository.getDownloadByHash(hash);
      if (!download) continue;

      if (download.state === 'downloading') {
        // Save current progress to database before pausing
        const progress = getDownloadProgress(hash);
        if (progress) {
          repository.updateDownloadProgress(
            hash,
            progress.downloadedBytes,
            progress.totalBytes,
            0  // Speed is 0 when paused
          );
          console.log(`[DownloadManager] Saved progress before pause: ${progress.downloadedBytes}/${progress.totalBytes}`);
        }
        // Use pauseDownload to keep temp file for resume
        pauseDownload(hash);
      }

      if (download.state === 'queued' || download.state === 'downloading' || download.state === 'checking') {
        repository.updateDownloadState(hash, 'paused');
        console.log(`[DownloadManager] Paused: ${hash}`);
      }
    }
  }

  /**
   * Resume downloads
   */
  resume(hashes: string[]): void {
    for (const hash of hashes) {
      const download = repository.getDownloadByHash(hash);
      if (!download) continue;

      if (download.state === 'paused') {
        repository.updateDownloadState(hash, 'queued');
        console.log(`[DownloadManager] Resumed: ${hash}`);
      }
    }
    this.processQueue();
  }

  /**
   * Force start downloads immediately, bypassing the concurrency limit.
   * Useful when a download is stuck waiting in the queue.
   */
  forceStart(hashes: string[]): void {
    for (const hash of hashes) {
      const download = repository.getDownloadByHash(hash);
      if (!download) continue;

      if (download.state === 'queued' || download.state === 'paused') {
        console.log(`[DownloadManager] Force starting: ${download.name}`);
        // Start now without going through processQueue so the concurrency
        // limit doesn't hold it back. startProcessing handles paused/resume.
        this.startProcessingInBackground(download);
      }
    }
  }

  /**
   * Delete downloads
   */
  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    for (const hash of hashes) {
      const download = repository.getDownloadByHash(hash);
      if (!download) continue;

      // Clean up retry tracking
      this.retryCount.delete(hash);

      // Cancel any active debrid operation (for real torrents in checking state)
      if (this.activeDebridOperations.has(hash)) {
        console.log(`[DownloadManager] Cancelling debrid operation for: ${hash}`);
        this.activeDebridOperations.get(hash)!.cancelled = true;
        this.activeDebridOperations.delete(hash);
      }

      // Stop if downloading
      if (download.state === 'downloading') {
        stopDownload(hash);
      }

      // Delete file/folder if requested
      if (deleteFiles) {
        const filePath = path.join(download.savePath, download.name);
        try {
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
              // Multi-file torrent: delete folder recursively
              fs.rmSync(filePath, { recursive: true, force: true });
              console.log(`[DownloadManager] Deleted folder: ${filePath}`);
            } else {
              // Single file: delete file
              fs.unlinkSync(filePath);
              console.log(`[DownloadManager] Deleted file: ${filePath}`);
            }
          }
        } catch (error: any) {
          console.error(`[DownloadManager] Error deleting file/folder: ${error.message}`);
        }
      }

      // Delete stored torrent file if real torrent
      if (download.type === 'real') {
        this.deleteTorrentFile(hash);
      }

      repository.deleteDownload(hash);
      console.log(`[DownloadManager] Deleted download: ${hash}`);
    }

    // Trigger queue processing since a slot may have freed up
    this.processQueue();
  }

  /**
   * Get all downloads
   */
  getAll(filter?: DownloadState): Download[] {
    const downloads = filter
      ? repository.getDownloadsByState(filter)
      : repository.getAllDownloads();

    // Update progress for active and paused downloads
    return downloads.map(download => {
      if (download.state === 'downloading' && isDownloadActive(download.hash)) {
        const progress = getDownloadProgress(download.hash);
        if (progress) {
          return {
            ...download,
            downloadedSize: progress.downloadedBytes,
            totalSize: progress.totalBytes || download.totalSize,
            downloadSpeed: progress.downloadSpeed,
          };
        }
      }
      // For paused downloads, get saved progress info
      if (download.state === 'paused' && isDownloadPaused(download.hash)) {
        const pausedInfo = getPausedDownloadInfo(download.hash);
        if (pausedInfo) {
          return {
            ...download,
            downloadedSize: pausedInfo.downloadedBytes,
            totalSize: pausedInfo.totalBytes || download.totalSize,
            downloadSpeed: 0,
          };
        }
      }
      return download;
    });
  }

  /**
   * Get download by hash
   */
  getByHash(hash: string): Download | null {
    const download = repository.getDownloadByHash(hash);
    if (!download) return null;

    // Update progress for active download
    if (download.state === 'downloading' && isDownloadActive(hash)) {
      const progress = getDownloadProgress(hash);
      if (progress) {
        return {
          ...download,
          downloadedSize: progress.downloadedBytes,
          totalSize: progress.totalBytes || download.totalSize,
          downloadSpeed: progress.downloadSpeed,
        };
      }
    }

    // For paused downloads, get saved progress info
    if (download.state === 'paused' && isDownloadPaused(hash)) {
      const pausedInfo = getPausedDownloadInfo(hash);
      if (pausedInfo) {
        return {
          ...download,
          downloadedSize: pausedInfo.downloadedBytes,
          totalSize: pausedInfo.totalBytes || download.totalSize,
          downloadSpeed: 0,
        };
      }
    }

    return download;
  }

  /**
   * Process the download queue
   */
  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const config = getConfig();
      const active = [
        ...repository.getDownloadsByState('downloading'),
        ...repository.getDownloadsByState('checking'),
      ];

      // Downloads parked waiting for the debrid service to cache the torrent
      // server-side don't use any local bandwidth, so they don't count against
      // the local download limit.
      const localActive = active.filter(d => !this.debridWaiting.has(d.hash)).length;

      // Local (actually transferring) downloads are capped by maxConcurrentDownloads.
      // A bounded headroom lets a few extra torrents pre-cache on debrid in
      // parallel so a long server-side wait never blocks the whole queue, without
      // flooding the debrid service.
      const localSlots = config.maxConcurrentDownloads - localActive;
      const totalSlots = config.maxConcurrentDownloads * 2 - active.length;
      const slotsAvailable = Math.min(localSlots, totalSlots);

      if (slotsAvailable <= 0) {
        return;
      }

      const queued = repository.getDownloadsByState('queued');

      for (let i = 0; i < Math.min(slotsAvailable, queued.length); i++) {
        // Kick off processing without awaiting: link resolution and debrid
        // caching run in the background so they neither block the queue nor
        // hold the processing lock. Each download drives further queue progress
        // via processQueue() as its state changes.
        this.startProcessingInBackground(queued[i]);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Start processing a download in the background, isolating unexpected errors
   * so one failure can never reject processQueue or stall the queue.
   */
  private startProcessingInBackground(download: Download): void {
    this.startProcessing(download).catch((err: any) => {
      console.error(`[DownloadManager] Unexpected error processing ${download.name}: ${err?.message || err}`);
      this.debridWaiting.delete(download.hash);
      const dl = repository.getDownloadByHash(download.hash);
      if (dl && dl.state !== 'completed') {
        repository.updateDownloadState(download.hash, 'error', err?.message || 'Processing failed');
      }
      this.processQueue();
    });
  }

  /**
   * Mark a download as waiting on the debrid service (server-side caching).
   * Frees its local slot and lets the queue start another download. Triggering
   * processQueue only on the first transition avoids re-running it on every poll.
   */
  private markDebridWaiting(hash: string): void {
    if (this.debridWaiting.has(hash)) return;
    this.debridWaiting.add(hash);
    this.processQueue();
  }

  /**
   * Start processing a download (resolve links, debrid, start download)
   */
  private async startProcessing(download: Download): Promise<void> {
    // Route to appropriate handler based on type
    if (download.type === 'real') {
      await this.startProcessingRealTorrent(download);
    } else if (download.type === 'magnet') {
      await this.startProcessingMagnet(download);
    } else {
      await this.startProcessingDdl(download);
    }
  }

  /**
   * Extract curl exit code from an error thrown by the downloader
   */
  private getCurlExitCode(error: Error): number | null {
    const typed = error as Error & { curlExitCode?: number };
    if (typed.curlExitCode !== undefined) return typed.curlExitCode;
    const match = error.message.match(/Download failed with code (\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Attempt to retry a failed download if the error is retryable.
   * For DDL downloads, obtains a fresh debrid URL before retrying.
   * For torrent/magnet downloads, retries with the same URL (resume from temp file).
   */
  private async retryDownloadOnError(
    hash: string,
    name: string,
    originalLink: string | null,
    error: Error,
    restartFn: (freshUrl: string) => void,
    failFn: () => void,
  ): Promise<void> {
    const curlCode = this.getCurlExitCode(error);
    const currentRetries = this.retryCount.get(hash) || 0;

    if (
      curlCode !== null &&
      RETRYABLE_CURL_CODES.has(curlCode) &&
      currentRetries < DownloadManager.MAX_DOWNLOAD_RETRIES
    ) {
      this.retryCount.set(hash, currentRetries + 1);
      const attempt = currentRetries + 1;
      console.log(`[DownloadManager] Retryable error (curl code ${curlCode}) for ${name}, attempt ${attempt}/${DownloadManager.MAX_DOWNLOAD_RETRIES}`);

      // Check download still exists (user may have deleted it during failure)
      const dl = repository.getDownloadByHash(hash);
      if (!dl || dl.state === 'completed') {
        console.log(`[DownloadManager] Download ${hash} no longer active, skipping retry`);
        this.retryCount.delete(hash);
        return;
      }

      repository.updateDownloadStatusMessage(hash, `Retry ${attempt}/${DownloadManager.MAX_DOWNLOAD_RETRIES}...`);

      // Wait before retrying to avoid spamming
      await new Promise(resolve => setTimeout(resolve, 3000));

      try {
        let freshUrl = originalLink;
        // Re-debrid only for DDL downloads where we have an original (pre-debrid) link
        if (originalLink && isAnyDebridEnabled()) {
          repository.updateDownloadStatusMessage(hash, `Retry ${attempt}/${DownloadManager.MAX_DOWNLOAD_RETRIES}: re-debriding...`);
          const debridedUrl = await debridLink(originalLink);
          if (debridedUrl && debridedUrl !== originalLink) {
            repository.updateDownloadLink(hash, debridedUrl);
            freshUrl = debridedUrl;
          }
        }

        repository.updateDownloadState(hash, 'downloading');
        repository.updateDownloadStatusMessage(hash, `Retry ${attempt}/${DownloadManager.MAX_DOWNLOAD_RETRIES}: downloading...`);
        restartFn(freshUrl!);
      } catch (retryError: any) {
        console.error(`[DownloadManager] Retry failed for ${name}: ${retryError.message}`);
        this.retryCount.delete(hash);
        failFn();
      }
    } else {
      this.retryCount.delete(hash);
      failFn();
    }
  }

  /**
   * Process a real torrent (upload to debrid, wait for completion, download files)
   */
  private async startProcessingRealTorrent(download: Download): Promise<void> {
    const { hash, name, savePath } = download;

    // Track this debrid operation for cancellation
    const operation = { cancelled: false };
    this.activeDebridOperations.set(hash, operation);

    try {
      repository.updateDownloadState(hash, 'checking');

      // Load torrent file
      const torrentBuffer = this.loadTorrentFile(hash);
      if (!torrentBuffer) {
        throw new Error('Torrent file not found');
      }

      // Upload to debrid service
      repository.updateDownloadStatusMessage(hash, 'Uploading torrent to debrid...');
      console.log(`[DownloadManager] Uploading real torrent: ${name}`);

      const config = getConfig();
      const timeoutMs = config.debridTorrentTimeoutHours * 60 * 60 * 1000;

      const result = await debridTorrent(
        torrentBuffer,
        `${name}.torrent`,
        (status, serviceName) => {
          // Check if cancelled during polling
          if (operation.cancelled) {
            throw new Error('Download cancelled');
          }
          // Update status message based on debrid status
          if (status.status === 'queued') {
            repository.updateDownloadStatusMessage(hash, `Queued on ${serviceName}...`);
          } else if (status.status === 'downloading') {
            repository.updateDownloadStatusMessage(hash, `Downloading on debrid: ${status.progress}%`);
          }
          // The torrent is being cached server-side: free our local slot so
          // other downloads can start while we wait.
          this.markDebridWaiting(hash);
        },
        timeoutMs
      );

      // Server-side caching is done; reclaim the local slot for the actual download.
      this.debridWaiting.delete(hash);

      // Check if cancelled after debrid completed
      if (operation.cancelled) {
        console.log(`[DownloadManager] Real torrent cancelled after debrid: ${name}`);
        return;
      }

      console.log(`[DownloadManager] Torrent ready on ${result.service}, ${result.downloadLinks.length} file(s)`);

      // Note: Don't delete torrent file here - it's needed for /files endpoint
      // It will be deleted when the download is removed via delete()

      // If single file, download it directly
      // If multiple files, download each sequentially
      if (result.downloadLinks.length === 1) {
        const debridedUrl = result.downloadLinks[0];
        repository.updateDownloadLink(hash, debridedUrl);

        // Get real filename
        repository.updateDownloadStatusMessage(hash, 'Getting file info...');
        let actualName = name;
        try {
          actualName = await getRealFilename(debridedUrl, name);
          if (actualName !== name) {
            repository.updateDownloadName(hash, actualName);
          }
        } catch (error: any) {
          console.log(`[DownloadManager] Could not get real filename: ${error.message}`);
        }

        // Start download
        repository.updateDownloadStatusMessage(hash, null);
        repository.updateDownloadState(hash, 'downloading');

        startDownload(hash, debridedUrl, actualName, {
          onProgress: (progress) => {
            repository.updateDownloadProgress(hash, progress.downloadedBytes, progress.totalBytes, progress.downloadSpeed);
          },
          onMoving: (finalPath) => {
            const dl = repository.getDownloadByHash(hash);
            if (dl && dl.totalSize > 0) {
              repository.updateDownloadProgress(hash, dl.totalSize, dl.totalSize, 0);
            }
            repository.updateDownloadStatusMessage(hash, `Moving to ${finalPath}...`);
          },
          onMoveProgress: (copiedBytes, totalBytes, speed) => {
            const percent = Math.round((copiedBytes / totalBytes) * 100);
            repository.updateDownloadStatusMessage(hash, `Copying... ${percent}% - ${formatSpeed(speed)}`);
          },
          onExtracting: () => {
            repository.updateDownloadStatusMessage(hash, 'Extracting...');
          },
          onComplete: (finalPath) => {
            // Update name from finalPath (handles archive extraction: show.zip -> show)
            this.retryCount.delete(hash);
            const finalName = path.basename(finalPath);
            const currentDl = repository.getDownloadByHash(hash);
            if (currentDl && finalName !== currentDl.name) {
              repository.updateDownloadName(hash, finalName);
              console.log(`[DownloadManager] Updated name after extraction: ${currentDl.name} -> ${finalName}`);
            }
            repository.updateDownloadState(hash, 'completed');
            console.log(`[DownloadManager] Completed: ${name}`);
            this.processQueue();
          },
          onError: (error) => {
            this.retryDownloadOnError(hash, name, null, error,
              (freshUrl) => startDownload(hash, freshUrl, actualName, {
                onProgress: (p) => { repository.updateDownloadProgress(hash, p.downloadedBytes, p.totalBytes, p.downloadSpeed); },
                onMoving: (fp) => { const d = repository.getDownloadByHash(hash); if (d && d.totalSize > 0) repository.updateDownloadProgress(hash, d.totalSize, d.totalSize, 0); repository.updateDownloadStatusMessage(hash, `Moving to ${fp}...`); },
                onMoveProgress: (c, t, s) => { repository.updateDownloadStatusMessage(hash, `Copying... ${Math.round((c / t) * 100)}% - ${formatSpeed(s)}`); },
                onExtracting: () => { repository.updateDownloadStatusMessage(hash, 'Extracting...'); },
                onComplete: (fp) => { this.retryCount.delete(hash); const fn = path.basename(fp); const cd = repository.getDownloadByHash(hash); if (cd && fn !== cd.name) repository.updateDownloadName(hash, fn); repository.updateDownloadState(hash, 'completed'); this.processQueue(); },
                onError: (e) => { this.retryCount.delete(hash); repository.updateDownloadState(hash, 'error', e.message); this.processQueue(); },
                onPaused: () => { console.log(`[DownloadManager] Download paused: ${name}`); },
              }, undefined, savePath),
              () => { repository.updateDownloadState(hash, 'error', error.message); console.error(`[DownloadManager] Error: ${name} - ${error.message}`); this.processQueue(); },
            );
          },
          onPaused: () => {
            console.log(`[DownloadManager] Download paused: ${name}`);
          },
        }, result.totalSize, savePath);
      } else {
        // Multiple files - download them sequentially into a folder
        console.log(`[DownloadManager] Multi-file torrent with ${result.downloadLinks.length} files`);

        // Create folder with torrent name
        const torrentFolder = path.join(savePath, name);
        if (!fs.existsSync(torrentFolder)) {
          fs.mkdirSync(torrentFolder, { recursive: true });
          console.log(`[DownloadManager] Created folder: ${torrentFolder}`);
        }

        // Download all files sequentially
        repository.updateDownloadStatusMessage(hash, null);
        repository.updateDownloadState(hash, 'downloading');

        const totalFiles = result.downloadLinks.length;
        let completedFiles = 0;
        let totalDownloaded = 0;

        const downloadNextFile = async (index: number) => {
          if (index >= totalFiles) {
            // All files completed
            repository.updateDownloadState(hash, 'completed');
            console.log(`[DownloadManager] Completed all ${totalFiles} files: ${name}`);
            this.processQueue();
            return;
          }

          const debridedUrl = result.downloadLinks[index];
          repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Getting info...`);

          // Get real filename for this file
          let filename = `file_${index + 1}`;
          try {
            filename = await getRealFilename(debridedUrl, filename);
            console.log(`[DownloadManager] File ${index + 1}/${totalFiles}: ${filename}`);
          } catch (error: any) {
            console.log(`[DownloadManager] Could not get filename for file ${index + 1}: ${error.message}`);
          }

          repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: ${filename}`);

          // Use a unique hash for each file download to avoid conflicts
          const fileHash = `${hash}_file_${index}`;

          startDownload(fileHash, debridedUrl, filename, {
            onProgress: (progress) => {
              // Update global progress considering completed files
              const currentFileProgress = progress.downloadedBytes;
              const globalDownloaded = totalDownloaded + currentFileProgress;
              repository.updateDownloadProgress(hash, globalDownloaded, result.totalSize || 0, progress.downloadSpeed);
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: ${filename} (${progress.progress}%)`);
            },
            onMoving: () => {
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Moving ${filename}...`);
            },
            onMoveProgress: (copiedBytes, totalBytes, speed) => {
              const percent = Math.round((copiedBytes / totalBytes) * 100);
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Copying ${filename}... ${percent}%`);
            },
            onExtracting: () => {
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Extracting ${filename}...`);
            },
            onComplete: (finalPath) => {
              completedFiles++;
              // Get file size and add to total downloaded
              try {
                const stats = fs.statSync(finalPath);
                totalDownloaded += stats.size;
              } catch {}
              console.log(`[DownloadManager] Completed file ${completedFiles}/${totalFiles}: ${filename}`);
              // Download next file
              downloadNextFile(index + 1);
            },
            onError: (error) => {
              this.retryDownloadOnError(fileHash, name, null, error,
                (freshUrl) => startDownload(fileHash, freshUrl, filename, {
                  onProgress: (p) => { const pct = totalFiles > 1 ? Math.round(((completedFiles + (p.progress / 100)) / totalFiles) * 100) : p.progress; repository.updateDownloadProgress(hash, totalDownloaded + p.downloadedBytes, 0, p.downloadSpeed); },
                  onComplete: (fp) => { this.retryCount.delete(fileHash); completedFiles++; try { const s = fs.statSync(fp); totalDownloaded += s.size; } catch {} downloadNextFile(index + 1); },
                  onError: (e) => { this.retryCount.delete(fileHash); repository.updateDownloadState(hash, 'error', `File ${index + 1} failed: ${e.message}`); this.processQueue(); },
                  onPaused: () => { console.log(`[DownloadManager] Download paused at file ${index + 1}/${totalFiles}`); },
                }, undefined, torrentFolder),
                () => { repository.updateDownloadState(hash, 'error', `File ${index + 1} failed: ${error.message}`); console.error(`[DownloadManager] Error on file ${index + 1}: ${error.message}`); this.processQueue(); },
              );
            },
            onPaused: () => {
              console.log(`[DownloadManager] Download paused at file ${index + 1}/${totalFiles}`);
            },
          }, undefined, torrentFolder);  // Download into torrent folder
        };

        // Start downloading first file
        downloadNextFile(0);
      }
    } catch (error: any) {
      // Clean up operation tracking
      this.activeDebridOperations.delete(hash);

      // Don't set error state if cancelled (download was deleted)
      if (operation.cancelled || error.message === 'Download cancelled') {
        console.log(`[DownloadManager] Real torrent cancelled: ${name}`);
      } else {
        // Only update state if download still exists
        const dl = repository.getDownloadByHash(hash);
        if (dl) {
          repository.updateDownloadState(hash, 'error', error.message);
          console.error(`[DownloadManager] Real torrent error: ${name} - ${error.message}`);
        }
      }
      this.processQueue();
    } finally {
      // Always clean up operation tracking
      this.activeDebridOperations.delete(hash);
      this.debridWaiting.delete(hash);
    }
  }

  /**
   * Process a magnet URI (upload to debrid, wait for completion, download files)
   */
  private async startProcessingMagnet(download: Download): Promise<void> {
    const { hash, name, savePath, originalLink } = download;

    // Track this debrid operation for cancellation
    const operation = { cancelled: false };
    this.activeDebridOperations.set(hash, operation);

    try {
      repository.updateDownloadState(hash, 'checking');

      // Upload magnet to debrid service
      repository.updateDownloadStatusMessage(hash, 'Uploading magnet to debrid...');
      console.log(`[DownloadManager] Uploading magnet: ${name}`);

      const config = getConfig();
      const timeoutMs = config.debridTorrentTimeoutHours * 60 * 60 * 1000;

      const result = await debridMagnet(
        originalLink,
        (status, serviceName) => {
          // Check if cancelled during polling
          if (operation.cancelled) {
            throw new Error('Download cancelled');
          }
          // Update status message based on debrid status
          if (status.status === 'queued') {
            repository.updateDownloadStatusMessage(hash, `Queued on ${serviceName}...`);
          } else if (status.status === 'downloading') {
            repository.updateDownloadStatusMessage(hash, `Downloading on debrid: ${status.progress}%`);
          }
          // The magnet is being cached server-side: free our local slot so
          // other downloads can start while we wait.
          this.markDebridWaiting(hash);
        },
        timeoutMs
      );

      // Server-side caching is done; reclaim the local slot for the actual download.
      this.debridWaiting.delete(hash);

      // Check if cancelled after debrid completed
      if (operation.cancelled) {
        console.log(`[DownloadManager] Magnet cancelled after debrid: ${name}`);
        return;
      }

      console.log(`[DownloadManager] Magnet ready on ${result.service}, ${result.downloadLinks.length} file(s)`);

      // Update name from debrid service if we had a generic fallback name
      let currentName = name;
      if (result.name && name.startsWith('magnet_')) {
        currentName = result.name;
        repository.updateDownloadName(hash, currentName);
        console.log(`[DownloadManager] Updated magnet name from debrid: ${currentName}`);
      }

      // If single file, download it directly
      // If multiple files, download each sequentially
      if (result.downloadLinks.length === 1) {
        const debridedUrl = result.downloadLinks[0];
        repository.updateDownloadLink(hash, debridedUrl);

        // Get real filename
        repository.updateDownloadStatusMessage(hash, 'Getting file info...');
        let actualName = currentName;
        try {
          actualName = await getRealFilename(debridedUrl, currentName);
          if (actualName !== currentName) {
            repository.updateDownloadName(hash, actualName);
          }
        } catch (error: any) {
          console.log(`[DownloadManager] Could not get real filename: ${error.message}`);
        }

        // Start download
        repository.updateDownloadStatusMessage(hash, null);
        repository.updateDownloadState(hash, 'downloading');

        startDownload(hash, debridedUrl, actualName, {
          onProgress: (progress) => {
            repository.updateDownloadProgress(hash, progress.downloadedBytes, progress.totalBytes, progress.downloadSpeed);
          },
          onMoving: (finalPath) => {
            const dl = repository.getDownloadByHash(hash);
            if (dl && dl.totalSize > 0) {
              repository.updateDownloadProgress(hash, dl.totalSize, dl.totalSize, 0);
            }
            repository.updateDownloadStatusMessage(hash, `Moving to ${finalPath}...`);
          },
          onMoveProgress: (copiedBytes, totalBytes, speed) => {
            const percent = Math.round((copiedBytes / totalBytes) * 100);
            repository.updateDownloadStatusMessage(hash, `Copying... ${percent}% - ${formatSpeed(speed)}`);
          },
          onExtracting: () => {
            repository.updateDownloadStatusMessage(hash, 'Extracting...');
          },
          onComplete: (finalPath) => {
            // Update name from finalPath (handles archive extraction: show.zip -> show)
            this.retryCount.delete(hash);
            const finalName = path.basename(finalPath);
            const currentDl = repository.getDownloadByHash(hash);
            if (currentDl && finalName !== currentDl.name) {
              repository.updateDownloadName(hash, finalName);
              console.log(`[DownloadManager] Updated name after extraction: ${currentDl.name} -> ${finalName}`);
            }
            repository.updateDownloadState(hash, 'completed');
            console.log(`[DownloadManager] Completed: ${name}`);
            this.processQueue();
          },
          onError: (error) => {
            this.retryDownloadOnError(hash, name, null, error,
              (freshUrl) => startDownload(hash, freshUrl, actualName, {
                onProgress: (p) => { repository.updateDownloadProgress(hash, p.downloadedBytes, p.totalBytes, p.downloadSpeed); },
                onMoving: (fp) => { const d = repository.getDownloadByHash(hash); if (d && d.totalSize > 0) repository.updateDownloadProgress(hash, d.totalSize, d.totalSize, 0); repository.updateDownloadStatusMessage(hash, `Moving to ${fp}...`); },
                onMoveProgress: (c, t, s) => { repository.updateDownloadStatusMessage(hash, `Copying... ${Math.round((c / t) * 100)}% - ${formatSpeed(s)}`); },
                onExtracting: () => { repository.updateDownloadStatusMessage(hash, 'Extracting...'); },
                onComplete: (fp) => { this.retryCount.delete(hash); const fn = path.basename(fp); const cd = repository.getDownloadByHash(hash); if (cd && fn !== cd.name) repository.updateDownloadName(hash, fn); repository.updateDownloadState(hash, 'completed'); this.processQueue(); },
                onError: (e) => { this.retryCount.delete(hash); repository.updateDownloadState(hash, 'error', e.message); this.processQueue(); },
                onPaused: () => { console.log(`[DownloadManager] Download paused: ${name}`); },
              }, undefined, savePath),
              () => { repository.updateDownloadState(hash, 'error', error.message); console.error(`[DownloadManager] Error: ${name} - ${error.message}`); this.processQueue(); },
            );
          },
          onPaused: () => {
            console.log(`[DownloadManager] Download paused: ${name}`);
          },
        }, result.totalSize, savePath);
      } else {
        // Multiple files - download them sequentially into a folder
        console.log(`[DownloadManager] Multi-file magnet with ${result.downloadLinks.length} files`);

        // Create folder with torrent name
        const torrentFolder = path.join(savePath, currentName);
        if (!fs.existsSync(torrentFolder)) {
          fs.mkdirSync(torrentFolder, { recursive: true });
          console.log(`[DownloadManager] Created folder: ${torrentFolder}`);
        }

        // Download all files sequentially
        repository.updateDownloadStatusMessage(hash, null);
        repository.updateDownloadState(hash, 'downloading');

        const totalFiles = result.downloadLinks.length;
        let completedFiles = 0;
        let totalDownloaded = 0;

        const downloadNextFile = async (index: number) => {
          if (index >= totalFiles) {
            // All files completed
            repository.updateDownloadState(hash, 'completed');
            console.log(`[DownloadManager] Completed all ${totalFiles} files: ${name}`);
            this.processQueue();
            return;
          }

          const debridedUrl = result.downloadLinks[index];
          repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Getting info...`);

          // Get real filename for this file
          let filename = `file_${index + 1}`;
          try {
            filename = await getRealFilename(debridedUrl, filename);
            console.log(`[DownloadManager] File ${index + 1}/${totalFiles}: ${filename}`);
          } catch (error: any) {
            console.log(`[DownloadManager] Could not get filename for file ${index + 1}: ${error.message}`);
          }

          repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: ${filename}`);

          // Use a unique hash for each file download to avoid conflicts
          const fileHash = `${hash}_file_${index}`;

          startDownload(fileHash, debridedUrl, filename, {
            onProgress: (progress) => {
              // Update global progress considering completed files
              const currentFileProgress = progress.downloadedBytes;
              const globalDownloaded = totalDownloaded + currentFileProgress;
              repository.updateDownloadProgress(hash, globalDownloaded, result.totalSize || 0, progress.downloadSpeed);
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: ${filename} (${progress.progress}%)`);
            },
            onMoving: () => {
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Moving ${filename}...`);
            },
            onMoveProgress: (copiedBytes, totalBytes, speed) => {
              const percent = Math.round((copiedBytes / totalBytes) * 100);
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Copying ${filename}... ${percent}%`);
            },
            onExtracting: () => {
              repository.updateDownloadStatusMessage(hash, `File ${index + 1}/${totalFiles}: Extracting ${filename}...`);
            },
            onComplete: (finalPath) => {
              completedFiles++;
              // Get file size and add to total downloaded
              try {
                const stats = fs.statSync(finalPath);
                totalDownloaded += stats.size;
              } catch {}
              console.log(`[DownloadManager] Completed file ${completedFiles}/${totalFiles}: ${filename}`);
              // Download next file
              downloadNextFile(index + 1);
            },
            onError: (error) => {
              this.retryDownloadOnError(fileHash, name, null, error,
                (freshUrl) => startDownload(fileHash, freshUrl, filename, {
                  onProgress: (p) => { const pct = totalFiles > 1 ? Math.round(((completedFiles + (p.progress / 100)) / totalFiles) * 100) : p.progress; repository.updateDownloadProgress(hash, totalDownloaded + p.downloadedBytes, 0, p.downloadSpeed); },
                  onComplete: (fp) => { this.retryCount.delete(fileHash); completedFiles++; try { const s = fs.statSync(fp); totalDownloaded += s.size; } catch {} downloadNextFile(index + 1); },
                  onError: (e) => { this.retryCount.delete(fileHash); repository.updateDownloadState(hash, 'error', `File ${index + 1} failed: ${e.message}`); this.processQueue(); },
                  onPaused: () => { console.log(`[DownloadManager] Download paused at file ${index + 1}/${totalFiles}`); },
                }, undefined, torrentFolder),
                () => { repository.updateDownloadState(hash, 'error', `File ${index + 1} failed: ${error.message}`); console.error(`[DownloadManager] Error on file ${index + 1}: ${error.message}`); this.processQueue(); },
              );
            },
            onPaused: () => {
              console.log(`[DownloadManager] Download paused at file ${index + 1}/${totalFiles}`);
            },
          }, undefined, torrentFolder);  // Download into torrent folder
        };

        // Start downloading first file
        downloadNextFile(0);
      }
    } catch (error: any) {
      // Clean up operation tracking
      this.activeDebridOperations.delete(hash);

      // Don't set error state if cancelled (download was deleted)
      if (operation.cancelled || error.message === 'Download cancelled') {
        console.log(`[DownloadManager] Magnet cancelled: ${name}`);
      } else {
        // Only update state if download still exists
        const dl = repository.getDownloadByHash(hash);
        if (dl) {
          repository.updateDownloadState(hash, 'error', error.message);
          console.error(`[DownloadManager] Magnet error: ${name} - ${error.message}`);
        }
      }
      this.processQueue();
    } finally {
      // Always clean up operation tracking
      this.activeDebridOperations.delete(hash);
      this.debridWaiting.delete(hash);
    }
  }

  /**
   * Process a DDL download (original flow)
   */
  private async startProcessingDdl(download: Download): Promise<void> {
    const { hash, originalLink, debridedLink, name, savePath } = download;

    try {
      // Check if this is a resume:
      // 1. Has debrided link (already processed) AND
      // 2. Either in pausedDownloads OR has partial download in database
      const hasDebridedLink = !!debridedLink;
      const isPausedInMemory = isDownloadPaused(hash);
      const hasPartialDownload = download.downloadedSize > 0 && download.state === 'queued';
      const isResume = hasDebridedLink && (isPausedInMemory || hasPartialDownload);

      console.log(`[DownloadManager] Processing ${name}: hasDebridedLink=${hasDebridedLink}, isPausedInMemory=${isPausedInMemory}, hasPartialDownload=${hasPartialDownload}, isResume=${isResume}`);

      if (isResume) {
        console.log(`[DownloadManager] Resuming: ${name}`);
        repository.updateDownloadState(hash, 'downloading');

        startDownload(hash, debridedLink, name, {
          onProgress: (progress) => {
            repository.updateDownloadProgress(
              hash,
              progress.downloadedBytes,
              progress.totalBytes,
              progress.downloadSpeed
            );
          },
          onMoving: (finalPath) => {
            // Set progress to 100% and speed to 0 when moving starts
            const dl = repository.getDownloadByHash(hash);
            if (dl && dl.totalSize > 0) {
              repository.updateDownloadProgress(hash, dl.totalSize, dl.totalSize, 0);
            }
            repository.updateDownloadStatusMessage(hash, `Moving to ${finalPath}...`);
            console.log(`[DownloadManager] Moving: ${name} -> ${finalPath}`);
          },
          onMoveProgress: (copiedBytes, totalBytes, speed) => {
            const percent = Math.round((copiedBytes / totalBytes) * 100);
            const speedStr = formatSpeed(speed);
            console.log(`[DownloadManager] Copy progress: ${name} - ${percent}% @ ${speedStr}`);
            repository.updateDownloadStatusMessage(hash, `Copying... ${percent}% - ${speedStr}`);
          },
          onExtracting: (finalPath) => {
            repository.updateDownloadStatusMessage(hash, 'Extracting...');
            console.log(`[DownloadManager] Extracting: ${name}`);
          },
          onComplete: (finalPath) => {
            // Update name from finalPath (handles archive extraction: show.zip -> show)
            this.retryCount.delete(hash);
            const finalName = path.basename(finalPath);
            const currentDl = repository.getDownloadByHash(hash);
            if (currentDl && finalName !== currentDl.name) {
              repository.updateDownloadName(hash, finalName);
              console.log(`[DownloadManager] Updated name after extraction: ${currentDl.name} -> ${finalName}`);
            }
            repository.updateDownloadState(hash, 'completed');
            console.log(`[DownloadManager] Completed: ${name} -> ${finalPath}`);
            this.processQueue();
          },
          onError: (error) => {
            this.retryDownloadOnError(hash, name, originalLink, error,
              (freshUrl) => startDownload(hash, freshUrl, name, {
                onProgress: (p) => { repository.updateDownloadProgress(hash, p.downloadedBytes, p.totalBytes, p.downloadSpeed); },
                onMoving: (fp) => { const d = repository.getDownloadByHash(hash); if (d && d.totalSize > 0) repository.updateDownloadProgress(hash, d.totalSize, d.totalSize, 0); repository.updateDownloadStatusMessage(hash, `Moving to ${fp}...`); },
                onMoveProgress: (c, t, s) => { repository.updateDownloadStatusMessage(hash, `Copying... ${Math.round((c / t) * 100)}% - ${formatSpeed(s)}`); },
                onExtracting: () => { repository.updateDownloadStatusMessage(hash, 'Extracting...'); },
                onComplete: (fp) => { this.retryCount.delete(hash); const fn = path.basename(fp); const cd = repository.getDownloadByHash(hash); if (cd && fn !== cd.name) repository.updateDownloadName(hash, fn); repository.updateDownloadState(hash, 'completed'); this.processQueue(); },
                onError: (e) => { this.retryCount.delete(hash); repository.updateDownloadState(hash, 'error', e.message); this.processQueue(); },
                onPaused: () => { console.log(`[DownloadManager] Download paused callback: ${name}`); },
              }, undefined, download.savePath),
              () => { repository.updateDownloadState(hash, 'error', error.message); console.error(`[DownloadManager] Error: ${name} - ${error.message}`); this.processQueue(); },
            );
          },
          onPaused: () => {
            // State is already set to paused by the pause() method
            console.log(`[DownloadManager] Download paused callback: ${name}`);
          },
        }, download.totalSize, download.savePath);  // Pass known total size and save path from database
        return;
      }

      repository.updateDownloadState(hash, 'checking');
      console.log(`[DownloadManager] Processing: ${name}`);

      let link = originalLink;

      // Resolve dl-protect if needed
      if (isDlProtectLink(link)) {
        repository.updateDownloadStatusMessage(hash, 'Resolving dl-protect...');
        console.log(`[DownloadManager] Resolving dl-protect link...`);
        try {
          link = await resolveDlProtectLink(link);
          if (!link || link === originalLink) {
            throw new Error('Failed to resolve dl-protect link');
          }
        } catch (error: any) {
          repository.updateDownloadState(hash, 'error', `dl-protect failed: ${error.message}`);
          console.error(`[DownloadManager] dl-protect resolution failed: ${error.message}`);
          this.processQueue();
          return;
        }
      }

      // Resolve Bookys download links (/dl/ intermediate page → final hoster link)
      if (isBookysLink(link)) {
        repository.updateDownloadStatusMessage(hash, 'Resolving Bookys link...');
        console.log(`[DownloadManager] Resolving Bookys download link...`);
        try {
          const resolvedLink = await resolveBookysLink(link);
          if (!resolvedLink || resolvedLink === link) {
            throw new Error('Failed to resolve Bookys link');
          }
          link = resolvedLink;
        } catch (error: any) {
          repository.updateDownloadState(hash, 'error', `Bookys resolution failed: ${error.message}`);
          console.error(`[DownloadManager] Bookys resolution failed: ${error.message}`);
          this.processQueue();
          return;
        }
      }

      // Check if the hoster link is valid (skip if debrid is enabled - debrid services have their own cache)
      if (!isAnyDebridEnabled()) {
        repository.updateDownloadStatusMessage(hash, 'Verifying link...');
        try {
          const response = await fetch(link, { method: 'HEAD', redirect: 'follow' });
          if (response.status === 404) {
            repository.updateDownloadState(hash, 'error', 'Hoster link not found (404)');
            console.error(`[DownloadManager] Hoster link returned 404: ${link}`);
            this.processQueue();
            return;
          }
          // Check if redirected to an error page (e.g., rapidgator premium page)
          if (isErrorUrl(response.url)) {
            repository.updateDownloadState(hash, 'error', `Invalid hoster link (redirect to ${response.url})`);
            console.error(`[DownloadManager] Hoster link redirected to error page: ${response.url}`);
            this.processQueue();
            return;
          }
        } catch (error: any) {
          // HEAD request might fail for some hosts, continue anyway
          console.log(`[DownloadManager] HEAD request failed, continuing: ${error.message}`);
        }
      }

      // Debrid if enabled
      if (isAnyDebridEnabled()) {
        repository.updateDownloadStatusMessage(hash, 'Debriding...');
        console.log(`[DownloadManager] Debriding link...`);
        try {
          const debridedUrl = await debridLink(link);
          if (!debridedUrl) {
            throw new Error('Debrid service did not return a link');
          }
          if (debridedUrl !== link) {
            repository.updateDownloadLink(hash, debridedUrl);
            link = debridedUrl;
          }
        } catch (error: any) {
          repository.updateDownloadState(hash, 'error', `Debrid failed: ${error.message}`);
          console.error(`[DownloadManager] Debrid failed: ${error.message}`);
          this.processQueue();
          return;
        }
      }

      // Get real filename from debrid link (with proper extension)
      // This also validates the debrid link (checks for 404, etc.)
      repository.updateDownloadStatusMessage(hash, 'Verifying debrided link...');
      let actualName = name;
      try {
        actualName = await getRealFilename(link, name);
        if (actualName !== name) {
          repository.updateDownloadName(hash, actualName);
          console.log(`[DownloadManager] Updated filename: ${name} -> ${actualName}`);
        }
      } catch (error: any) {
        // Check if it's an HTTP error (like 404)
        if (error.message.startsWith('HTTP ')) {
          repository.updateDownloadState(hash, 'error', `Link not found: ${error.message}`);
          console.error(`[DownloadManager] Debrid link error: ${error.message}`);
          this.processQueue();
          return;
        }
        // Other errors (like network issues or hosts not supporting HEAD) - continue anyway
        console.log(`[DownloadManager] Could not get real filename, using original: ${error.message}`);
      }

      // Start download
      repository.updateDownloadStatusMessage(hash, null);  // Clear status message
      repository.updateDownloadState(hash, 'downloading');

      startDownload(hash, link, actualName, {
        onProgress: (progress) => {
          repository.updateDownloadProgress(
            hash,
            progress.downloadedBytes,
            progress.totalBytes,
            progress.downloadSpeed
          );
        },
        onMoving: (finalPath) => {
          // Set progress to 100% and speed to 0 when moving starts
          const dl = repository.getDownloadByHash(hash);
          if (dl && dl.totalSize > 0) {
            repository.updateDownloadProgress(hash, dl.totalSize, dl.totalSize, 0);
          }
          repository.updateDownloadStatusMessage(hash, `Moving to ${finalPath}...`);
          console.log(`[DownloadManager] Moving: ${name} -> ${finalPath}`);
        },
        onMoveProgress: (copiedBytes, totalBytes, speed) => {
          const percent = Math.round((copiedBytes / totalBytes) * 100);
          const speedStr = formatSpeed(speed);
          console.log(`[DownloadManager] Copy progress: ${name} - ${percent}% @ ${speedStr}`);
          repository.updateDownloadStatusMessage(hash, `Copying... ${percent}% - ${speedStr}`);
        },
        onExtracting: (finalPath) => {
          repository.updateDownloadStatusMessage(hash, 'Extracting...');
          console.log(`[DownloadManager] Extracting: ${name}`);
        },
        onComplete: (finalPath) => {
          // Update name from finalPath (handles archive extraction: show.zip -> show)
          this.retryCount.delete(hash);
          const finalName = path.basename(finalPath);
          const currentDl = repository.getDownloadByHash(hash);
          if (currentDl && finalName !== currentDl.name) {
            repository.updateDownloadName(hash, finalName);
            console.log(`[DownloadManager] Updated name after extraction: ${currentDl.name} -> ${finalName}`);
          }
          repository.updateDownloadState(hash, 'completed');
          console.log(`[DownloadManager] Completed: ${name} -> ${finalPath}`);
          this.processQueue();
        },
        onError: (error) => {
          this.retryDownloadOnError(hash, name, originalLink, error,
            (freshUrl) => startDownload(hash, freshUrl, actualName, {
              onProgress: (p) => { repository.updateDownloadProgress(hash, p.downloadedBytes, p.totalBytes, p.downloadSpeed); },
              onMoving: (fp) => { const d = repository.getDownloadByHash(hash); if (d && d.totalSize > 0) repository.updateDownloadProgress(hash, d.totalSize, d.totalSize, 0); repository.updateDownloadStatusMessage(hash, `Moving to ${fp}...`); },
              onMoveProgress: (c, t, s) => { repository.updateDownloadStatusMessage(hash, `Copying... ${Math.round((c / t) * 100)}% - ${formatSpeed(s)}`); },
              onExtracting: () => { repository.updateDownloadStatusMessage(hash, 'Extracting...'); },
              onComplete: (fp) => { this.retryCount.delete(hash); const fn = path.basename(fp); const cd = repository.getDownloadByHash(hash); if (cd && fn !== cd.name) repository.updateDownloadName(hash, fn); repository.updateDownloadState(hash, 'completed'); this.processQueue(); },
              onError: (e) => { this.retryCount.delete(hash); repository.updateDownloadState(hash, 'error', e.message); this.processQueue(); },
              onPaused: () => { console.log(`[DownloadManager] Download paused callback: ${name}`); },
            }, undefined, savePath),
            () => { repository.updateDownloadState(hash, 'error', error.message); console.error(`[DownloadManager] Error: ${name} - ${error.message}`); this.processQueue(); },
          );
        },
        onPaused: () => {
          // State is already set to paused by the pause() method
          console.log(`[DownloadManager] Download paused callback: ${name}`);
        },
      }, undefined, savePath);  // Pass save path for category subfolder
    } catch (error: any) {
      repository.updateDownloadState(hash, 'error', error.message);
      console.error(`[DownloadManager] Processing error: ${name} - ${error.message}`);
      this.processQueue();
    }
  }

  /**
   * Resume downloads on startup
   */
  resumeOnStartup(): void {
    // Reset any stuck "checking" or "downloading" states to queued
    const checking = repository.getDownloadsByState('checking');
    const downloading = repository.getDownloadsByState('downloading');

    for (const download of [...checking, ...downloading]) {
      repository.updateDownloadState(download.hash, 'queued');
      console.log(`[DownloadManager] Reset stuck download: ${download.name}`);
    }

    // Start processing queue
    this.processQueue();
  }

  /**
   * Start auto-cleanup timer for completed downloads
   */
  startAutoCleanup(): void {
    const config = getConfig();
    if (config.autoRemoveCompletedAfter <= 0) {
      console.log('[DownloadManager] Auto-cleanup disabled (AUTO_REMOVE_COMPLETED_AFTER=0)');
      return;
    }

    console.log(`[DownloadManager] Auto-cleanup enabled: removing completed downloads after ${config.autoRemoveCompletedAfter} minutes`);

    // Check every minute
    setInterval(() => {
      this.cleanupCompletedDownloads();
    }, 60 * 1000);
  }

  /**
   * Remove completed downloads older than configured time
   */
  private async cleanupCompletedDownloads(): Promise<void> {
    const config = getConfig();
    if (config.autoRemoveCompletedAfter <= 0) return;

    const maxAgeMs = config.autoRemoveCompletedAfter * 60 * 1000;
    const now = Date.now();
    const completedDownloads = repository.getDownloadsByState('completed');

    for (const download of completedDownloads) {
      if (download.completedAt && (now - download.completedAt) > maxAgeMs) {
        console.log(`[DownloadManager] Auto-removing completed download: ${download.name} (completed ${Math.round((now - download.completedAt) / 60000)} minutes ago)`);
        repository.deleteDownload(download.hash);
      }
    }
  }
}

// Singleton instance
export const downloadManager = new DownloadManager();

// Start auto-cleanup on module load
downloadManager.startAutoCleanup();
