import { getConfig } from './config.js';
import { getDatabase } from './db/schema.js';
import { buildApp } from './app.js';
import { cleanupSessions } from './services/session.js';
import { downloadManager } from './services/download-manager.js';
import { blackholeWatcher } from './services/blackhole-watcher.js';

async function main() {
  const config = getConfig();

  console.log('=================================');
  console.log('  DDL-qBittorrent Service');
  console.log('=================================');
  console.log(`Port: ${config.port}`);
  console.log(`Download path: ${config.downloadPath}`);
  console.log(`Temp path: ${config.tempPath}`);
  console.log(`Max concurrent downloads: ${config.maxConcurrentDownloads}`);
  if (config.blackhole.enabled) {
    console.log(`Blackhole path: ${config.blackhole.path}`);
  }
  console.log('');

  // Initialize database
  getDatabase();

  // HTTP application (plugins, session check, API routes, UI)
  const fastify = await buildApp();

  // Cleanup expired sessions periodically
  setInterval(() => {
    cleanupSessions();
  }, 60 * 60 * 1000); // Every hour

  // Resume downloads on startup
  downloadManager.resumeOnStartup();

  // Start blackhole watcher (if enabled)
  await blackholeWatcher.start();

  // Start server
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
    console.log('');
    console.log('Configuration for Sonarr/Radarr:');
    console.log(`  Host: <your-server-ip>`);
    console.log(`  Port: ${config.port}`);
    console.log(`  Username: ${config.auth.username}`);
    console.log(`  Password: ********`);
    console.log('');
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

main();
