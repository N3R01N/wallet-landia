/** A house with every kind of thing in it: tokens, NFTs, a loan in danger, and a position with rewards to claim. */
const tok = (symbol: string, usd: number, quantity: number) => ({ id: symbol, chainId: 'ethereum', name: symbol, symbol, category: 'token', quantity, usd, tier: 1, iconUrl: null });
const nft = (name: string) => ({ id: name, chainId: 'ethereum', name, symbol: 'COL', category: 'nft', quantity: 1, usd: null, tier: 1, iconUrl: null });
const entry = (kind: string, usd: number) => ({ name: kind, symbol: 'USDC', kind, module: null, quantity: 1, usd, chainId: 'ethereum' });

export const DEMO_HOLDINGS = {
  kind: 'home' as const,
  cls: 'merchant',
  title: "Demo's home",
  tokens: [tok('ETH', 900, 0.4), tok('USDC', 300, 300), tok('PEPE', 5, 1000000), tok('AAVE', 60, 2)],
  nfts: [nft('Alpha #1'), nft('Beta #2'), nft('Gamma #3')],
  positions: [
    { owner: 'Demo', stash: { protocolId: 'aave', entries: [entry('deposit', 1000), entry('loan', -850)], netUsd: 150, grossUsd: 1850, tier: 1, hasRewards: false, hasDebt: true } },
    { owner: 'Demo', stash: { protocolId: 'lido', entries: [entry('staked', 400)], netUsd: 400, grossUsd: 400, tier: 1, hasRewards: true, hasDebt: false } },
  ],
};

/** The hero whose house it is (a real wallet's address, so the figure is the one the town draws). */
export const DEMO_HERO = { address: '0x8628d73d3f950abde99739ef34b6cfa10394f579', cls: 'merchant', tier: 3 };
