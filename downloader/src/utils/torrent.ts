import * as fs from 'fs';

/**
 * Extrait le lien DDL du champ comment d'un fichier torrent
 */
export function extractLinkFromTorrent(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    const content = data.toString('latin1'); // Bencode uses latin1

    // Parse comment field: 7:comment<length>:<value>
    const commentMatch = content.match(/7:comment(\d+):/);
    if (commentMatch) {
      const len = parseInt(commentMatch[1], 10);
      const start = content.indexOf(commentMatch[0]) + commentMatch[0].length;
      const link = content.slice(start, start + len);
      console.log(`[Torrent] Extracted link from ${filePath}: ${link}`);
      return link;
    }

    // Fallback: try url-list field: 8:url-list<length>:<value>
    const urlListMatch = content.match(/8:url-list(\d+):/);
    if (urlListMatch) {
      const len = parseInt(urlListMatch[1], 10);
      const start = content.indexOf(urlListMatch[0]) + urlListMatch[0].length;
      const link = content.slice(start, start + len);
      console.log(`[Torrent] Extracted link from url-list in ${filePath}: ${link}`);
      return link;
    }

    console.warn(`[Torrent] No link found in ${filePath}`);
    return null;
  } catch (error) {
    console.error(`[Torrent] Error reading ${filePath}:`, error);
    return null;
  }
}

/**
 * Extrait le nom du fichier du torrent
 */
export function extractNameFromTorrent(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    const content = data.toString('latin1');

    // Parse name field in info dict: 4:name<length>:<value>
    const nameMatch = content.match(/4:name(\d+):/);
    if (nameMatch) {
      const len = parseInt(nameMatch[1], 10);
      const start = content.indexOf(nameMatch[0]) + nameMatch[0].length;
      return content.slice(start, start + len);
    }

    return null;
  } catch (error) {
    console.error(`[Torrent] Error extracting name from ${filePath}:`, error);
    return null;
  }
}
