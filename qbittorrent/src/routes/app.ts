import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config.js';

export async function appRoutes(fastify: FastifyInstance): Promise<void> {
  // Version - mimic qBittorrent version
  fastify.get('/api/v2/app/version', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send('v4.6.0');
  });

  // WebAPI version
  fastify.get('/api/v2/app/webapiVersion', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send('2.9.3');
  });

  // Build info
  fastify.get('/api/v2/app/buildInfo', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      qt: '6.4.2',
      libtorrent: '2.0.8.0',
      boost: '1.81.0',
      openssl: '3.0.8',
      zlib: '1.2.13',
      bitness: 64,
    });
  });

  // Preferences
  fastify.get('/api/v2/app/preferences', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    return reply.send({
      save_path: config.downloadPath,
      temp_path_enabled: true,
      temp_path: config.tempPath,
      max_active_downloads: config.maxConcurrentDownloads,
      max_active_torrents: config.maxConcurrentDownloads,
      max_active_uploads: 0,
      web_ui_username: config.auth.username,
      // Add more preferences as needed by Sonarr/Radarr
      auto_delete_mode: 0,
      preallocate_all: false,
      incomplete_files_ext: false,
      create_subfolder_enabled: false,
      start_paused_enabled: false,
      auto_tmm_enabled: false,
      torrent_content_layout: 'Original',
    });
  });

  // Set preferences
  fastify.post('/api/v2/app/setPreferences', async (_request: FastifyRequest, reply: FastifyReply) => {
    // For now, we don't persist preference changes
    // This endpoint is required for compatibility
    return reply.send();
  });

  // Default save path
  fastify.get('/api/v2/app/defaultSavePath', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    return reply.send(config.downloadPath);
  });

  // Shutdown
  fastify.post('/api/v2/app/shutdown', async (_request: FastifyRequest, reply: FastifyReply) => {
    console.log('[App] Shutdown requested (ignored in DDL mode)');
    return reply.send();
  });
}
