/**
 * ENS over the public RPC: name → address, and address → primary name
 * (verified forward, as ENS requires). Plain eth_call, no library.
 */

import { fromHex, keccak256, toHex } from '../util/keccak.js';
import { rpcCall } from './rpc.js';

const REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
const SEL_RESOLVER = '0178b8bf'; // resolver(bytes32)
const SEL_ADDR = '3b3b57de'; // addr(bytes32)
const SEL_NAME = '691f3431'; // name(bytes32)

/** ENSIP-1 namehash. Normalisation here is lowercase only, enough for ordinary names. */
export function namehash(name: string): string {
  let node: Uint8Array = new Uint8Array(32);
  const labels = name.toLowerCase().trim().split('.').filter((l) => l !== '');
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = keccak256(new TextEncoder().encode(labels[i]));
    const joined = new Uint8Array(64);
    joined.set(node);
    joined.set(label, 32);
    node = keccak256(joined);
  }
  return `0x${toHex(node)}`;
}

export function isEnsName(input: string): boolean {
  return /^[^\s.]+(\.[^\s.]+)+$/.test(input.trim()) && !/^0x[0-9a-f]{40}$/i.test(input.trim());
}

async function call(to: string, data: string): Promise<string> {
  return rpcCall<string>('eth_call', [{ to, data }, 'latest']);
}

const addrFromWord = (word: string): string => `0x${word.slice(-40)}`.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';

async function resolverOf(node: string): Promise<string | null> {
  const r = await call(REGISTRY, `0x${SEL_RESOLVER}${node.slice(2)}`);
  const a = addrFromWord(r);
  return a === ZERO ? null : a;
}

export async function resolveName(name: string): Promise<string | null> {
  const node = namehash(name);
  const resolver = await resolverOf(node);
  if (resolver === null) return null;
  const a = addrFromWord(await call(resolver, `0x${SEL_ADDR}${node.slice(2)}`));
  return a === ZERO ? null : a;
}

function decodeString(hex: string): string {
  const b = fromHex(hex);
  if (b.length < 64) return '';
  const offset = Number(BigInt(`0x${toHex(b.slice(24, 32))}`));
  const len = Number(BigInt(`0x${toHex(b.slice(offset + 24, offset + 32))}`));
  return new TextDecoder().decode(b.slice(offset + 32, offset + 32 + len));
}

/** The address's primary ENS name, only if it resolves back to the address. */
export async function reverseName(address: string): Promise<string | null> {
  const node = namehash(`${address.toLowerCase().slice(2)}.addr.reverse`);
  const resolver = await resolverOf(node);
  if (resolver === null) return null;
  const name = decodeString(await call(resolver, `0x${SEL_NAME}${node.slice(2)}`));
  if (name === '') return null;
  const forward = await resolveName(name);
  return forward === address.toLowerCase() ? name : null;
}
