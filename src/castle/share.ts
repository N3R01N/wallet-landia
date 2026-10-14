/**
 * Sharing a castle: a link that opens someone's castle for a friend, read-only.
 * It carries only the wallets the owner marked public, and a name, in the URL's
 * hash (never sent to any server): `#visit=0xabc…,0xdef…&name=Ser%20Bob`.
 * A link is untrusted input: anything that is not a plain address is dropped,
 * and the name is plain text, short.
 */

const ADDRESS = /^0x[0-9a-f]{40}$/;
/** At most this many wallets in a link (a guild's towers). */
export const MAX_SHARED = 9;
const NAME_MAX = 40;

export interface SharedCastle {
  wallets: string[];
  /** The owner's name for it ('' when none was given). */
  name: string;
}

export function encodeShare(share: SharedCastle): string {
  const params = new URLSearchParams();
  params.set('visit', share.wallets.slice(0, MAX_SHARED).join(','));
  const name = cleanName(share.name);
  if (name) params.set('name', name);
  return `#${params.toString()}`;
}

/** The castle a link's hash shares, or null when it shares none. */
export function decodeShare(hash: string): SharedCastle | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = params.get('visit');
  if (raw === null) return null;
  const wallets = [...new Set(raw.split(',').map((a) => a.trim().toLowerCase()))].filter((a) => ADDRESS.test(a)).slice(0, MAX_SHARED);
  if (wallets.length === 0) return null;
  return { wallets, name: cleanName(params.get('name') ?? '') };
}

/** A name as plain, short text: no control characters, trimmed, at most NAME_MAX characters. */
function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
}
