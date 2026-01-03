export interface Config {
  port: number;
  dataPath: string;
  downloadPath: string;
  tempPath: string;
  dlprotectServiceUrl: string;
  maxConcurrentDownloads: number;
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
      maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '3', 10),
      auth: {
        username: process.env.QB_USERNAME || 'admin',
        password: process.env.QB_PASSWORD || 'adminadmin',
      },
      debrid: {
        alldebrid: {
          enabled: process.env.ALLDEBRID_ENABLED === 'true',
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
    };
  }
  return config;
}

export function reloadConfig(): void {
  config = null;
  getConfig();
}
