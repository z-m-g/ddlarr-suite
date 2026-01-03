import { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { appRoutes } from './app.js';
import { torrentsRoutes } from './torrents.js';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(authRoutes);
  await fastify.register(appRoutes);
  await fastify.register(torrentsRoutes);
}
