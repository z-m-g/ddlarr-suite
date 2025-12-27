import * as fs from 'fs';
import * as path from 'path';

export interface DownloadStationConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  useSsl: boolean;
  destination?: string; // Destination folder on NAS
}

export interface JDownloaderConfig {
  enabled: boolean;
  // API mode: 'local' = only local, 'remote' = only MyJDownloader, 'auto' = try both (local first)
  apiMode: 'local' | 'remote' | 'auto';
  // MyJDownloader API
  email?: string;
  password?: string;
  deviceName?: string;
  // Local API (if running on same network)
  localHost?: string;
  localPort?: number;
}

export interface Aria2Config {
  enabled: boolean;
  host: string;
  port: number;
  secret?: string;
  dir?: string; // Download directory
}

export interface Config {
  blackholePath: string;
  processedPath: string; // Where to move processed torrents
  scanInterval: number; // Seconds between scans
  alldebridApiKey?: string; // AllDebrid API key for debriding links
  downloadStation: DownloadStationConfig;
  jdownloader: JDownloaderConfig;
  aria2: Aria2Config;
}

const CONFIG_PATH = process.env.CONFIG_PATH || '/config/config.json';

const defaultConfig: Config = {
  blackholePath: process.env.BLACKHOLE_PATH || '/blackhole',
  processedPath: process.env.PROCESSED_PATH || '/blackhole/processed',
  scanInterval: parseInt(process.env.SCAN_INTERVAL || '10', 10),
  alldebridApiKey: process.env.ALLDEBRID_API_KEY || '',
  downloadStation: {
    enabled: process.env.DS_ENABLED === 'true',
    host: process.env.DS_HOST || '',
    port: parseInt(process.env.DS_PORT || '5000', 10),
    username: process.env.DS_USERNAME || '',
    password: process.env.DS_PASSWORD || '',
    useSsl: process.env.DS_USE_SSL === 'true',
    destination: process.env.DS_DESTINATION || '',
  },
  jdownloader: {
    enabled: process.env.JD_ENABLED === 'true',
    apiMode: (process.env.JD_API_MODE as 'local' | 'remote' | 'auto') || 'auto',
    email: process.env.JD_EMAIL || '',
    password: process.env.JD_PASSWORD || '',
    deviceName: process.env.JD_DEVICE || '',
    localHost: process.env.JD_LOCAL_HOST || '',
    localPort: parseInt(process.env.JD_LOCAL_PORT || '3128', 10),
  },
  aria2: {
    enabled: process.env.ARIA2_ENABLED === 'true',
    host: process.env.ARIA2_HOST || 'localhost',
    port: parseInt(process.env.ARIA2_PORT || '6800', 10),
    secret: process.env.ARIA2_SECRET || '',
    dir: process.env.ARIA2_DIR || '',
  },
};

let currentConfig: Config = { ...defaultConfig };

export function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const savedConfig = JSON.parse(data);

      // Don't use masked values (********) from saved config - use env var instead
      if (savedConfig.alldebridApiKey === '********') {
        delete savedConfig.alldebridApiKey;
      }
      if (savedConfig.downloadStation?.password === '********') {
        delete savedConfig.downloadStation.password;
      }
      if (savedConfig.jdownloader?.password === '********') {
        delete savedConfig.jdownloader.password;
      }
      if (savedConfig.aria2?.secret === '********') {
        delete savedConfig.aria2.secret;
      }

      // Deep merge for nested objects
      currentConfig = {
        ...defaultConfig,
        ...savedConfig,
        downloadStation: { ...defaultConfig.downloadStation, ...savedConfig.downloadStation },
        jdownloader: { ...defaultConfig.jdownloader, ...savedConfig.jdownloader },
        aria2: { ...defaultConfig.aria2, ...savedConfig.aria2 },
      };
      console.log('[Config] Loaded from file:', CONFIG_PATH);
    } else {
      // Use defaults (including env vars)
      currentConfig = { ...defaultConfig };
      console.log('[Config] Using defaults/environment variables');
    }
  } catch (error) {
    console.error('[Config] Error loading config:', error);
    currentConfig = { ...defaultConfig };
  }
  return currentConfig;
}

export function saveConfig(config: Config): void {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    currentConfig = config;
    console.log('[Config] Saved to file:', CONFIG_PATH);
  } catch (error) {
    console.error('[Config] Error saving config:', error);
    throw error;
  }
}

export function getConfig(): Config {
  return currentConfig;
}
