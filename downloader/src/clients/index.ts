import { DownloadClient } from './base.js';
import { DownloadStationClient } from './downloadstation.js';
import { JDownloaderClient } from './jdownloader.js';
import { Aria2Client } from './aria2.js';

export const clients: DownloadClient[] = [
  new DownloadStationClient(),
  new JDownloaderClient(),
  new Aria2Client(),
];

export function getEnabledClients(): DownloadClient[] {
  return clients.filter(client => client.isEnabled());
}

export async function addDownloadToAll(url: string, filename?: string): Promise<boolean> {
  const enabledClients = getEnabledClients();

  if (enabledClients.length === 0) {
    console.warn('[Clients] No download clients enabled');
    return false;
  }

  let success = false;

  for (const client of enabledClients) {
    try {
      const result = await client.addDownload(url, filename);
      if (result) {
        console.log(`[Clients] Successfully added to ${client.name}`);
        success = true;
      }
    } catch (error) {
      console.error(`[Clients] Failed to add to ${client.name}:`, error);
    }
  }

  return success;
}

export type { DownloadClient } from './base.js';
