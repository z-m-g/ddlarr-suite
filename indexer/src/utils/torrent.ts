import * as crypto from 'crypto';

interface FakeTorrentOptions {
  name: string;
  link: string;
  size?: number;
}

/**
 * Simple bencode encoder
 * Bencode format:
 * - Strings: length:content (e.g., "4:spam")
 * - Integers: i<number>e (e.g., "i42e")
 * - Lists: l<items>e (e.g., "l4:spami42ee")
 * - Dictionaries: d<key><value>...e (keys must be strings, sorted)
 */
function bencodeEncode(data: unknown): Buffer {
  if (typeof data === 'string') {
    const buf = Buffer.from(data, 'utf8');
    return Buffer.concat([Buffer.from(`${buf.length}:`), buf] as Uint8Array[]);
  }

  if (Buffer.isBuffer(data)) {
    return Buffer.concat([Buffer.from(`${data.length}:`), data] as Uint8Array[]);
  }

  if (typeof data === 'number') {
    return Buffer.from(`i${Math.floor(data)}e`);
  }

  if (Array.isArray(data)) {
    const parts: Uint8Array[] = [Buffer.from('l')];
    for (const item of data) {
      parts.push(bencodeEncode(item));
    }
    parts.push(Buffer.from('e'));
    return Buffer.concat(parts);
  }

  if (typeof data === 'object' && data !== null) {
    const parts: Uint8Array[] = [Buffer.from('d')];
    // Keys must be sorted
    const keys = Object.keys(data as Record<string, unknown>).sort();
    for (const key of keys) {
      parts.push(bencodeEncode(key));
      parts.push(bencodeEncode((data as Record<string, unknown>)[key]));
    }
    parts.push(Buffer.from('e'));
    return Buffer.concat(parts);
  }

  throw new Error(`Cannot bencode type: ${typeof data}`);
}

/**
 * Génère un faux fichier .torrent contenant le lien DDL
 * Le lien est stocké dans:
 * - comment: pour lecture facile par un script
 * - url-list: web seed standard (certains clients le supportent)
 */
export function generateFakeTorrent(options: FakeTorrentOptions): Buffer {
  const { name, link } = options;

  // Un seul morceau factice (20 bytes SHA1)
  const pieces = crypto.createHash('sha1').update(name + link).digest();

  // Taille fixe petite pour éviter les problèmes Int32 dans les clients
  const fakeSize = 1024;

  const torrent = {
    announce: 'http://tracker.fake/announce',
    comment: link, // Le lien DDL est dans le commentaire
    'created by': 'DDL-Torznab',
    'creation date': Math.floor(Date.now() / 1000),
    info: {
      length: fakeSize,
      name: name,
      'piece length': fakeSize,
      pieces: pieces,
    },
    'url-list': link, // Web seed
  };

  return bencodeEncode(torrent);
}

/**
 * Extrait le lien DDL d'un fichier torrent factice (parse le commentaire)
 */
export function extractLinkFromTorrent(torrentData: string): string | null {
  // Simple extraction du commentaire depuis le bencode
  // Format: ...7:comment<len>:<link>...
  const match = torrentData.match(/7:comment(\d+):/);
  if (match) {
    const len = parseInt(match[1], 10);
    const start = torrentData.indexOf(match[0]) + match[0].length;
    return torrentData.slice(start, start + len);
  }
  return null;
}
