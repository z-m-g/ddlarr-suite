import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './utils/config.js';
import { apiRoutes } from './routes/api.js';
import { startWatcher } from './watcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '9118', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('=== DDL Downloader ===');

  // Load configuration
  loadConfig();

  // Create Fastify server
  const app = Fastify({
    logger: false,
  });

  // Register plugins
  await app.register(fastifyFormbody);

  // Serve static files (UI)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // Register API routes
  await app.register(apiRoutes);

  // Start watcher
  startWatcher();

  // Start server
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`Configuration UI: http://localhost:${PORT}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

main().catch(console.error);
