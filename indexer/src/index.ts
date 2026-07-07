import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { config, initializeSiteUrls } from './config.js';
import { getScraper } from './scrapers/index.js';
import { torznabRoutes } from './routes/torznab.js';
import darkiworldConfigRoutes from './routes/darkiworld-config.js';
import { getAvailableSites } from './scrapers/index.js';
import { renderHomePage } from './views/home.js';
import { closeBrowser, getServiceCacheStats } from './utils/dlprotect.js';

const isDev = process.env.NODE_ENV !== 'production';

const app = Fastify({
  logger: isDev
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }
    : { level: 'info' },
});

async function start(): Promise<void> {
  try {
    // Initialize site URLs (fetch from Telegram if not configured)
    await initializeSiteUrls();

    // Pre-warm Bookys cache in background (constructor triggers scrape)
    void getScraper('bookys').catch(err => console.error('[Startup] Bookys pre-warm failed:', err));

    // Register routes
    await app.register(torznabRoutes);
    await app.register(darkiworldConfigRoutes);

    // Homepage - HTML interface
    app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host || `${config.host}:${config.port}`;
      const baseUrl = `${protocol}://${host}`;

      reply.type('text/html');
      return renderHomePage(baseUrl);
    });

    // JSON API info endpoint
    app.get('/info', async () => {
      const cacheStats = await getServiceCacheStats();
      return {
        name: 'DDL Torznab',
        version: '1.0.0',
        description: 'Torznab indexer for DDL sites',
        availableSites: getAvailableSites(),
        dlprotectCache: cacheStats ? {
          entries: cacheStats.entries,
          directory: cacheStats.directory,
        } : null,
        endpoints: {
          health: '/health',
          sites: '/sites',
          api: '/api/:site?t=caps|search|tvsearch|movie|book',
        },
      };
    });

    // Start server
    await app.listen({
      port: config.port,
      host: config.host,
    });

    const cacheStats = await getServiceCacheStats();
    const sites = getAvailableSites().join(', ') || 'None configured';
    const cache = cacheStats ? `${cacheStats.entries} entries` : 'unavailable';
    const serverUrl = `http://${config.host}:${config.port}`;
    const localUrl = `http://localhost:${config.port}`;

    // Helper to pad line content to 58 chars (60 - 2 for "║ " and " ║")
    const pad = (text: string) => text.padEnd(58);

    console.log(`
╔════════════════════════════════════════════════════════════╗
║                    DDL Torznab Server                      ║
╠════════════════════════════════════════════════════════════╣
║ ${pad(`Server running on ${serverUrl}`)} ║
║ ${pad('')} ║
║ ${pad(`Available sites: ${sites}`)} ║
║ ${pad(`DL-Protect cache: ${cache}`)} ║
║ ${pad('')} ║
║ ${pad(`Open ${localUrl} in your browser`)} ║
╚════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  try {
    await app.close();
    console.log('Server closed');

    // Close Playwright browser
    await closeBrowser();
    console.log('Browser closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();