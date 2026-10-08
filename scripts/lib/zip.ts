/** A tiny zip reader (central directory + inflateRaw), so scripts need no unzip tool. */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';


export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

export function readZip(path: string | Buffer): { entries: Map<string, ZipEntry>; data: Buffer } {
  const data = typeof path === 'string' ? readFileSync(path) : path;
  let eocd = data.length - 22;
  while (eocd >= 0 && data.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`not a zip: ${path}`);
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = data.readUInt16LE(p + 10);
    const compressedSize = data.readUInt32LE(p + 20);
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const localOffset = data.readUInt32LE(p + 42);
    const name = data.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, data };
}

export function unzipEntry(zip: { data: Buffer }, e: ZipEntry): Buffer {
  const d = zip.data;
  const nameLen = d.readUInt16LE(e.localOffset + 26);
  const extraLen = d.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = d.subarray(start, start + e.compressedSize);
  return e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}

