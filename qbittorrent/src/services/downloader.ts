import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config.js';
import type { DownloadProgress } from '../types/download.js';

interface ActiveDownload {
  hash: string;
  url: string;
  process: ChildProcess;
  tempPath: string;
  finalPath: string;
  savePath: string;  // Store savePath for restart scenarios
  filename: string;  // Store filename for restart scenarios
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeed: number;
  resumeOffset: number; // Bytes already downloaded before resume
  stopped: boolean;
  onProgress?: (progress: DownloadProgress) => void;
  onComplete?: (finalPath: string) => void;
  onError?: (error: Error) => void;
  onPaused?: () => void;
  onMoving?: (finalPath: string) => void;
}

// Track active curl processes
const activeDownloads: Map<string, ActiveDownload> = new Map();

// Track paused downloads info for resume
const pausedDownloads: Map<string, {
  url: string;
  tempPath: string;
  finalPath: string;
  savePath: string;
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
}> = new Map();

/**
 * Start a download using curl
 */
export function startDownload(
  hash: string,
  url: string,
  filename: string,
  callbacks: {
    onProgress?: (progress: DownloadProgress) => void;
    onComplete?: (finalPath: string) => void;
    onError?: (error: Error) => void;
    onPaused?: () => void;
    onMoving?: (finalPath: string) => void;  // Called when moving file to final destination
  },
  knownTotalSize?: number,  // Pass the known total size from database for resume
  savePath?: string  // Custom save path (e.g., with category subfolder)
): void {
  const config = getConfig();
  const downloadPath = savePath || config.downloadPath;

  // Ensure directories exist (recursive to create category subfolders)
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true });
  }
  if (!fs.existsSync(config.tempPath)) {
    fs.mkdirSync(config.tempPath, { recursive: true });
  }

  const finalPath = path.join(downloadPath, filename);
  const tempPath = path.join(config.tempPath, `${hash}_${filename}`);

  // Check if resuming from pause
  const pausedInfo = pausedDownloads.get(hash);

  // Check if temp file exists (either from pausedInfo or calculated path)
  const tempFileToCheck = pausedInfo?.tempPath || tempPath;
  const tempFileExists = fs.existsSync(tempFileToCheck);
  let tempFileSize = 0;

  if (tempFileExists) {
    try {
      const stats = fs.statSync(tempFileToCheck);
      tempFileSize = stats.size;
    } catch (e) {
      // Ignore
    }
  }

  const isResume = tempFileExists && tempFileSize > 0;
  const actualTempPath = pausedInfo?.tempPath || tempPath;

  console.log(`[Downloader] ${isResume ? 'Resuming' : 'Starting'} download: ${url}`);
  console.log(`[Downloader] Temp path: ${actualTempPath}`);
  console.log(`[Downloader] Final path: ${finalPath}`);
  if (isResume) {
    console.log(`[Downloader] Temp file exists, size: ${tempFileSize} bytes`);
  }

  // curl with progress output
  const curlArgs = [
    '-L',
    '-o', actualTempPath,
    '--fail',
  ];

  // Add resume flag if file exists with content
  if (isResume) {
    curlArgs.push('-C', '-');
    console.log(`[Downloader] Resuming from byte ${tempFileSize}`);
  }

  curlArgs.push(url);

  const proc = spawn('curl', curlArgs, {
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  });

  // Preserve total from pausedInfo or knownTotalSize (from database), and calculate initial progress for resume
  const initialTotalBytes = pausedInfo?.totalBytes || knownTotalSize || 0;
  const initialDownloadedBytes = isResume ? tempFileSize : 0;
  const initialProgress = initialTotalBytes > 0
    ? Math.round((initialDownloadedBytes / initialTotalBytes) * 100)
    : 0;

  console.log(`[Downloader] Creating download object:`);
  console.log(`[Downloader]   - isResume: ${isResume}`);
  console.log(`[Downloader]   - resumeOffset: ${tempFileSize}`);
  console.log(`[Downloader]   - initialTotalBytes: ${initialTotalBytes}`);
  console.log(`[Downloader]   - initialDownloadedBytes: ${initialDownloadedBytes}`);
  console.log(`[Downloader]   - initialProgress: ${initialProgress}%`);

  const download: ActiveDownload = {
    hash,
    url,
    process: proc,
    tempPath: actualTempPath,
    finalPath,
    savePath: downloadPath,  // Store for restart scenarios
    filename,  // Store for restart scenarios
    progress: initialProgress,
    downloadedBytes: initialDownloadedBytes,
    totalBytes: initialTotalBytes,
    downloadSpeed: 0,
    resumeOffset: isResume ? tempFileSize : 0,
    stopped: false,
    ...callbacks,
  };

  // Clear paused info
  if (pausedInfo) {
    pausedDownloads.delete(hash);
  }

  activeDownloads.set(hash, download);

  // Emit initial progress immediately for resume (so UI shows correct progress before curl reports)
  if (isResume && download.totalBytes > 0) {
    const eta = 8640000; // Unknown until curl reports speed
    download.onProgress?.({
      hash: download.hash,
      progress: download.progress,
      downloadedBytes: download.downloadedBytes,
      totalBytes: download.totalBytes,
      downloadSpeed: 0,
      eta,
    });
  }

  proc.stderr.on('data', (data: Buffer) => {
    const output = data.toString();
    parseProgress(download, output);
  });

  proc.on('close', (code) => {
    // Check if this was an intentional stop (pause)
    if (download.stopped) {
      console.log(`[Downloader] Download paused: ${hash}`);
      download.onPaused?.();
      activeDownloads.delete(hash);
      return;
    }

    if (code === 0) {
      // Move file from temp to final destination (async to not block)
      download.onMoving?.(finalPath);
      console.log(`[Downloader] Moving file to: ${finalPath}`);

      moveFileAsync(actualTempPath, finalPath)
        .then(() => {
          console.log(`[Downloader] Download complete: ${finalPath}`);
          download.progress = 100;
          download.onComplete?.(finalPath);
        })
        .catch((error: any) => {
          console.error(`[Downloader] Error moving file: ${error.message}`);
          download.onError?.(error);
        })
        .finally(() => {
          activeDownloads.delete(hash);
        });
      return;  // Don't delete from activeDownloads yet, wait for move to complete
    } else if (code === 33) {
      // curl error 33: HTTP server doesn't support byte ranges (resume not possible)
      console.log(`[Downloader] Server doesn't support resume, restarting from beginning`);
      // Delete partial file and restart
      try {
        if (fs.existsSync(actualTempPath)) {
          fs.unlinkSync(actualTempPath);
        }
      } catch {}
      // Restart without resume - preserve savePath for correct destination
      activeDownloads.delete(hash);
      startDownload(hash, url, download.filename, callbacks, undefined, download.savePath);
      return;
    } else {
      console.error(`[Downloader] Download failed with code ${code}`);
      // Cleanup temp file on error
      try {
        if (fs.existsSync(actualTempPath)) {
          fs.unlinkSync(actualTempPath);
        }
      } catch {}
      download.onError?.(new Error(`Download failed with code ${code}`));
    }
    activeDownloads.delete(hash);
  });

  proc.on('error', (error) => {
    console.error(`[Downloader] Process error: ${error.message}`);
    if (!download.stopped) {
      download.onError?.(error);
    }
    activeDownloads.delete(hash);
  });
}

