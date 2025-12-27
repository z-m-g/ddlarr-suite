import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import { getConfig } from './utils/config.js';
import { extractLinkFromTorrent, extractNameFromTorrent } from './utils/torrent.js';
import { addDownloadToAll, getEnabledClients } from './clients/index.js';
import { alldebrid } from './utils/alldebrid.js';

const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

let watcher: chokidar.FSWatcher | null = null;
let scanInterval: NodeJS.Timeout | null = null;
const processedFiles = new Set<string>(); // Track already processed files

async function processFile(filePath: string): Promise<void> {
  // Only process .torrent files
  if (!filePath.endsWith('.torrent')) {
    return;
  }

  // Skip if already successfully processed (file was moved)
  if (processedFiles.has(filePath)) {
    return; // Silent skip - file already handled
  }

  console.log(`[Watcher] Processing: ${filePath}`);

  let link = extractLinkFromTorrent(filePath);
  if (!link) {
    console.warn(`[Watcher] No link found in: ${filePath}`);
    processedFiles.add(filePath); // Mark as processed to avoid spam
    return;
  }

  const filename = extractNameFromTorrent(filePath) || path.basename(filePath, '.torrent');

  console.log(`[Watcher] Found link: ${link}`);
  console.log(`[Watcher] Filename: ${filename}`);

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
      // Continue with original link
    }
  }

  const success = await addDownloadToAll(link, filename);

  if (success) {
    processedFiles.add(filePath);

    try {
      if (DEBUG) {
        // Debug mode: move to processed folder for inspection
        const config = getConfig();
        const processedPath = path.join(config.processedPath, path.basename(filePath));

        if (!fs.existsSync(config.processedPath)) {
          fs.mkdirSync(config.processedPath, { recursive: true });
        }

        fs.renameSync(filePath, processedPath);
        console.log(`[Watcher] Moved to processed: ${processedPath}`);
      } else {
        // Production mode: delete the file
        fs.unlinkSync(filePath);
        console.log(`[Watcher] Deleted: ${filePath}`);
      }
    } catch (error) {
      console.error(`[Watcher] Failed to cleanup file:`, error);
    }
  } else {
    console.error(`[Watcher] Failed to add download for: ${filePath}`);
    // Don't mark as processed - will retry on next scan
  }
}

export function startWatcher(): void {
  const config = getConfig();

  // Ensure blackhole directory exists
  if (!fs.existsSync(config.blackholePath)) {
    fs.mkdirSync(config.blackholePath, { recursive: true });
    console.log(`[Watcher] Created blackhole directory: ${config.blackholePath}`);
  }

  // Only create processed directory in debug mode
  if (DEBUG && !fs.existsSync(config.processedPath)) {
    fs.mkdirSync(config.processedPath, { recursive: true });
    console.log(`[Watcher] Created processed directory: ${config.processedPath}`);
  }

  const enabledClients = getEnabledClients();
  console.log(`[Watcher] Debug mode: ${DEBUG ? 'enabled (files moved to processed/)' : 'disabled (files deleted)'}`);
  console.log(`[Watcher] Enabled clients: ${enabledClients.map(c => c.name).join(', ') || 'none'}`);
  console.log(`[Watcher] AllDebrid: ${alldebrid.isConfigured() ? 'configured' : 'not configured'}`);

  if (enabledClients.length === 0) {
    console.warn('[Watcher] No download clients enabled! Configure clients via web UI.');
  }

  // Process existing files
  console.log(`[Watcher] Scanning existing files in: ${config.blackholePath}`);
  const existingFiles = fs.readdirSync(config.blackholePath)
    .filter(f => f.endsWith('.torrent'))
    .map(f => path.join(config.blackholePath, f));

  for (const file of existingFiles) {
    processFile(file).catch(console.error);
  }

  // Watch for new files
  watcher = chokidar.watch(config.blackholePath, {
    ignored: [
      /(^|[\/\\])\../, // Ignore dotfiles
      '**/processed/**', // Ignore processed folder
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
    const files = fs.readdirSync(config.blackholePath)
      .filter(f => f.endsWith('.torrent'))
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

  // Clear processed files cache
  processedFiles.clear();

  console.log('[Watcher] Stopped');
}
