// Ported from wallet-landia-v3 (src/data/zerion/types.ts) on 2026-10-08.
/**
 * Hand-written types for the slice of Zerion's JSON:API responses v3 reads.
 *
 * Deliberately narrower than the full OpenAPI schema — every field here is one
 * the mappers actually consume. Fields Zerion documents as optional are optional
 * here even when they are usually present, because a missing `value` or `icon`
 * on one position must not take the city down.
 *
 * Zerion's own note: treat every id as an abstract string. Nothing in v3 parses
 * one apart.
 */

/**
 * `links` is optional here even though Zerion documents it as always present.
 *
 * These types describe *someone else's server*, so they are a claim rather than
 * a guarantee — and the cost of being wrong is asymmetric: an absent `links` on
 * a last or empty page would otherwise throw a raw `TypeError` out of the
 * middle of a load, past every bit of error classification the client does.
 */
export interface ZerionList<T> {
  links?: { self?: string; next?: string };
  data: T[];
}

export interface ZerionSingle<T> {
  links?: { self?: string };
  data: T;
}

export interface ZerionErrorBody {
  errors?: { title?: string; detail?: string }[];
}

export interface Quantity {
  int: string;
  decimals: number;
  float: number;
  numeric: string;
}

export interface Icon {
  url: string | null;
}

export interface FungibleInfo {
  id?: string;
  name: string;
  symbol: string;
  icon: Icon | null;
  flags?: { verified: boolean };
  implementations?: { chain_id?: string; address?: string | null; decimals?: number }[];
}

export interface ApplicationMetadata {
  name?: string;
  icon?: Icon;
  url?: string;
  contract_address?: string;
  method?: { id?: string; name?: string };
}

export interface ResourceRef {
  data: { type: string; id: string };
}

// --- positions -------------------------------------------------------------

/** `position_type` — how the assets are being used. `loan` is debt. */
export type PositionType =
  | 'deposit'
  | 'loan'
  | 'locked'
  | 'staked'
  | 'reward'
  | 'wallet'
  | 'investment';

export interface PositionResource {
  type: 'positions';
  id: string;
  attributes: {
    name: string;
    quantity: Quantity;
    parent?: string | null;
    protocol?: string | null;
    /** lending, liquidity_pool, staked, farming, rewards, … */
    protocol_module?: string;
    pool_address?: string;
    group_id?: string;
    position_type?: PositionType | null;
    value?: number | null;
    price?: number;
    changes?: { absolute_1d: number; percent_1d: number } | null;
    fungible_info?: FungibleInfo;
    flags?: { displayable: boolean; is_trash?: boolean };
    updated_at?: string;
    application_metadata?: ApplicationMetadata;
  };
  relationships?: {
    chain?: ResourceRef;
    fungible?: ResourceRef;
    dapp?: ResourceRef;
  };
}

// --- transactions ----------------------------------------------------------

export type OperationType =
  | 'approve'
  | 'bid'
  | 'burn'
  | 'claim'
  | 'delegate'
  | 'deploy'
  | 'deposit'
  | 'execute'
  | 'mint'
  | 'receive'
  | 'revoke'
  | 'revoke_delegation'
  | 'send'
  | 'trade'
  | 'withdraw';

export type TransferDirection = 'in' | 'out' | 'self';

export interface TransferResource {
  direction: TransferDirection;
  quantity: Quantity;
  value: number | null;
  price: number | null;
  sender: string;
  recipient: string;
  act_id?: string;
  fungible_info?: FungibleInfo;
  nft_info?: { name?: string; content?: unknown; collection_info?: { name?: string }; contract_address?: string; token_id?: string };
}

export interface TransactionResource {
  type: 'transactions';
  id: string;
  attributes: {
    operation_type: OperationType;
    hash: string;
    mined_at_block: number;
    /** ISO 8601. */
    mined_at: string;
    sent_from: string;
    sent_to: string;
    status: 'confirmed' | 'failed' | 'pending';
    nonce: number;
    fee: { value: number | null; price: number | null; quantity?: Quantity; fungible_info?: FungibleInfo | null };
    transfers: TransferResource[];
    /** `sender` here is the spender the key was handed to (observed in v4 captures). */
    approvals?: { sender?: string; act_id?: string }[];
    /** Sub-actions of a composite transaction (added in v4). Transfers point at them via `act_id`. */
    acts?: { id: string; type?: string; application_metadata?: ApplicationMetadata }[];
    flags?: { is_trash?: boolean };
    application_metadata?: ApplicationMetadata;
  };
  relationships?: {
    chain?: ResourceRef;
    dapp?: ResourceRef;
  };
}

// --- portfolio -------------------------------------------------------------

export interface PortfolioResource {
  type: 'portfolio';
  id: string;
  attributes: {
    positions_distribution_by_type?: {
      wallet: number;
      deposited: number;
      borrowed: number;
      locked: number;
      staked: number;
    };
    positions_distribution_by_chain?: Record<string, number>;
    total?: { positions: number };
    changes?: { absolute_1d: number; percent_1d: number };
  };
}

// --- chains ----------------------------------------------------------------

export interface ChainResource {
  type: 'chains';
  id: string;
  attributes: {
    name: string;
    icon?: Icon | null;
    explorer?: { name?: string; token_url_format?: string; tx_url_format?: string };
  };
}

// --- NFT positions (added in v4) --------------------------------------------

export interface NftPositionResource {
  type: 'nft_positions';
  id: string;
  attributes: {
    amount?: string;
    price?: number;
    /** Floor value of the position, in the requested currency. */
    value?: number | null;
    nft_info?: {
      contract_address: string;
      token_id: string;
      name?: string;
      interface?: 'erc721' | 'erc1155';
      flags?: { is_spam?: boolean };
      content?: { preview?: { url?: string } | null } | null;
    };
    collection_info?: { name?: string; content?: { icon?: { url?: string } | null } | null };
  };
  relationships?: { chain?: ResourceRef };
}
