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

export interface PyLoadConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  useSsl: boolean;
}

export interface CurlConfig {
  enabled: boolean;
  destinationPath: string; // Download destination path
  tempPath?: string; // Temp directory for downloads in progress
}

export interface WgetConfig {
  enabled: boolean;
  destinationPath: string; // Download destination path
  tempPath?: string; // Temp directory for downloads in progress
}

// Debrid service configs
export interface AllDebridConfig {
  enabled: boolean;
  apiKey: string;
}

export interface RealDebridConfig {
  enabled: boolean;
  apiKey: string;
}

export interface PremiumizeConfig {
  enabled: boolean;
  apiKey: string;
}

export interface DebridConfig {
  alldebrid: AllDebridConfig;
  realdebrid: RealDebridConfig;
  premiumize: PremiumizeConfig;
}

export interface Config {
  blackholePath: string;
  processedPath: string; // Where to move processed torrents
  scanInterval: number; // Seconds between scans
  alldebridApiKey?: string; // DEPRECATED: Use debrid.alldebrid.apiKey instead
  dlprotectResolveAt: 'indexer' | 'downloader'; // Where to resolve dl-protect links
  debrid: DebridConfig;
  downloadStation: DownloadStationConfig;
  jdownloader: JDownloaderConfig;
  aria2: Aria2Config;
  pyload: PyLoadConfig;
  curl: CurlConfig;
  wget: WgetConfig;
}

const CONFIG_PATH = process.env.CONFIG_PATH || '/config/config.json';

const defaultConfig: Config = {
  blackholePath: process.env.BLACKHOLE_PATH || '/blackhole',
  processedPath: process.env.PROCESSED_PATH || '/blackhole/processed',
  scanInterval: parseInt(process.env.SCAN_INTERVAL || '10', 10),
  alldebridApiKey: process.env.ALLDEBRID_API_KEY || '', // DEPRECATED
  dlprotectResolveAt: (process.env.DLPROTECT_RESOLVE_AT || 'indexer') as 'indexer' | 'downloader',
  debrid: {
    alldebrid: {
      enabled: process.env.ALLDEBRID_ENABLED === 'true' || !!process.env.ALLDEBRID_API_KEY,
      apiKey: process.env.ALLDEBRID_API_KEY || '',
    },
    realdebrid: {
      enabled: process.env.REALDEBRID_ENABLED === 'true',
      apiKey: process.env.REALDEBRID_API_KEY || '',
    },
    premiumize: {
      enabled: process.env.PREMIUMIZE_ENABLED === 'true',
      apiKey: process.env.PREMIUMIZE_API_KEY || '',
    },
  },
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
  pyload: {
    enabled: process.env.PYLOAD_ENABLED === 'true',
    host: process.env.PYLOAD_HOST || 'localhost',
    port: parseInt(process.env.PYLOAD_PORT || '8000', 10),
    username: process.env.PYLOAD_USERNAME || '',
    password: process.env.PYLOAD_PASSWORD || '',
    useSsl: process.env.PYLOAD_USE_SSL === 'true',
  },
  curl: {
    enabled: process.env.CURL_ENABLED === 'true',
    destinationPath: process.env.CURL_DESTINATION || '/downloads',
    tempPath: process.env.CURL_TEMP_PATH || '/tmp',
  },
  wget: {
    enabled: process.env.WGET_ENABLED === 'true',
    destinationPath: process.env.WGET_DESTINATION || '/downloads',
    tempPath: process.env.WGET_TEMP_PATH || '/tmp',
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
      if (savedConfig.pyload?.password === '********') {
        delete savedConfig.pyload.password;
      }
      // Debrid API keys
      if (savedConfig.debrid?.alldebrid?.apiKey === '********') {
        delete savedConfig.debrid.alldebrid.apiKey;
      }
      if (savedConfig.debrid?.realdebrid?.apiKey === '********') {
        delete savedConfig.debrid.realdebrid.apiKey;
      }
      if (savedConfig.debrid?.premiumize?.apiKey === '********') {
        delete savedConfig.debrid.premiumize.apiKey;
      }

      // Deep merge for nested objects
      // Note: dlprotectResolveAt always comes from env var, never from saved config
      currentConfig = {
        ...defaultConfig,
        ...savedConfig,
        dlprotectResolveAt: defaultConfig.dlprotectResolveAt, // Always use env var
        debrid: {
          alldebrid: { ...defaultConfig.debrid.alldebrid, ...savedConfig.debrid?.alldebrid },
          realdebrid: { ...defaultConfig.debrid.realdebrid, ...savedConfig.debrid?.realdebrid },
          premiumize: { ...defaultConfig.debrid.premiumize, ...savedConfig.debrid?.premiumize },
        },
        downloadStation: { ...defaultConfig.downloadStation, ...savedConfig.downloadStation },
        jdownloader: { ...defaultConfig.jdownloader, ...savedConfig.jdownloader },
        aria2: { ...defaultConfig.aria2, ...savedConfig.aria2 },
        pyload: { ...defaultConfig.pyload, ...savedConfig.pyload },
        curl: { ...defaultConfig.curl, ...savedConfig.curl },
        wget: { ...defaultConfig.wget, ...savedConfig.wget },
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
    // Don't save dlprotectResolveAt - it always comes from env var
    const { dlprotectResolveAt, ...configToSave } = config;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToSave, null, 2));
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
