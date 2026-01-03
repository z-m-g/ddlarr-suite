import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateCredentials, createUserSession, destroySession } from '../services/session.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Login endpoint
  fastify.post('/api/v2/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username?: string; password?: string };
    const username = body.username || '';
    const password = body.password || '';

    if (validateCredentials(username, password)) {
      const sid = createUserSession(username);
      reply.setCookie('SID', sid, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
      });
      return reply.send('Ok.');
    }

    return reply.send('Fails.');
  });

  // Logout endpoint
  fastify.get('/api/v2/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const sid = request.cookies.SID;
    if (sid) {
      destroySession(sid);
      reply.clearCookie('SID', { path: '/' });
    }
    return reply.send('Ok.');
  });
}
