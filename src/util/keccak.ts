/**
 * Keccak-256 (the Ethereum variant, pre-NIST padding), for ENS namehash.
 * BigInt lanes: slow-ish but tiny, and we hash a handful of short names.
 */

const MASK = (1n << 64n) - 1n;

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

const rotl = (x: bigint, n: number): bigint => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK);

function keccakF(s: bigint[]): void {
  const b = new Array<bigint>(25).fill(0n);
  const c = new Array<bigint>(5).fill(0n);
  for (const rc of RC) {
    for (let x = 0; x < 5; x++) c[x] = s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!;
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) s[y + x] = s[y + x]! ^ d;
    }
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(s[x + y * 5]!, ROT[x + y * 5]!);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 25; y += 5) s[y + x] = b[y + x]! ^ (~b[y + ((x + 1) % 5)]! & MASK & b[y + ((x + 2) % 5)]!);
    s[0] = s[0]! ^ rc;
  }
}

export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80;
  const s = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]!);
      s[i] = s[i]! ^ lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) out[i * 8 + k] = Number((s[i]! >> BigInt(8 * k)) & 0xffn);
  return out;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string): Uint8Array => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
};
