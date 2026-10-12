/** Small facts about a Zerion transaction, shared by the ledger, the town's history and the mapper. */

import type { TransactionResource } from './types.js';

/** One key per transaction (`chain:hash`), the same everywhere it is matched. */
export const txKey = (t: TransactionResource): string => (t.attributes.hash === '' ? t.id : `${t.relationships?.chain?.data.id ?? '?'}:${t.attributes.hash}`);
/** Mined time in ms (0 when unreadable, so sorts stay sane). */
export const minedAt = (t: TransactionResource): number => Date.parse(t.attributes.mined_at) || 0;
/** Zerion's trash flag: kept in the ledger, kept out of the town and the player. */
export const isSpam = (t: TransactionResource): boolean => t.attributes.flags?.is_trash === true;
