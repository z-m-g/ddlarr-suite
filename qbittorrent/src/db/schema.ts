import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const config = getConfig();
    const dataPath = config.dataPath;

    // Ensure data directory exists
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    const dbPath = path.join(dataPath, 'qbittorrent.db');
    db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Initialize schema
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  // Downloads table
  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      hash TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      original_link TEXT NOT NULL,
      debrided_link TEXT,
      save_path TEXT NOT NULL,
      total_size INTEGER DEFAULT 0,
      downloaded_size INTEGER DEFAULT 0,
      download_speed INTEGER DEFAULT 0,
      state TEXT DEFAULT 'queued',
      status_message TEXT,
      error_message TEXT,
      added_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      category TEXT,
      priority INTEGER DEFAULT 0
    )
  `);

  // Migration: Add status_message column if it doesn't exist
  try {
    db.exec(`ALTER TABLE downloads ADD COLUMN status_message TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_downloads_state ON downloads(state);
    CREATE INDEX IF NOT EXISTS idx_downloads_added ON downloads(added_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  console.log('[DB] Schema initialized');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
