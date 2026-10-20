export interface Config {
  port: number;
  dataPath: string;
  downloadPath: string;
  tempPath: string;
  dlprotectServiceUrl: string;
  flaresolverrUrl: string;
  loadix: {
    siteUrl: string;
    apiUrl: string;
    accessToken: string;
    refreshCookie: string;
  };
  maxConcurrentDownloads: number;
  autoExtractArchive: boolean;
  autoRemoveCompletedAfter: number;  // Minutes, 0 = disabled
  debridTorrentTimeoutHours: number; // Timeout for real torrent debrid (hours)
  auth: {
    username: string;
    password: string;
  };
  debrid: {
    alldebrid: {
      enabled: boolean;
      apiKey: string;
    };
    realdebrid: {
      enabled: boolean;
      apiKey: string;
    };
    premiumize: {
      enabled: boolean;
      apiKey: string;
    };
  };
  blackhole: {
    enabled: boolean;
    path: string;
    category: string;
  };
}

let config: Config | null = null;

export function getConfig(): Config {
  if (!config) {
    config = {
      port: parseInt(process.env.PORT || '8080', 10),
      dataPath: process.env.DATA_PATH || '/data',
      downloadPath: process.env.DOWNLOAD_PATH || '/downloads',
      tempPath: process.env.TEMP_PATH || '/downloads-temp',
      dlprotectServiceUrl: process.env.DLPROTECT_SERVICE_URL || 'http://dlprotect-resolver:5000',
      flaresolverrUrl: process.env.FLARESOLVERR_URL || '',
      loadix: {
        siteUrl: (process.env.LOADIX_URL || 'https://loadix.fun').replace(/\/+$/, ''),
        apiUrl: (process.env.LOADIX_API_URL || 'https://api.loadix.fun').replace(/\/+$/, ''),
        accessToken: process.env.LOADIX_ACCESS_TOKEN || '',
        refreshCookie: process.env.LOADIX_REFRESH_COOKIE || '',
      },
      maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '3', 10),
      autoExtractArchive: process.env.AUTO_EXTRACT_ARCHIVE !== '0',  // Enabled by default
      autoRemoveCompletedAfter: parseInt(process.env.AUTO_REMOVE_COMPLETED_AFTER || '0', 10),  // Minutes, 0 = disabled
      debridTorrentTimeoutHours: parseInt(process.env.DEBRID_TORRENT_TIMEOUT || '24', 10),  // Hours, default 24h
      auth: {
        username: process.env.QB_USERNAME || 'admin',
        password: process.env.QB_PASSWORD || 'adminadmin',
      },
      debrid: {
        alldebrid: {
          enabled: process.env.ALLDEBRID_ENABLED?.toLowerCase() === 'true',
          apiKey: process.env.ALLDEBRID_API_KEY || '',
        },
        realdebrid: {
          enabled: process.env.REALDEBRID_ENABLED?.toLowerCase() === 'true',
          apiKey: process.env.REALDEBRID_API_KEY || '',
        },
        premiumize: {
          enabled: process.env.PREMIUMIZE_ENABLED?.toLowerCase() === 'true',
          apiKey: process.env.PREMIUMIZE_API_KEY || '',
        },
      },
      blackhole: {
        enabled: process.env.BLACKHOLE_ENABLED?.toLowerCase() === 'true',
        path: process.env.BLACKHOLE_PATH || '/blackhole',
        category: process.env.BLACKHOLE_CATEGORY || '',
      },
    };
  }
  return config;
}

export function reloadConfig(): void {
  config = null;
  getConfig();
}
