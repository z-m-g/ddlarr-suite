import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DownloadClient } from './base.js';
import { getConfig } from '../utils/config.js';
import { DownloadProgress } from './curl.js';

interface ActiveDownload extends DownloadProgress {
  process?: ChildProcess;
  tempPath?: string;
}

// Track active downloads for progress reporting
const activeDownloads: Map<string, ActiveDownload> = new Map();

export function getWgetActiveDownloads(): DownloadProgress[] {
  return Array.from(activeDownloads.values()).map(({ process, tempPath, ...rest }) => rest);
}

export function stopWgetDownload(downloadId: string): boolean {
  const download = activeDownloads.get(downloadId);
  if (!download || !download.process) {
    return false;
  }

  console.log(`[wget] Stopping download: ${download.filename}`);
  download.process.kill('SIGTERM');
  download.status = 'stopped';

  // Cleanup temp file
  if (download.tempPath && fs.existsSync(download.tempPath)) {
    try {
      fs.unlinkSync(download.tempPath);
      console.log(`[wget] Cleaned up temp file: ${download.tempPath}`);
    } catch (e) {
      console.error(`[wget] Failed to cleanup temp file: ${download.tempPath}`);
    }
  }

  // Remove after delay
  setTimeout(() => activeDownloads.delete(downloadId), 5000);
  return true;
}

/**
 * wget client - downloads directly using wget command
 * Downloads to temp directory first, then moves to destination
 */
export class WgetClient implements DownloadClient {
  name = 'wget';

  isEnabled(): boolean {
    const config = getConfig().wget;
    return config.enabled && !!config.destinationPath;
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().wget;
    console.log('[wget] Testing connection...');
    console.log(`[wget] Config: destinationPath=${config.destinationPath}`);

    if (!config.destinationPath) {
      console.log('[wget] Missing required field: destinationPath');
      return false;
    }

    // Check if destination path exists
    if (!fs.existsSync(config.destinationPath)) {
      console.log(`[wget] Destination path does not exist: ${config.destinationPath}`);
      return false;
    }

    // Check if wget is available
    return new Promise((resolve) => {
      const proc = spawn('wget', ['--version']);
      proc.on('close', (code) => {
        if (code === 0) {
          console.log('[wget] wget is available');
          resolve(true);
        } else {
          console.log('[wget] wget is not available');
          resolve(false);
        }
      });
      proc.on('error', () => {
        console.log('[wget] wget is not available');
        resolve(false);
      });
    });
  }

  async addDownload(url: string, filename?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[wget] Not enabled');
      return false;
    }

    const config = getConfig().wget;

    // Determine filename
    let finalFilename = filename || this.extractFilename(url);

    // Add extension from URL if missing
    const hasExtension = /\.[a-zA-Z0-9]{2,4}$/.test(finalFilename);
    if (!hasExtension) {
      const urlMatch = url.match(/\.([a-zA-Z0-9]{2,4})(?:\?|$)/);
      if (urlMatch) {
        finalFilename = `${finalFilename}.${urlMatch[1]}`;
        console.log(`[wget] Added extension from URL: ${urlMatch[1]}`);
      }
    }

    // Use temp directory for downloads in progress (outside Radarr scan path)
    const tempDir = config.tempPath || '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const finalPath = path.join(config.destinationPath, finalFilename);
    const tempPath = path.join(tempDir, `wget_${Date.now()}_${finalFilename}`);

    console.log(`[wget] Downloading: ${url}`);
    console.log(`[wget] Temp path: ${tempPath}`);
    console.log(`[wget] Final path: ${finalPath}`);

    const downloadId = `wget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Initialize progress tracking
    const progress: ActiveDownload = {
      id: downloadId,
      filename: finalFilename,
      url,
      progress: 0,
      speed: '0 B/s',
      size: 'Unknown',
      downloaded: '0 B',
      status: 'downloading',
      startedAt: new Date(),
      tempPath,
    };
    activeDownloads.set(downloadId, progress);

    return new Promise((resolve) => {
      // wget with progress output
      // --progress=dot:mega: show progress dots
      // -O: output file
      // -c: continue partial downloads
      const proc = spawn('wget', [
        '--progress=bar:force',
        '-O', tempPath,
        url,
      ], {
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      });

      // Store process reference for stop functionality
      progress.process = proc;

      let lastProgress = 0;

      proc.stderr.on('data', (data: Buffer) => {
        const output = data.toString();

        // Parse progress from wget output
        // Format: 50% [======>                    ] 1,234,567   500K/s
        const progressMatches = output.matchAll(/(\d+)%/g);
        for (const match of progressMatches) {
          const newProgress = parseInt(match[1], 10);
          // Only update if progress increases (avoid parsing artifacts)
          if (newProgress > lastProgress && newProgress <= 100) {
            lastProgress = newProgress;
            progress.progress = lastProgress;
            console.log(`[wget] Progress: ${lastProgress}%`);
          }
        }

        // Parse speed
        const speedMatch = output.match(/([\d.,]+\s*[KMGT]?B?\/s)/i);
        if (speedMatch) {
          progress.speed = speedMatch[1];
        }

        // Parse size
        const sizeMatch = output.match(/([\d.,]+\s*[KMGT])/);
        if (sizeMatch) {
          progress.downloaded = sizeMatch[1];
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Move file from temp to final destination
          try {
            fs.renameSync(tempPath, finalPath);
            console.log(`[wget] Download complete: ${finalPath}`);
            progress.progress = 100;
            progress.status = 'completed';
            setTimeout(() => activeDownloads.delete(downloadId), 60000);
            resolve(true);
          } catch (moveError: any) {
            // Try copy + delete if rename fails (cross-device)
            if (moveError.code === 'EXDEV') {
              try {
                console.log(`[wget] Cross-device move, using copy+delete`);
                fs.copyFileSync(tempPath, finalPath);
                fs.unlinkSync(tempPath);
                console.log(`[wget] Download complete: ${finalPath}`);
                progress.progress = 100;
                progress.status = 'completed';
                setTimeout(() => activeDownloads.delete(downloadId), 60000);
                resolve(true);
              } catch (copyError: any) {
                console.error(`[wget] Error copying file: ${copyError.message}`);
                progress.status = 'failed';
                setTimeout(() => activeDownloads.delete(downloadId), 60000);
                resolve(false);
              }
            } else {
              console.error(`[wget] Error moving file: ${moveError.message}`);
              progress.status = 'failed';
              setTimeout(() => activeDownloads.delete(downloadId), 60000);
              resolve(false);
            }
          }
        } else {
          console.error(`[wget] Download failed with code ${code}`);
          // Cleanup temp file
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch {}
          progress.status = 'failed';
          setTimeout(() => activeDownloads.delete(downloadId), 60000);
          resolve(false);
        }
      });

      proc.on('error', (error) => {
        console.error(`[wget] Process error: ${error.message}`);
        progress.status = 'failed';
        setTimeout(() => activeDownloads.delete(downloadId), 60000);
        resolve(false);
      });
    });
  }

  private extractFilename(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = path.basename(pathname);
      return filename || `download_${Date.now()}`;
    } catch {
      return `download_${Date.now()}`;
    }
  }
}
