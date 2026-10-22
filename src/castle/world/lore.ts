/**
 * What the townsfolk know of their trade's history: a few short, true lines
 * for each signature protocol and each kind of building. Only well-known,
 * lasting facts (no figures that go stale). A building's person, tapped, says
 * one now and then instead of the chatter (chatter.ts), never the same twice running.
 */

import { protocolFamily } from '../assets/manifest.js';

/** By protocol family (manifest SIGNATURE_PROTOCOLS). */
export const PROTOCOL_LORE: Record<string, readonly string[]> = {
  aave: ['Aave started out as ETHLend, ser', '“Aave” is Finnish for ghost', 'flash loans: borrowed and repaid in one transaction'],
  compound: ['COMP rewards set off the yield farming summer of 2020', 'at Compound, rates follow supply and demand', 'Compound pools every lender together'],
  maker: ['Maker made DAI, a dollar backed by crypto', 'lock collateral in a vault, mint DAI against it', 'Maker has taken a new name: Sky'],
  uniswap: ['Uniswap opened in 2018', 'no order book here: you swap against a pool', 'in 2020 early users got UNI out of the blue'],
  curve: ['Curve was made for swapping like for like', 'lock CRV for veCRV and you get a vote', 'they called it the Curve wars, the fight over its rewards'],
  lido: ['stake ETH here, carry stETH away', 'stETH grows as the staking rewards come in', 'Lido opened in December 2020, soon after the Beacon Chain began'],
  'rocket-pool': ['rETH is staked ETH you can carry about', 'run a Rocket Pool node with less than 32 ETH', 'many node operators here, not one company'],
  eigenlayer: ['restake your ETH to guard more than Ethereum', 'restaking: the same stake, more duties, more risk'],
  opensea: ['OpenSea: the big NFT bazaar', 'Seaport is the protocol under OpenSea’s stalls', 'check the collection before you buy, ser'],
  ens: ['ENS turns long addresses into names like vitalik.eth', 'ENS has been naming addresses since 2017', 'the ENS token was airdropped in November 2021'],
  morpho: ['Morpho began by improving rates on Aave and Compound', 'Morpho Blue: small markets, each kept apart', 'curators look after Morpho’s vaults'],
  spark: ['Spark grew out of the Maker family', 'sDAI earns the DAI Savings Rate'],
  fluid: ['Fluid comes from the Instadapp team', 'at Fluid, lending and swaps share one pool of liquidity'],
  gondi: ['Gondi lends against NFTs, person to person', 'lend your ETH, hold an NFT until the loan is repaid'],
  pendle: ['Pendle splits a yield from its principal: PT and YT', 'fix your yield here, or trade on where it goes'],
  yearn: ['Andre Cronje started Yearn', 'YFI launched in 2020 with no premine', 'Yearn’s vaults put your coins to work through strategies'],
  balancer: ['a Balancer pool can hold many tokens, in any weights', 'a pool here is like an index fund that pays you fees'],
  sushiswap: ['SushiSwap began in 2020 as a fork of Uniswap', 'they called it a vampire attack: Sushi lured Uniswap’s liquidity'],
  '1inch': ['1inch splits your swap over many exchanges', '1inch was born at a hackathon in 2019'],
  cow: ['CoW means Coincidence of Wants', 'at CoW Swap, solvers compete to settle your order', 'batch auctions help keep the sandwich bots away'],
  blur: ['Blur: an NFT market made for traders', 'the BLUR airdrop came in February 2023', 'Blend is Blur’s NFT lending'],
  across: ['Across is quick: relayers front you the funds', 'UMA’s optimistic oracle keeps Across honest'],
  ethena: ['USDe is a synthetic dollar', 'USDe holds staked ETH and a short against it, to stay level', 'sUSDe earns from funding rates'],
  convex: ['Convex boosts your Curve rewards without locking CRV yourself', 'Convex holds a great pile of veCRV'],
  frax: ['Frax began as a stablecoin only partly backed by collateral', 'frxETH is Frax’s staked ETH'],
  euler: ['Euler lends and borrows a great many kinds of token', 'Euler came back as v2 in 2024'],
  stargate: ['Stargate is built on LayerZero', 'Stargate moves native coins across chains from shared pools'],
  zora: ['Zora: mint art and moments onchain', 'Zora runs its own Layer 2'],
  safe: ['Safe used to be called Gnosis Safe', 'a Safe wants several keys to sign: two of three, say', 'many DAOs keep their treasuries in a Safe'],
  paraswap: ['ParaSwap searches many markets for your best swap', 'ParaSwap gathers prices from all over town'],
  kyber: ['Kyber has been swapping since the early days', 'KyberSwap gathers liquidity from many exchanges'],
  lifi: ['LI.FI finds you a route across bridges and exchanges', 'many wallets use LI.FI under the hood'],
};

/** By building category (world.ts BuildingCategory). */
export const CATEGORY_LORE: Record<string, readonly string[]> = {
  lending: ['borrowers here put up more than they take', 'let your collateral fall too far and it is liquidated', 'a loan here never asks your name'],
  dex: ['no shopkeeper here: a pool of tokens sets the price', 'the bigger the trade, the more the price slips', 'liquidity providers earn a cut of every swap'],
  staking: ['since the Merge, staked ETH keeps Ethereum running', '32 ETH runs a validator of your own', 'unstaking waits its turn in a queue'],
  nft: ['an NFT is a token like no other', 'the picture often lives off the chain; the token is the deed', 'one of a kind, ser, that is the point'],
  governance: ['holders vote on the proposals', 'you can hand your votes to someone you trust', 'a DAO is a guild run by its members’ votes'],
  bridge: ['a bridge locks coins on one side, frees them on the other', 'Layer 2s settle back to Ethereum', 'mind which chain you are on, ser'],
  other: ['Ethereum went live in July 2015', 'every transaction is written on the chain for good', 'the Merge moved Ethereum to proof of stake in 2022'],
};

/** How often a tapped building's person tells lore rather than chatter. */
export const LORE_SHARE = 0.25;

/** The lore a protocol's person knows: its own, else its kind of building's (none: nothing to tell). */
export function loreFor(protocolId: string | null | undefined, trade: string): readonly string[] {
  const own = protocolId ? PROTOCOL_LORE[protocolFamily(protocolId)] : undefined;
  return own ?? CATEGORY_LORE[trade] ?? [];
}

/** A line by a roll (0…1), never `last` when there is another. */
export function pickLore(lines: readonly string[], roll: number, last: string | null): string | null {
  const choice = lines.length > 1 ? lines.filter((l) => l !== last) : lines;
  if (choice.length === 0) return null;
  return choice[Math.min(choice.length - 1, Math.floor(roll * choice.length))]!;
}

/** Who tells: a building's person (its protocol) or someone of a trade. */
export interface Teller {
  trade: string;
  protocolId?: string;
}

/** The town's storyteller: one tapped line in four is lore, never the same lore line twice in a row. */
export class Storyteller {
  #last: string | null = null;

  say(who: Teller, tapped: boolean, chatter: () => string, roll = Math.random(), pick = Math.random()): string {
    if (tapped && who.protocolId && roll < LORE_SHARE) {
      const line = pickLore(loreFor(who.protocolId, who.trade), pick, this.#last);
      if (line) return (this.#last = line);
    }
    return chatter();
  }
}
