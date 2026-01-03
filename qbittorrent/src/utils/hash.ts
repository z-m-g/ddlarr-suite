import * as crypto from 'crypto';

/**
 * Generate a unique SHA-1 hash for a download
 * Uses link + timestamp + random to ensure uniqueness
 */
export function generateDownloadHash(link: string): string {
  const data = `${link}:${Date.now()}:${Math.random()}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

/**
 * Generate a session ID for authentication
 */
export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}
