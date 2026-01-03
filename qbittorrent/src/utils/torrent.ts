import * as fs from 'fs';

/**
 * Extrait le lien DDL du champ comment d'un fichier torrent
 */
export function extractLinkFromTorrent(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    return extractLinkFromTorrentBuffer(data);
  } catch (error) {
    console.error(`[Torrent] Error reading ${filePath}:`, error);
    return null;
  }
}

/**
 * Extrait le lien DDL du champ comment d'un buffer torrent
 */
export function extractLinkFromTorrentBuffer(data: Buffer): string | null {
  try {
    const content = data.toString('latin1'); // Bencode uses latin1

    // Parse comment field: 7:comment<length>:<value>
    const commentMatch = content.match(/7:comment(\d+):/);
    if (commentMatch) {
      const len = parseInt(commentMatch[1], 10);
      const start = content.indexOf(commentMatch[0]) + commentMatch[0].length;
      const link = content.slice(start, start + len);
      console.log(`[Torrent] Extracted link from comment: ${link}`);
      return link;
    }

    // Fallback: try url-list field: 8:url-list<length>:<value>
    const urlListMatch = content.match(/8:url-list(\d+):/);
    if (urlListMatch) {
      const len = parseInt(urlListMatch[1], 10);
      const start = content.indexOf(urlListMatch[0]) + urlListMatch[0].length;
      const link = content.slice(start, start + len);
      console.log(`[Torrent] Extracted link from url-list: ${link}`);
      return link;
    }

    console.warn(`[Torrent] No link found in torrent data`);
    return null;
  } catch (error) {
    console.error(`[Torrent] Error parsing torrent data:`, error);
    return null;
  }
}

/**
 * Extrait le nom du fichier du torrent
 */
export function extractNameFromTorrent(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    return extractNameFromTorrentBuffer(data);
  } catch (error) {
    console.error(`[Torrent] Error extracting name from ${filePath}:`, error);
    return null;
  }
}

/**
 * Extrait le nom du fichier d'un buffer torrent
 */
export function extractNameFromTorrentBuffer(data: Buffer): string | null {
  try {
    // Use latin1 for bencode structure parsing (to get correct byte positions)
    const content = data.toString('latin1');

    // Parse name field in info dict: 4:name<length>:<value>
    const nameMatch = content.match(/4:name(\d+):/);
    if (nameMatch) {
      const len = parseInt(nameMatch[1], 10);
      const start = content.indexOf(nameMatch[0]) + nameMatch[0].length;
      // Extract raw bytes and decode as UTF-8
      const nameBytes = data.subarray(start, start + len);
      return nameBytes.toString('utf8');
    }

    return null;
  } catch (error) {
    console.error(`[Torrent] Error extracting name from torrent data:`, error);
    return null;
  }
}

/**
 * Extrait la taille du fichier d'un buffer torrent
 */
export function extractSizeFromTorrentBuffer(data: Buffer): number | null {
  try {
    const content = data.toString('latin1');

    // Parse length field in info dict: 6:lengthi<number>e
    const lengthMatch = content.match(/6:lengthi(\d+)e/);
    if (lengthMatch) {
      return parseInt(lengthMatch[1], 10);
    }

    return null;
  } catch (error) {
    console.error(`[Torrent] Error extracting size from torrent data:`, error);
    return null;
  }
}
