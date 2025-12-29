import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DownloadClient } from './base.js';
import { getConfig } from '../utils/config.js';

export interface DownloadProgress {
  id: string;
  filename: string;
  url: string;
  progress: number; // 0-100
  speed: string;
  size: string;
  downloaded: string;
  status: 'downloading' | 'completed' | 'failed' | 'stopped';
  startedAt: Date;
}

interface ActiveDownload extends DownloadProgress {
  process?: ChildProcess;
  tempPath?: string;
}

// Track active downloads for progress reporting
const activeDownloads: Map<string, ActiveDownload> = new Map();

export function getActiveDownloads(): DownloadProgress[] {
  // Return without process reference
  return Array.from(activeDownloads.values()).map(({ process, tempPath, ...rest }) => rest);
}

export function stopDownload(downloadId: string): boolean {
  const download = activeDownloads.get(downloadId);
  if (!download || !download.process) {
    return false;
  }

  console.log(`[curl] Stopping download: ${download.filename}`);
  download.process.kill('SIGTERM');
  download.status = 'stopped';

  // Cleanup temp file
  if (download.tempPath && fs.existsSync(download.tempPath)) {
    try {
      fs.unlinkSync(download.tempPath);
      console.log(`[curl] Cleaned up temp file: ${download.tempPath}`);
    } catch (e) {
      console.error(`[curl] Failed to cleanup temp file: ${download.tempPath}`);
    }
  }

  // Remove after delay
  setTimeout(() => activeDownloads.delete(downloadId), 5000);
  return true;
}

/**
 * curl client - downloads directly using curl command
 * Downloads to temp directory first, then moves to destination
 */
export class CurlClient implements DownloadClient {
  name = 'curl';

  isEnabled(): boolean {
    const config = getConfig().curl;
    return config.enabled && !!config.destinationPath;
  }

  async testConnection(): Promise<boolean> {
    const config = getConfig().curl;
    console.log('[curl] Testing connection...');
    console.log(`[curl] Config: destinationPath=${config.destinationPath}`);

    if (!config.destinationPath) {
      console.log('[curl] Missing required field: destinationPath');
      return false;
    }

    // Check if destination path exists
    if (!fs.existsSync(config.destinationPath)) {
      console.log(`[curl] Destination path does not exist: ${config.destinationPath}`);
      return false;
    }

    // Check if curl is available
    return new Promise((resolve) => {
      const proc = spawn('curl', ['--version']);
      proc.on('close', (code) => {
        if (code === 0) {
          console.log('[curl] curl is available');
          resolve(true);
        } else {
          console.log('[curl] curl is not available');
          resolve(false);
        }
      });
      proc.on('error', () => {
        console.log('[curl] curl is not available');
        resolve(false);
      });
    });
  }

  async addDownload(url: string, filename?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      console.warn('[curl] Not enabled');
      return false;
    }

    const config = getConfig().curl;

    // Determine filename
    let finalFilename = filename || this.extractFilename(url);

    // Add extension from URL if missing
    const hasExtension = /\.[a-zA-Z0-9]{2,4}$/.test(finalFilename);
    if (!hasExtension) {
      const urlMatch = url.match(/\.([a-zA-Z0-9]{2,4})(?:\?|$)/);
      if (urlMatch) {
        finalFilename = `${finalFilename}.${urlMatch[1]}`;
        console.log(`[curl] Added extension from URL: ${urlMatch[1]}`);
      }
    }

    // Use temp directory for downloads in progress (outside Radarr scan path)
    const tempDir = config.tempPath || '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const finalPath = path.join(config.destinationPath, finalFilename);
    const tempPath = path.join(tempDir, `curl_${Date.now()}_${finalFilename}`);

    console.log(`[curl] Downloading: ${url}`);
    console.log(`[curl] Temp path: ${tempPath}`);
    console.log(`[curl] Final path: ${finalPath}`);

    const downloadId = `curl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
      // curl with progress output
      // -L: follow redirects
      // -o: output file
      // Default progress shows: % Total % Received Speed Time etc
      const proc = spawn('curl', [
        '-L',
        '-o', tempPath,
        '--fail',
        url,
      ], {
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      });

      // Store process reference for stop functionality
      progress.process = proc;

      let lastProgress = 0;

      proc.stderr.on('data', (data: Buffer) => {
        const output = data.toString();

        // Parse progress from curl's default output
        // Format:  5  500M    5 26.3M    0     0  10.5M      0  0:00:47  0:00:02  0:00:45 10.5M
        // Columns: % Total % Recv % Xferd AvgDl AvgUp TimeTotal TimeSpent TimeLeft CurrentSpeed
        // Last column is always current speed

        const lines = output.split('\n');
        for (const line of lines) {
          // Skip header lines and empty lines
          if (!line.trim() || line.includes('Total') || line.includes('Dload')) continue;

          // Split by whitespace
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 12) {
            // First column is percentage
            const newProgress = parseInt(parts[0], 10);
            if (!isNaN(newProgress) && newProgress > lastProgress && newProgress <= 100) {
              lastProgress = newProgress;
              progress.progress = lastProgress;
            }

            // Last column is current speed (e.g., "10.5M" or "1024" for bytes)
            const speedStr = parts[parts.length - 1];
            if (speedStr && speedStr !== '0' && speedStr !== '--:--:--') {
              // Add unit if it's just a number (means bytes)
              if (/^\d+\.?\d*$/.test(speedStr)) {
                const bytes = parseFloat(speedStr);
                progress.speed = this.formatBytes(bytes) + '/s';
              } else {
                progress.speed = speedStr + '/s';
              }
            }
          }
        }

        if (lastProgress > 0) {
          console.log(`[curl] Progress: ${lastProgress}% - Speed: ${progress.speed}`);
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Move file from temp to final destination
          try {
            fs.renameSync(tempPath, finalPath);
            console.log(`[curl] Download complete: ${finalPath}`);
            progress.progress = 100;
            progress.status = 'completed';
            setTimeout(() => activeDownloads.delete(downloadId), 60000);
            resolve(true);
          } catch (moveError: any) {
            // Try copy + delete if rename fails (cross-device)
            if (moveError.code === 'EXDEV') {
              try {
                console.log(`[curl] Cross-device move, using copy+delete`);
                fs.copyFileSync(tempPath, finalPath);
                fs.unlinkSync(tempPath);
                console.log(`[curl] Download complete: ${finalPath}`);
                progress.progress = 100;
                progress.status = 'completed';
                setTimeout(() => activeDownloads.delete(downloadId), 60000);
                resolve(true);
              } catch (copyError: any) {
                console.error(`[curl] Error copying file: ${copyError.message}`);
                progress.status = 'failed';
                setTimeout(() => activeDownloads.delete(downloadId), 60000);
                resolve(false);
              }
            } else {
              console.error(`[curl] Error moving file: ${moveError.message}`);
              progress.status = 'failed';
              setTimeout(() => activeDownloads.delete(downloadId), 60000);
              resolve(false);
            }
          }
        } else {
          console.error(`[curl] Download failed with code ${code}`);
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
        console.error(`[curl] Process error: ${error.message}`);
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

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
