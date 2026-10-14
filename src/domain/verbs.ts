/**
 * Words for transactions, shared by every view: what each kind of journey
 * means on-chain (for newcomers), and where to see a transaction on a block
 * explorer, by chain.
 */

import type { Verb } from './model.js';

export const EXPLORERS: Record<string, string> = {
  ethereum: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  arbitrum: 'https://arbiscan.io/tx/',
  optimism: 'https://optimistic.etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
};

/** One line for newcomers: what this kind of journey means on-chain. */
export const VERB_EXPLAIN: Partial<Record<Verb, string>> = {
  send: 'Sent tokens to another address.',
  receive: 'Tokens arrived from another address.',
  swap: 'Traded one token for another at an exchange.',
  addLiquidity: 'Added a pair of tokens to a liquidity pool, earning a share of trading fees.',
  removeLiquidity: 'Took tokens back out of a liquidity pool.',
  stake: 'Locked tokens to help secure a network (or a protocol) in exchange for rewards.',
  unstake: 'Asked for staked tokens back.',
  supply: 'Deposited tokens into a lending protocol, where they can earn interest and serve as collateral.',
  withdraw: 'Took deposited tokens back out of a protocol.',
  borrow: 'Borrowed against collateral. The debt must be repaid, or the collateral can be liquidated.',
  repay: 'Paid back (part of) a loan.',
  liquidated: 'The loan became too risky, so someone else repaid it and took collateral as a reward.',
  claim: 'Collected rewards that had built up.',
  approve: 'Allowed a contract to move one of your tokens. Unlimited approvals stay open until revoked.',
  revoke: 'Took back a contract’s permission to move your tokens.',
  wrap: 'Turned ETH into WETH, the token form of ETH that contracts can handle.',
  unwrap: 'Turned WETH back into plain ETH.',
  mint: 'Created new tokens or NFTs.',
  burn: 'Destroyed tokens or NFTs.',
  buyNft: 'Bought an NFT at a marketplace.',
  sellNft: 'Sold an NFT at a marketplace.',
  bid: 'Placed a bid or listing; nothing moves until someone takes it.',
  bridge: 'Moved assets between chains through a bridge.',
  delegate: 'Gave someone else your voting power.',
  deploy: 'Put a new smart contract on the chain.',
  airdrop: 'Received free tokens from a project.',
  deposit: 'Put tokens into a protocol.',
  lend: 'Lent funds to a borrower through a lending protocol; they repay with interest.',
  loanRepaid: 'A borrower repaid a loan you made, with interest.',
  unknown: 'A contract call the town could not decode. The explorer link shows exactly what happened.',
};
