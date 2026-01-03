import { getDatabase } from './schema.js';
import type { Download, DownloadState } from '../types/download.js';

// ==================== Downloads ====================

export function getAllDownloads(): Download[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT hash, name, original_link, debrided_link, save_path,
           total_size, downloaded_size, download_speed, state,
           status_message, error_message, added_at, started_at, completed_at, category, priority
    FROM downloads
    ORDER BY added_at DESC
  `).all() as any[];

  return rows.map(mapRowToDownload);
}

export function getDownloadsByState(state: DownloadState): Download[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT hash, name, original_link, debrided_link, save_path,
           total_size, downloaded_size, download_speed, state,
           status_message, error_message, added_at, started_at, completed_at, category, priority
    FROM downloads
    WHERE state = ?
    ORDER BY priority DESC, added_at ASC
  `).all(state) as any[];

  return rows.map(mapRowToDownload);
}

export function getDownloadByHash(hash: string): Download | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT hash, name, original_link, debrided_link, save_path,
           total_size, downloaded_size, download_speed, state,
           status_message, error_message, added_at, started_at, completed_at, category, priority
    FROM downloads
    WHERE hash = ?
  `).get(hash) as any;

  return row ? mapRowToDownload(row) : null;
}

export function createDownload(download: Omit<Download, 'downloadSpeed'>): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO downloads (hash, name, original_link, debrided_link, save_path,
                          total_size, downloaded_size, state, status_message, error_message,
                          added_at, started_at, completed_at, category, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    download.hash,
    download.name,
    download.originalLink,
    download.debridedLink,
    download.savePath,
    download.totalSize,
    download.downloadedSize,
    download.state,
    download.statusMessage,
    download.errorMessage,
    download.addedAt,
    download.startedAt,
    download.completedAt,
    download.category,
    download.priority
  );
}

export function updateDownloadState(hash: string, state: DownloadState, errorMessage?: string): void {
  const db = getDatabase();
  if (state === 'completed') {
    db.prepare(`
      UPDATE downloads SET state = ?, status_message = NULL, error_message = ?, completed_at = ?
      WHERE hash = ?
    `).run(state, errorMessage || null, Date.now(), hash);
  } else if (state === 'downloading') {
    db.prepare(`
      UPDATE downloads SET state = ?, status_message = NULL, error_message = ?, started_at = ?
      WHERE hash = ?
    `).run(state, errorMessage || null, Date.now(), hash);
  } else if (state === 'error') {
    db.prepare(`
      UPDATE downloads SET state = ?, status_message = NULL, error_message = ?
      WHERE hash = ?
    `).run(state, errorMessage || null, hash);
  } else {
    db.prepare(`
      UPDATE downloads SET state = ?, error_message = ?
      WHERE hash = ?
    `).run(state, errorMessage || null, hash);
  }
}

export function updateDownloadStatusMessage(hash: string, statusMessage: string | null): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE downloads SET status_message = ?
    WHERE hash = ?
  `).run(statusMessage, hash);
}

export function updateDownloadProgress(
  hash: string,
  downloadedSize: number,
  totalSize: number,
  downloadSpeed: number
): void {
  const db = getDatabase();
  // Never decrease total_size - only update if new value is larger or current is 0
  // This prevents curl's remaining-bytes-as-total from overwriting the correct total
  db.prepare(`
    UPDATE downloads
    SET downloaded_size = ?,
        total_size = CASE
          WHEN ? > total_size THEN ?
          WHEN total_size = 0 THEN ?
          ELSE total_size
        END,
        download_speed = ?
    WHERE hash = ?
  `).run(downloadedSize, totalSize, totalSize, totalSize, downloadSpeed, hash);
}

export function updateDownloadLink(hash: string, debridedLink: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE downloads SET debrided_link = ?
    WHERE hash = ?
  `).run(debridedLink, hash);
}

export function updateDownloadName(hash: string, name: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE downloads SET name = ?
    WHERE hash = ?
  `).run(name, hash);
}

export function deleteDownload(hash: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM downloads WHERE hash = ?').run(hash);
}

function mapRowToDownload(row: any): Download {
  return {
    hash: row.hash,
    name: row.name,
    originalLink: row.original_link,
    debridedLink: row.debrided_link,
    savePath: row.save_path,
    totalSize: row.total_size,
    downloadedSize: row.downloaded_size,
    downloadSpeed: row.download_speed,
    state: row.state as DownloadState,
    statusMessage: row.status_message,
    errorMessage: row.error_message,
    addedAt: row.added_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    category: row.category,
    priority: row.priority,
  };
}

// ==================== Sessions ====================

export function createSession(sid: string, username: string, expiresAt: number): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO sessions (sid, username, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sid, username, Date.now(), expiresAt);
}

export function getSession(sid: string): { username: string; expiresAt: number } | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT username, expires_at FROM sessions WHERE sid = ?
  `).get(sid) as any;

  if (!row) return null;

  // Check if expired
  if (row.expires_at < Date.now()) {
    deleteSession(sid);
    return null;
  }

  return { username: row.username, expiresAt: row.expires_at };
}

export function deleteSession(sid: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

export function cleanExpiredSessions(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// ==================== Settings ====================

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
  `).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}
