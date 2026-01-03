import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from './config.js';
import { getDatabase } from './db/schema.js';
import { registerRoutes } from './routes/index.js';
import { validateSession, cleanupSessions } from './services/session.js';
import { downloadManager } from './services/download-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const config = getConfig();

  console.log('=================================');
  console.log('  DDL-qBittorrent Service');
  console.log('=================================');
  console.log(`Port: ${config.port}`);
  console.log(`Download path: ${config.downloadPath}`);
  console.log(`Temp path: ${config.tempPath}`);
  console.log(`Max concurrent downloads: ${config.maxConcurrentDownloads}`);
  console.log('');

  // Initialize database
  getDatabase();

  // Create Fastify instance
  const fastify = Fastify({
    logger: false,
  });

  // Register plugins
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyFormbody);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max torrent file size
    },
  });

  // Serve static files (UI)
  const publicPath = path.join(__dirname, '..', 'public');
  await fastify.register(fastifyStatic, {
    root: publicPath,
    prefix: '/',
  });

  // Auth middleware for protected routes
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip auth for login endpoint
    if (request.url === '/api/v2/auth/login') {
      return;
    }

    // Skip auth for static files
    if (!request.url.startsWith('/api/')) {
      return;
    }

    const sid = request.cookies.SID;
    if (!validateSession(sid)) {
      return reply.status(403).send('Forbidden');
    }
  });

  // Register API routes
  await registerRoutes(fastify);

  // Health check endpoint
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  // Fallback to index.html for SPA routing
  fastify.setNotFoundHandler(async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send('Not found');
  });

  // Cleanup expired sessions periodically
  setInterval(() => {
    cleanupSessions();
  }, 60 * 60 * 1000); // Every hour

  // Resume downloads on startup
  downloadManager.resumeOnStartup();

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
