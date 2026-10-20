import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { registerRoutes } from './routes/index.js';
import { validateSession } from './services/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build the HTTP application: plugins, session check, qBittorrent API routes and the UI.
 * Kept apart from the process bootstrap so it can be exercised without listening.
 */
export async function buildApp(): Promise<FastifyInstance> {
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
      console.log(`[Auth] 403 Forbidden: ${request.method} ${request.url} (invalid session)`);
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

  return fastify;
}
