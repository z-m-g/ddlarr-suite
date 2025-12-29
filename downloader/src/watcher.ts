import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import { getConfig } from './utils/config.js';
import { extractLinkFromTorrent, extractNameFromTorrent } from './utils/torrent.js';
import { addDownloadToAll, getEnabledClients } from './clients/index.js';
import { alldebrid } from './utils/alldebrid.js';
import { isDlProtectLink, resolveDlProtectLink } from './utils/dlprotect.js';

const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

let watcher: chokidar.FSWatcher | null = null;
let scanInterval: NodeJS.Timeout | null = null;

// Get the processing directory path
function getProcessingPath(): string {
  const config = getConfig();
  return path.join(config.blackholePath, 'processing');
}

// Get the failed directory path
function getFailedPath(): string {
  const config = getConfig();
  return path.join(config.blackholePath, 'failed');
}

// Ensure processing and failed directories exist
function ensureWorkingDirectories(): void {
  const processingPath = getProcessingPath();
  const failedPath = getFailedPath();

  if (!fs.existsSync(processingPath)) {
    fs.mkdirSync(processingPath, { recursive: true });
  }
  if (!fs.existsSync(failedPath)) {
    fs.mkdirSync(failedPath, { recursive: true });
  }
}

async function processFile(filePath: string): Promise<void> {
  // Only process .torrent files
  if (!filePath.endsWith('.torrent')) {
    return;
  }

  // Skip files in subdirectories (processing/, failed/, processed/)
  const config = getConfig();
  const relativePath = path.relative(config.blackholePath, filePath);
  if (relativePath.includes(path.sep)) {
    return; // File is in a subdirectory, skip it
  }

  console.log(`[Watcher] Processing: ${filePath}`);

  // Move file to processing directory FIRST to prevent re-processing
  const processingPath = getProcessingPath();
  const processingFilePath = path.join(processingPath, path.basename(filePath));

  try {
    ensureWorkingDirectories();
    fs.renameSync(filePath, processingFilePath);
    console.log(`[Watcher] Moved to processing: ${processingFilePath}`);
  } catch (error) {
    console.error(`[Watcher] Failed to move file to processing:`, error);
    return; // Can't proceed if we can't move the file
  }

  // Now work with the file in processing directory
  let link = extractLinkFromTorrent(processingFilePath);
  if (!link) {
    console.warn(`[Watcher] No link found in: ${processingFilePath}`);
    // Move to failed directory
    moveToFailed(processingFilePath, 'no-link-found');
    return;
  }

  const filename = extractNameFromTorrent(processingFilePath) || path.basename(processingFilePath, '.torrent');

  console.log(`[Watcher] Found link: ${link}`);
  console.log(`[Watcher] Filename: ${filename}`);
  console.log(`[Watcher] DL-Protect resolve mode: ${config.dlprotectResolveAt}`);
  console.log(`[Watcher] Is DL-Protect link: ${isDlProtectLink(link)}`);

  // Resolve dl-protect links if configured to resolve in downloader
  if (config.dlprotectResolveAt === 'downloader' && isDlProtectLink(link)) {
    console.log(`[Watcher] Resolving dl-protect link...`);
    try {
      const resolvedLink = await resolveDlProtectLink(link);
      if (resolvedLink !== link) {
        console.log(`[Watcher] Resolved dl-protect: ${resolvedLink}`);
        link = resolvedLink;
      }
    } catch (error: any) {
      console.error(`[Watcher] DL-Protect resolution error: ${error.message}`);
      // Move to failed and stop
      moveToFailed(processingFilePath, 'dlprotect-error');
      return;
    }
  }

  // Try to debrid the link if AllDebrid is configured
  if (alldebrid.isConfigured()) {
    console.log(`[Watcher] Attempting to debrid link...`);
    try {
      const debridedLink = await alldebrid.debridLink(link);
      if (debridedLink !== link) {
        console.log(`[Watcher] Debrided link: ${debridedLink}`);
        link = debridedLink;
      }
    } catch (error: any) {
      console.error(`[Watcher] AllDebrid error: ${error.message}`);
      // Continue with original link (debrid is optional)
    }
  }

  const success = await addDownloadToAll(link, filename);

  if (success) {
    try {
      if (DEBUG) {
        // Debug mode: move to processed folder for inspection
        const processedFilePath = path.join(config.processedPath, path.basename(processingFilePath));

        if (!fs.existsSync(config.processedPath)) {
          fs.mkdirSync(config.processedPath, { recursive: true });
        }

        fs.renameSync(processingFilePath, processedFilePath);
        console.log(`[Watcher] Moved to processed: ${processedFilePath}`);
      } else {
        // Production mode: delete the file
        fs.unlinkSync(processingFilePath);
        console.log(`[Watcher] Deleted: ${processingFilePath}`);
      }
    } catch (error) {
      console.error(`[Watcher] Failed to cleanup file:`, error);
    }
  } else {
    console.error(`[Watcher] Failed to add download for: ${processingFilePath}`);
    moveToFailed(processingFilePath, 'download-client-error');
  }
}

