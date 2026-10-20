/** Minimal bencode encoder for building torrent fixtures in tests */
export function bencode(data: unknown): Buffer {
  if (typeof data === 'string') {
    const buf = Buffer.from(data, 'utf8');
    return Buffer.concat([Buffer.from(`${buf.length}:`), buf]);
  }
  if (Buffer.isBuffer(data)) {
    return Buffer.concat([Buffer.from(`${data.length}:`), data]);
  }
  if (typeof data === 'number') {
    return Buffer.from(`i${Math.floor(data)}e`);
  }
  if (Array.isArray(data)) {
    return Buffer.concat([Buffer.from('l'), ...data.map(bencode), Buffer.from('e')]);
  }
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>;
    const parts = Object.keys(record).sort().flatMap(key => [bencode(key), bencode(record[key])]);
    return Buffer.concat([Buffer.from('d'), ...parts, Buffer.from('e')]);
  }
  throw new Error(`cannot bencode ${typeof data}`);
}
