import { FastifyInstance } from 'fastify';
import { getConfig, saveConfig, Config } from '../utils/config.js';
import { clients, getEnabledClients } from '../clients/index.js';
import { stopWatcher, startWatcher } from '../watcher.js';
import { alldebrid } from '../utils/alldebrid.js';

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // Get current config
  app.get('/api/config', async () => {
    const config = getConfig();
    // Hide passwords/secrets in response
    return {
      ...config,
      alldebridApiKey: config.alldebridApiKey ? '********' : '',
      downloadStation: {
        ...config.downloadStation,
        password: config.downloadStation.password ? '********' : '',
      },
      jdownloader: {
        ...config.jdownloader,
        password: config.jdownloader.password ? '********' : '',
      },
    };
  });

  // Save config
  app.post<{ Body: Partial<Config> }>('/api/config', async (request, reply) => {
    try {
      const currentConfig = getConfig();
      const newConfig = request.body;

      // Merge configs, preserving passwords/secrets if not changed
      const merged: Config = {
        ...currentConfig,
        ...newConfig,
        alldebridApiKey: newConfig.alldebridApiKey === '********'
          ? currentConfig.alldebridApiKey
          : (newConfig.alldebridApiKey ?? currentConfig.alldebridApiKey),
        downloadStation: {
          ...currentConfig.downloadStation,
          ...newConfig.downloadStation,
          password: newConfig.downloadStation?.password === '********'
            ? currentConfig.downloadStation.password
            : (newConfig.downloadStation?.password || currentConfig.downloadStation.password),
        },
        jdownloader: {
          ...currentConfig.jdownloader,
          ...newConfig.jdownloader,
          apiMode: newConfig.jdownloader?.apiMode || currentConfig.jdownloader.apiMode || 'auto',
          password: newConfig.jdownloader?.password === '********'
            ? currentConfig.jdownloader.password
            : (newConfig.jdownloader?.password || currentConfig.jdownloader.password),
        },
        aria2: {
          ...currentConfig.aria2,
          ...newConfig.aria2,
        },
      };

      saveConfig(merged);

      // Restart watcher with new config
      stopWatcher();
      startWatcher();

      return { success: true };
    } catch (error) {
      reply.status(500);
      return { success: false, error: String(error) };
    }
  });

  // Get clients status
  app.get('/api/clients', async () => {
    const results = [];

    for (const client of clients) {
      results.push({
        name: client.name,
        enabled: client.isEnabled(),
      });
    }

    return results;
  });

  // Test client connection (with optional config override from form)
  app.post<{ Params: { clientName: string }; Body: Partial<Config> }>('/api/clients/:clientName/test', async (request, reply) => {
    const { clientName } = request.params;
    const formConfig = request.body;
    console.log(`[API] Testing client: ${clientName}`);

    // If form config is provided, temporarily save it for the test
    if (formConfig && Object.keys(formConfig).length > 0) {
      console.log(`[API] Using form config for test`);
      const currentConfig = getConfig();
      const tempConfig: Config = {
        ...currentConfig,
        ...formConfig,
        downloadStation: {
          ...currentConfig.downloadStation,
          ...formConfig.downloadStation,
          password: formConfig.downloadStation?.password === '********'
            ? currentConfig.downloadStation.password
            : (formConfig.downloadStation?.password || currentConfig.downloadStation.password),
        },
        jdownloader: {
          ...currentConfig.jdownloader,
          ...formConfig.jdownloader,
          apiMode: formConfig.jdownloader?.apiMode || currentConfig.jdownloader.apiMode || 'auto',
          password: formConfig.jdownloader?.password === '********'
            ? currentConfig.jdownloader.password
            : (formConfig.jdownloader?.password || currentConfig.jdownloader.password),
        },
        aria2: {
          ...currentConfig.aria2,
          ...formConfig.aria2,
        },
      };
      saveConfig(tempConfig);
    }

    const client = clients.find(c => c.name.toLowerCase() === clientName.toLowerCase());

    if (!client) {
      console.log(`[API] Client not found: ${clientName}`);
      reply.status(404);
      return { success: false, error: 'Client not found' };
    }

    try {
      const result = await client.testConnection();
      console.log(`[API] Test result for ${clientName}: ${result}`);
      return { success: result, message: result ? 'Connection successful' : 'Connection failed - check logs for details' };
    } catch (error) {
      console.error(`[API] Test error for ${clientName}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Save AllDebrid API key only
  app.post<{ Body: { alldebridApiKey?: string } }>('/api/config/alldebrid', async (request, reply) => {
    try {
      const { alldebridApiKey } = request.body;

      if (!alldebridApiKey || alldebridApiKey === '********') {
        reply.status(400);
        return { success: false, error: 'Invalid API key' };
      }

      const currentConfig = getConfig();
      saveConfig({ ...currentConfig, alldebridApiKey });

      return { success: true };
    } catch (error) {
      reply.status(500);
      return { success: false, error: String(error) };
    }
  });

  // Test AllDebrid connection
  app.post<{ Body: { alldebridApiKey?: string } }>('/api/alldebrid/test', async (request) => {
    const { alldebridApiKey } = request.body;
    console.log('[API] Testing AllDebrid connection...');

    // Temporarily save the API key for testing (only if it's a new value, not the masked one)
    if (alldebridApiKey && alldebridApiKey !== '********') {
      const currentConfig = getConfig();
      saveConfig({ ...currentConfig, alldebridApiKey });
    }
    // If '********' was sent, we use the already saved config (no change needed)

    try {
      const result = await alldebrid.testConnection();
      return { success: result };
    } catch (error) {
      console.error('[API] AllDebrid test error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Health check
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      enabledClients: getEnabledClients().map(c => c.name),
      blackholePath: getConfig().blackholePath,
      alldebridConfigured: alldebrid.isConfigured(),
    };
  });
}
