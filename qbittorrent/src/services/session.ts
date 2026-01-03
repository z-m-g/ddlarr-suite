import { generateSessionId } from '../utils/hash.js';
import { createSession, getSession, deleteSession, cleanExpiredSessions } from '../db/repository.js';
import { getConfig } from '../config.js';

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Validate user credentials
 */
export function validateCredentials(username: string, password: string): boolean {
  const config = getConfig();
  return username === config.auth.username && password === config.auth.password;
}

/**
 * Create a new session for a user
 */
export function createUserSession(username: string): string {
  const sid = generateSessionId();
  const expiresAt = Date.now() + SESSION_DURATION;
  createSession(sid, username, expiresAt);
  console.log(`[Session] Created session for ${username}, expires at ${new Date(expiresAt).toISOString()}`);
  return sid;
}

/**
 * Validate a session ID
 */
export function validateSession(sid: string | undefined): boolean {
  if (!sid) return false;
  const session = getSession(sid);
  return session !== null;
}

/**
 * Destroy a session
 */
export function destroySession(sid: string): void {
  deleteSession(sid);
  console.log(`[Session] Destroyed session ${sid.substring(0, 8)}...`);
}

/**
 * Cleanup expired sessions (call periodically)
 */
export function cleanupSessions(): void {
  cleanExpiredSessions();
}
