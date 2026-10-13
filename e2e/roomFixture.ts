/** A house with every kind of thing in it: tokens, NFTs, a loan in danger, and a position with rewards to claim. */
const tok = (symbol: string, usd: number, quantity: number, iconUrl: string | null = null) => ({ id: symbol, chainId: 'ethereum', name: symbol, symbol, category: 'token', quantity, usd, tier: 1, iconUrl });
const nft = (name: string, iconUrl: string | null = null) => ({ id: name, chainId: 'ethereum', name, symbol: 'COL', category: 'nft', quantity: 1, usd: null, tier: 1, iconUrl });
const entry = (kind: string, usd: number) => ({ name: kind, symbol: 'USDC', kind, module: null, quantity: 1, usd, chainId: 'ethereum' });

export const DEMO_HOLDINGS = {
  kind: 'home' as const,
  cls: 'merchant',
  title: "Demo's home",
  tokens: [
    tok('ETH', 900, 0.4, 'https://cdn.zerion.io/0x0100546f2cd4c9d97f798ffc9755e47865ff7ee6.png'),
    tok('USDC', 300, 300, 'https://cdn.zerion.io/0x0abdace70d3790235af448c88547603b945604ea.png'),
    tok('PEPE', 5, 1000000),
    tok('AAVE', 60, 2, 'https://cdn.zerion.io/0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c.png'),
  ],
  nfts: [
    nft('Alpha #1', 'https://nft2-cdn.alchemy.com/cdn-cgi/image/width=250,height=250,fit=scale-down/eth-mainnet/c991f1f8a7e617674024b81324d050b7'),
    nft('Beta #2', 'https://nft2-cdn.alchemy.com/cdn-cgi/image/width=250,height=250,fit=scale-down/eth-mainnet/8cb7bacc04b01ac6c52b917505d41860'),
    nft('Gamma #3'),
  ],
  positions: [
    { owner: 'Demo', stash: { protocolId: 'aave', entries: [entry('deposit', 1000), entry('loan', -850)], netUsd: 150, grossUsd: 1850, tier: 1, hasRewards: false, hasDebt: true } },
    { owner: 'Demo', stash: { protocolId: 'lido', entries: [entry('staked', 400)], netUsd: 400, grossUsd: 400, tier: 1, hasRewards: true, hasDebt: false } },
  ],
};

/** The hero whose house it is (a real wallet's address, so the figure is the one the town draws). */
export const DEMO_HERO = { address: '0x8628d73d3f950abde99739ef34b6cfa10394f579', cls: 'merchant', tier: 3 };