function moveToFailed(filePath: string, reason: string): void {
  try {
    const failedPath = getFailedPath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(filePath, '.torrent');
    const failedFilePath = path.join(failedPath, `${baseName}_${reason}_${timestamp}.torrent`);

    fs.renameSync(filePath, failedFilePath);
    console.log(`[Watcher] Moved to failed: ${failedFilePath}`);
  } catch (error) {
    console.error(`[Watcher] Failed to move file to failed directory:`, error);
  }
}

export function startWatcher(): void {
  const config = getConfig();

  // Ensure blackhole directory exists
  if (!fs.existsSync(config.blackholePath)) {
    fs.mkdirSync(config.blackholePath, { recursive: true });
    console.log(`[Watcher] Created blackhole directory: ${config.blackholePath}`);
  }

  // Create working directories
  ensureWorkingDirectories();
  console.log(`[Watcher] Processing directory: ${getProcessingPath()}`);
  console.log(`[Watcher] Failed directory: ${getFailedPath()}`);

  // Only create processed directory in debug mode
  if (DEBUG && !fs.existsSync(config.processedPath)) {
    fs.mkdirSync(config.processedPath, { recursive: true });
    console.log(`[Watcher] Created processed directory: ${config.processedPath}`);
  }

  const enabledClients = getEnabledClients();
  console.log(`[Watcher] Debug mode: ${DEBUG ? 'enabled (files moved to processed/)' : 'disabled (files deleted)'}`);
  console.log(`[Watcher] Enabled clients: ${enabledClients.map(c => c.name).join(', ') || 'none'}`);
  console.log(`[Watcher] DL-Protect resolution: ${config.dlprotectResolveAt === 'downloader' ? 'enabled (in downloader)' : 'disabled (done in indexer)'}`);
  console.log(`[Watcher] AllDebrid: ${alldebrid.isConfigured() ? 'configured' : 'not configured'}`);

  if (enabledClients.length === 0) {
    console.warn('[Watcher] No download clients enabled! Configure clients via web UI.');
  }

  // Process existing files (only in root blackhole, not subdirectories)
  console.log(`[Watcher] Scanning existing files in: ${config.blackholePath}`);
  const existingFiles = fs.readdirSync(config.blackholePath)
    .filter(f => f.endsWith('.torrent'))
    .filter(f => {
      const fullPath = path.join(config.blackholePath, f);
      return fs.statSync(fullPath).isFile();
    })
    .map(f => path.join(config.blackholePath, f));

  for (const file of existingFiles) {
    processFile(file).catch(console.error);
  }

  // Watch for new files (only root directory)
  watcher = chokidar.watch(config.blackholePath, {
    ignored: [
      /(^|[\/\\])\../, // Ignore dotfiles
      '**/processing/**', // Ignore processing folder
      '**/processed/**', // Ignore processed folder
      '**/failed/**', // Ignore failed folder
    ],
    persistent: true,
    ignoreInitial: true, // We already processed existing files
    depth: 0, // Only watch the blackhole folder itself, not subdirectories
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath) => {
    console.log(`[Watcher] New file detected: ${filePath}`);
    processFile(filePath).catch(console.error);
  });

  watcher.on('error', (error) => {
    console.error('[Watcher] Error:', error);
  });

  console.log(`[Watcher] Watching: ${config.blackholePath}`);

  // Start periodic scanning as fallback (useful for Docker volumes)
  const intervalSeconds = config.scanInterval || 10;
  console.log(`[Watcher] Starting periodic scan every ${intervalSeconds} seconds`);

  scanInterval = setInterval(() => {
    scanDirectory();
  }, intervalSeconds * 1000);
}

function scanDirectory(): void {
  const config = getConfig();

  try {
    // Only scan root blackhole directory, not subdirectories
    const files = fs.readdirSync(config.blackholePath)
      .filter(f => f.endsWith('.torrent'))
      .filter(f => {
        const fullPath = path.join(config.blackholePath, f);
        return fs.statSync(fullPath).isFile();
      })
      .map(f => path.join(config.blackholePath, f));

    if (files.length > 0) {
      console.log(`[Watcher] Periodic scan found ${files.length} file(s)`);
    }

    for (const file of files) {
      processFile(file).catch(console.error);
    }
  } catch (error) {
    console.error('[Watcher] Scan error:', error);
  }
}

export function stopWatcher(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  console.log('[Watcher] Stopped');
}
