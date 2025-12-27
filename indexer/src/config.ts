import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  port: parseInt(process.env.PORT || '9117', 10),
  host: process.env.HOST || '0.0.0.0',

  sites: {
    wawacity: process.env.WAWACITY_URL || '',
    zonetelecharger: process.env.ZONETELECHARGER_URL || '',
    // darkiworld: process.env.DARKIWORLD_URL || '', // Disabled - not fully implemented
  },

  // darkiworldApiKey: process.env.DARKIWORLD_API_KEY || '', // Disabled
  dlprotectServiceUrl: process.env.DLPROTECT_SERVICE_URL || 'http://localhost:5000',
} as const;

export type SiteType = 'wawacity' | 'zonetelecharger';
// export type SiteType = 'wawacity' | 'zonetelecharger' | 'darkiworld'; // Darkiworld disabled

export function getSiteUrl(site: SiteType): string {
  return config.sites[site];
}

export function isSiteConfigured(site: SiteType): boolean {
  return Boolean(config.sites[site]);
}

export function isDlprotectServiceConfigured(): boolean {
  return Boolean(config.dlprotectServiceUrl);
}
