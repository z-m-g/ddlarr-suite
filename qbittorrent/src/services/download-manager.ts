import { getConfig } from '../config.js';
import { generateDownloadHash } from '../utils/hash.js';
import {
  extractLinkFromTorrentBuffer,
  extractNameFromTorrentBuffer,
  extractSizeFromTorrentBuffer,
} from '../utils/torrent.js';
import { isDlProtectLink, resolveDlProtectLink } from '../utils/dlprotect.js';
import { debridLink, isAnyDebridEnabled } from '../debrid/index.js';
import { startDownload, stopDownload, pauseDownload, getDownloadProgress, isDownloadActive, isDownloadPaused, getPausedDownloadInfo } from './downloader.js';
import * as repository from '../db/repository.js';
import type { Download, DownloadState } from '../types/download.js';

/**
 * Get the real filename from a URL by checking Content-Disposition header
 */
async function getRealFilename(url: string, fallbackName: string): Promise<string> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });

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
    const finalUrl = response.url;
    const urlPath = new URL(finalUrl).pathname;
    const urlFilename = decodeURIComponent(urlPath.split('/').pop() || '');
    if (urlFilename && urlFilename.includes('.')) {
      console.log(`[DownloadManager] Got filename from URL: ${urlFilename}`);
      return urlFilename;
    }
  } catch (error: any) {
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

  /**
   * Add a torrent from file data
   */
  async addTorrent(
    torrentData: Buffer,
    options: { savePath?: string; category?: string; paused?: boolean } = {}
  ): Promise<string> {
    // Extract information from torrent
    const link = extractLinkFromTorrentBuffer(torrentData);
    if (!link) {
      throw new Error('No DDL link found in torrent file');
    }

    let name = extractNameFromTorrentBuffer(torrentData);
    if (!name) {
      // Extract filename from URL
      try {
        const url = new URL(link);
        name = decodeURIComponent(url.pathname.split('/').pop() || '') || `download_${Date.now()}`;
      } catch {
        name = `download_${Date.now()}`;
      }
    }

    const size = extractSizeFromTorrentBuffer(torrentData) || 0;
    const hash = generateDownloadHash(link);
    const config = getConfig();

    // Build save path with category subfolder if specified
    let savePath = options.savePath || config.downloadPath;
    if (options.category && !options.savePath) {
      savePath = `${config.downloadPath}/${options.category}`;
    }

    const download: Omit<Download, 'downloadSpeed'> = {
      hash,
      name,
      originalLink: link,
      debridedLink: null,
      savePath,
      totalSize: size,
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
    console.log(`[DownloadManager] Added download: ${name} (${hash})`);

    // Process queue if not paused
    if (!options.paused) {
      this.processQueue();
    }

    return hash;
  }

  /**
   * Add a download from URL
   */
  async addUrl(
    url: string,
    options: { savePath?: string; category?: string; paused?: boolean; name?: string } = {}
  ): Promise<string> {
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
      originalLink: url,
      debridedLink: null,
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
   * Delete downloads
   */
  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    for (const hash of hashes) {
      const download = repository.getDownloadByHash(hash);
      if (!download) continue;

      // Stop if downloading
      if (download.state === 'downloading') {
        stopDownload(hash);
      }

      // Delete file if requested
      if (deleteFiles && download.state === 'completed') {
        const filePath = path.join(download.savePath, download.name);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[DownloadManager] Deleted file: ${filePath}`);
          }
        } catch (error: any) {
          console.error(`[DownloadManager] Error deleting file: ${error.message}`);
        }
      }

      repository.deleteDownload(hash);
      console.log(`[DownloadManager] Deleted download: ${hash}`);
    }
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
      const downloading = repository.getDownloadsByState('downloading');
      const checking = repository.getDownloadsByState('checking');
      const activeCount = downloading.length + checking.length;

      if (activeCount >= config.maxConcurrentDownloads) {
        return;
      }

      const queued = repository.getDownloadsByState('queued');
      const slotsAvailable = config.maxConcurrentDownloads - activeCount;

      for (let i = 0; i < Math.min(slotsAvailable, queued.length); i++) {
        const download = queued[i];
        await this.startProcessing(download);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Start processing a download (resolve links, debrid, start download)
   */
  private async startProcessing(download: Download): Promise<void> {
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
            repository.updateDownloadStatusMessage(hash, `Déplacement vers ${finalPath}...`);
            console.log(`[DownloadManager] Moving: ${name} -> ${finalPath}`);
          },
          onComplete: (finalPath) => {
            repository.updateDownloadState(hash, 'completed');
            console.log(`[DownloadManager] Completed: ${name} -> ${finalPath}`);
            this.processQueue();
          },
          onError: (error) => {
            repository.updateDownloadState(hash, 'error', error.message);
            console.error(`[DownloadManager] Error: ${name} - ${error.message}`);
            this.processQueue();
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
        repository.updateDownloadStatusMessage(hash, 'Résolution dl-protect...');
        console.log(`[DownloadManager] Resolving dl-protect link...`);
        try {
          link = await resolveDlProtectLink(link);
          if (!link || link === originalLink) {
            throw new Error('Échec de la résolution dl-protect');
          }
        } catch (error: any) {
          repository.updateDownloadState(hash, 'error', `Échec dl-protect: ${error.message}`);
          console.error(`[DownloadManager] dl-protect resolution failed: ${error.message}`);
          this.processQueue();
          return;
        }
      }

      // Check if the hoster link is valid (before debridding)
      repository.updateDownloadStatusMessage(hash, 'Vérification du lien...');
      try {
        const response = await fetch(link, { method: 'HEAD', redirect: 'follow' });
        if (response.status === 404) {
          repository.updateDownloadState(hash, 'error', 'Lien hoster introuvable (404)');
          console.error(`[DownloadManager] Hoster link returned 404: ${link}`);
          this.processQueue();
          return;
        }
      } catch (error: any) {
        // HEAD request might fail for some hosts, continue anyway
        console.log(`[DownloadManager] HEAD request failed, continuing: ${error.message}`);
      }

      // Debrid if enabled
      if (isAnyDebridEnabled()) {
        repository.updateDownloadStatusMessage(hash, 'Débridage en cours...');
        console.log(`[DownloadManager] Debriding link...`);
        try {
          const debridedUrl = await debridLink(link);
          if (!debridedUrl) {
            throw new Error('Le service de débridage n\'a pas retourné de lien');
          }
          if (debridedUrl !== link) {
            repository.updateDownloadLink(hash, debridedUrl);
            link = debridedUrl;
          }
        } catch (error: any) {
          repository.updateDownloadState(hash, 'error', `Échec débridage: ${error.message}`);
          console.error(`[DownloadManager] Debrid failed: ${error.message}`);
          this.processQueue();
          return;
        }
      }

      // Get real filename from debrid link (with proper extension)
      repository.updateDownloadStatusMessage(hash, 'Récupération du nom de fichier...');
      let actualName = name;
      try {
        actualName = await getRealFilename(link, name);
        if (actualName !== name) {
          repository.updateDownloadName(hash, actualName);
          console.log(`[DownloadManager] Updated filename: ${name} -> ${actualName}`);
        }
      } catch (error: any) {
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
          repository.updateDownloadStatusMessage(hash, `Déplacement vers ${finalPath}...`);
          console.log(`[DownloadManager] Moving: ${name} -> ${finalPath}`);
        },
        onComplete: (finalPath) => {
          repository.updateDownloadState(hash, 'completed');
          console.log(`[DownloadManager] Completed: ${name} -> ${finalPath}`);
          this.processQueue();
        },
        onError: (error) => {
          repository.updateDownloadState(hash, 'error', error.message);
          console.error(`[DownloadManager] Error: ${name} - ${error.message}`);
          this.processQueue();
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
}

// Singleton instance
export const downloadManager = new DownloadManager();