/**
 * Pause a download (keeps temp file for resume)
 */
export function pauseDownload(hash: string): boolean {
  const download = activeDownloads.get(hash);
  if (!download) {
    return false;
  }

  console.log(`[Downloader] Pausing download: ${hash}`);

  // Mark as intentionally stopped
  download.stopped = true;

  // Get actual file size from disk for accurate resume
  let actualDownloadedBytes = download.downloadedBytes;
  try {
    if (fs.existsSync(download.tempPath)) {
      const stats = fs.statSync(download.tempPath);
      actualDownloadedBytes = stats.size;
      console.log(`[Downloader] Actual temp file size: ${actualDownloadedBytes} bytes`);
    }
  } catch (e) {
    // Use tracked value
  }

  // Save info for resume
  pausedDownloads.set(hash, {
    url: download.url,
    tempPath: download.tempPath,
    finalPath: download.finalPath,
    savePath: download.savePath,
    filename: download.filename,
    downloadedBytes: actualDownloadedBytes,
    totalBytes: download.totalBytes,
  });

  // Kill the process
  download.process.kill('SIGTERM');

  return true;
}

/**
 * Stop a download completely (deletes temp file)
 */
export function stopDownload(hash: string): boolean {
  const download = activeDownloads.get(hash);
  if (!download) {
    // Check if it's paused
    const pausedInfo = pausedDownloads.get(hash);
    if (pausedInfo) {
      // Delete temp file
      if (fs.existsSync(pausedInfo.tempPath)) {
        try {
          fs.unlinkSync(pausedInfo.tempPath);
          console.log(`[Downloader] Cleaned up paused temp file: ${pausedInfo.tempPath}`);
        } catch (e) {
          console.error(`[Downloader] Failed to cleanup paused temp file`);
        }
      }
      pausedDownloads.delete(hash);
      return true;
    }
    return false;
  }

  console.log(`[Downloader] Stopping download: ${hash}`);

  // Mark as stopped
  download.stopped = true;

  // Kill the process
  download.process.kill('SIGTERM');

  // Wait a bit then cleanup
  setTimeout(() => {
    if (download.tempPath && fs.existsSync(download.tempPath)) {
      try {
        fs.unlinkSync(download.tempPath);
        console.log(`[Downloader] Cleaned up temp file: ${download.tempPath}`);
      } catch (e) {
        console.error(`[Downloader] Failed to cleanup temp file: ${download.tempPath}`);
      }
    }
  }, 500);

  // Remove from paused if exists
  pausedDownloads.delete(hash);

  return true;
}

/**
 * Check if a download is active
 */
export function isDownloadActive(hash: string): boolean {
  return activeDownloads.has(hash);
}

/**
 * Check if a download is paused
 */
export function isDownloadPaused(hash: string): boolean {
  return pausedDownloads.has(hash);
}

/**
 * Get paused download info
 */
export function getPausedDownloadInfo(hash: string): { downloadedBytes: number; totalBytes: number } | null {
  return pausedDownloads.get(hash) || null;
}

/**
 * Get download progress for a hash
 */
export function getDownloadProgress(hash: string): DownloadProgress | null {
  const download = activeDownloads.get(hash);
  if (!download) return null;

  const eta = download.downloadSpeed > 0 && download.totalBytes > 0
    ? Math.ceil((download.totalBytes - download.downloadedBytes) / download.downloadSpeed)
    : 8640000; // Infinity

  return {
    hash: download.hash,
    progress: download.progress,
    downloadedBytes: download.downloadedBytes,
    totalBytes: download.totalBytes,
    downloadSpeed: download.downloadSpeed,
    eta,
  };
}

/**
 * Parse curl progress output
 */
function parseProgress(download: ActiveDownload, output: string): void {
  // Parse progress from curl's default output
  // Format:  5  500M    5 26.3M    0     0  10.5M      0  0:00:47  0:00:02  0:00:45 10.5M
  // Columns: % Total % Recv % Xferd AvgDl AvgUp TimeTotal TimeSpent TimeLeft CurrentSpeed

  const lines = output.split('\n');
  for (const line of lines) {
    // Skip header lines and empty lines
    if (!line.trim() || line.includes('Total') || line.includes('Dload')) continue;

    // Split by whitespace
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 12) {
      // Second column is total size (this is the REMAINING size when resuming)
      const totalStr = parts[1];
      if (totalStr && totalStr !== '--') {
        const reportedTotal = parseSize(totalStr);
        // Only update totalBytes if we got a meaningful value (> 0)
        if (reportedTotal > 0) {
          if (download.resumeOffset > 0) {
            // When resuming, curl reports remaining bytes as total
            // So actual total = resumeOffset + reportedTotal
            // Only update if we don't have a total yet, or if the calculated total is larger
            // (never let total decrease)
            const calculatedTotal = download.resumeOffset + reportedTotal;
            if (download.totalBytes === 0 || calculatedTotal > download.totalBytes) {
              download.totalBytes = calculatedTotal;
            }
          } else if (download.totalBytes === 0) {
            // Fresh download, just use reported total
            download.totalBytes = reportedTotal;
          }
        }
      }

      // Fourth column is downloaded (this is bytes downloaded IN THIS SESSION)
      const downloadedStr = parts[3];
      if (downloadedStr && downloadedStr !== '--') {
        const sessionDownloaded = parseSize(downloadedStr);
        // Add resume offset to get actual total downloaded
        download.downloadedBytes = download.resumeOffset + sessionDownloaded;
      }

      // Calculate actual progress based on total
      if (download.totalBytes > 0) {
        download.progress = Math.round((download.downloadedBytes / download.totalBytes) * 100);
      }

      // Last column is current speed
      const speedStr = parts[parts.length - 1];
      if (speedStr && speedStr !== '0' && speedStr !== '--:--:--') {
        download.downloadSpeed = parseSize(speedStr);
      }

      // Notify progress
      const eta = download.downloadSpeed > 0 && download.totalBytes > 0
        ? Math.ceil((download.totalBytes - download.downloadedBytes) / download.downloadSpeed)
        : 8640000;

      download.onProgress?.({
        hash: download.hash,
        progress: download.progress,
        downloadedBytes: download.downloadedBytes,
        totalBytes: download.totalBytes,
        downloadSpeed: download.downloadSpeed,
        eta,
      });
    }
  }
}

/**
 * Parse size string like "10.5M", "500K", "1024" to bytes
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)([KMGT])?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();

  switch (unit) {
    case 'K': return value * 1024;
    case 'M': return value * 1024 * 1024;
    case 'G': return value * 1024 * 1024 * 1024;
    case 'T': return value * 1024 * 1024 * 1024 * 1024;
    default: return value;
  }
}

/**
 * Move file with cross-device fallback (async version)
 */
async function moveFileAsync(src: string, dest: string): Promise<void> {
  const fsPromises = await import('fs/promises');

  try {
    await fsPromises.rename(src, dest);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      // Cross-device move, use copy+delete (this is the slow part)
      console.log(`[Downloader] Cross-device move, using copy+delete`);
      await fsPromises.copyFile(src, dest);
      await fsPromises.unlink(src);
    } else {
      throw error;
    }
  }
}
