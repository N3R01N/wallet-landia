/**
 * Classification of assets and protocols into world categories.
 *
 * These are heuristics over symbols and names, because Zerion does not label a
 * token "stablecoin" or a dApp "lending". Anything unmatched falls through to a
 * generic category and still gets drawn (principle 3: everything has a fallback).
 */

export type AssetCategory =
  | 'native'
  | 'stable'
  | 'wrapped'
  | 'governance'
  | 'meme'
  | 'lst'
  | 'receipt'
  | 'debt'
  | 'token'
  | 'nft';

export type ProtocolCategory =
  | 'dex'
  | 'aggregator'
  | 'lending'
  | 'staking'
  | 'restaking'
  | 'yield'
  | 'nft-market'
  | 'bridge'
  | 'governance'
  | 'names'
  | 'wrapper'
  | 'mint'
  | 'airdrop'
  | 'unknown';

/** World building for each protocol category (World Bible §3). */
export type BuildingKind =
  | 'bazaar'
  | 'broker'
  | 'bank'
  | 'temple'
  | 'barracks'
  | 'alchemist'
  | 'auction'
  | 'harbour'
  | 'council'
  | 'names'
  | 'packing'
  | 'forge'
  | 'herald'
  | 'tent';

export const BUILDING_FOR: Record<ProtocolCategory, BuildingKind> = {
  dex: 'bazaar',
  aggregator: 'broker',
  lending: 'bank',
  staking: 'temple',
  restaking: 'barracks',
  yield: 'alchemist',
  'nft-market': 'auction',
  bridge: 'harbour',
  governance: 'council',
  names: 'names',
  wrapper: 'packing',
  mint: 'forge',
  airdrop: 'herald',
  unknown: 'tent',
};

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  bazaar: 'Bazaar',
  broker: "Broker's Office",
  bank: 'Counting House',
  temple: 'Temple',
  barracks: 'Paladin Barracks',
  alchemist: "Alchemist's Tower",
  auction: 'Auction House',
  harbour: 'Harbour',
  council: 'Council Hall',
  names: 'Hall of Names',
  packing: 'Packing House',
  forge: 'Forge',
  herald: "Herald's Cart",
  tent: 'Mysterious Tent',
};

export const CATEGORY_LABEL: Record<ProtocolCategory, string> = {
  dex: 'exchange (DEX)',
  aggregator: 'swap aggregator',
  lending: 'lending protocol',
  staking: 'staking protocol',
  restaking: 'restaking protocol',
  yield: 'yield vault',
  'nft-market': 'NFT marketplace',
  bridge: 'bridge',
  governance: 'governance',
  names: 'naming service',
  wrapper: 'token wrapper',
  mint: 'mint contract',
  airdrop: 'airdrop distributor',
  unknown: 'unrecognised contract',
};

const STABLES = new Set([
  'USDC', 'USDT', 'DAI', 'USDS', 'FRAX', 'LUSD', 'PYUSD', 'GHO', 'CRVUSD', 'USDE', 'SUSDE', 'TUSD',
  'USDP', 'BUSD', 'GUSD', 'FDUSD', 'RLUSD', 'USD0', 'DOLA', 'EURC', 'EURS', 'SDAI', 'USDBC',
]);
const WRAPPED = new Set(['WETH', 'WBTC', 'CBBTC', 'TBTC', 'RENBTC', 'HBTC', 'WSOL', 'WMATIC', 'WPOL']);
const LSTS = new Set([
  'STETH', 'WSTETH', 'RETH', 'CBETH', 'WEETH', 'EETH', 'EZETH', 'RSETH', 'METH', 'SFRXETH', 'FRXETH',
  'OSETH', 'ETHX', 'SWETH', 'ANKRETH', 'PUFETH', 'LSETH', 'OETH',
]);
const GOVERNANCE = new Set([
  'UNI', 'AAVE', 'COMP', 'MKR', 'SKY', 'CRV', 'CVX', 'LDO', 'ENS', 'ARB', 'OP', 'SNX', 'BAL', 'SUSHI',
  '1INCH', 'YFI', 'RPL', 'PENDLE', 'EIGEN', 'LINK', 'GRT', 'FXS', 'ENA', 'ETHFI', 'SAFE', 'COW', 'MORPHO',
  'GNO', 'LQTY', 'APE', 'BLUR', 'IMX', 'DYDX', 'MATIC', 'POL',
]);
const MEMES = new Set([
  'PEPE', 'SHIB', 'DOGE', 'WIF', 'BONK', 'FLOKI', 'MOG', 'SPX', 'TURBO', 'BRETT', 'NEIRO', 'MEME',
  'LADYS', 'WOJAK', 'ANDY', 'TRUMP', 'PNUT', 'POPCAT', 'HOSKY', 'ELON', 'KISHU', 'BITCOIN',
]);

export function classifyAsset(symbol: string, name: string, chainId: string | null, isNative: boolean): AssetCategory {
  const s = symbol.toUpperCase();
  if (isNative) return 'native';
  if (/debt/i.test(symbol) || /debt/i.test(name)) return 'debt';
  if (STABLES.has(s)) return 'stable';
  if (WRAPPED.has(s)) return 'wrapped';
  if (LSTS.has(s)) return 'lst';
  if (GOVERNANCE.has(s)) return 'governance';
  if (MEMES.has(s)) return 'meme';
  // Receipts: Aave aTokens (aEthUSDC), Compound cTokens, Yearn yv*, LP tokens.
  if (/^a(eth|arb|opt|bas|pol)?[A-Z]/.test(symbol) && /aave/i.test(name)) return 'receipt';
  if (/^(c|yv|cv|st|sd|pt-|yt-)[A-Z]/.test(symbol) || /(-LP|LP$|UNI-V\d|SLP|BPT)/i.test(symbol)) return 'receipt';
  if (/vault|pool|position|staked/i.test(name)) return 'receipt';
  void chainId;
  return 'token';
}

/** Ordered: first match wins, so specific names come before generic ones. */
const PROTOCOL_RULES: [RegExp, ProtocolCategory][] = [
  [/eigen|symbiotic|karak|ether\.?fi|renzo|kelp|puffer|swell|mellow/i, 'restaking'],
  [/lido|rocket ?pool|stakewise|frax ?ether|coinbase.*stak|stader|ankr|liquid collective|beacon/i, 'staking'],
  [/aave|compound|morpho|spark|euler|fluid|maker|sky|liquity|radiant|venus|silo|notional|gearbox/i, 'lending'],
  [/1inch|cow ?swap|cow protocol|0x|matcha|paraswap|kyber|odos|openocean|metamask swap|zerion|rainbow|bebop|uniswapx/i, 'aggregator'],
  [/uniswap|curve|balancer|sushi|pancake|maverick|velodrome|aerodrome|bancor|dodo|ekubo|etherdelta|mooniswap/i, 'dex'],
  [/permit2/i, 'aggregator'],
  [/yearn|pendle|convex|beefy|sommelier|idle|harvest|ethena|yield|vault|stakedao|stake dao|origin|tokemak|alchemix/i, 'yield'],
  [/opensea|blur|magic ?eden|looksrare|rarible|zora|x2y2|foundation|sudoswap|tensor|seaport/i, 'nft-market'],
  [/bridge|hop|across|stargate|orbiter|relay|li\.?fi|socket|synapse|wormhole|layerzero|celer|connext|portal|gateway/i, 'bridge'],
  [/\bens\b|ethereum name service/i, 'names'],
  [/snapshot|tally|governor|governance|dao/i, 'governance'],
  [/weth|wrapped ether/i, 'wrapper'],
  [/airdrop|claim|merkle|distributor/i, 'airdrop'],
  [/mint|zora|manifold|seadrop|nft/i, 'mint'],
];

const MODULE_CATEGORY: Record<string, ProtocolCategory> = {
  lending: 'lending',
  liquidity_pool: 'dex',
  staked: 'staking',
  farming: 'yield',
  leveraged_farming: 'yield',
  yield: 'yield',
  locked: 'governance',
  vesting: 'yield',
  nft_staked: 'yield',
  investment: 'yield',
};

export function classifyProtocol(id: string, name: string, modules: readonly string[] = []): ProtocolCategory {
  const text = `${id} ${name}`;
  for (const [pattern, category] of PROTOCOL_RULES) if (pattern.test(text)) return category;
  for (const m of modules) {
    const c = MODULE_CATEGORY[m];
    if (c !== undefined) return c;
  }
  return 'unknown';
}

/**
 * A few well-known contracts that Zerion does not attach a dApp to. Small on
 * purpose: the long tail is handled by naming contracts after their token.
 */
export const KNOWN_CONTRACTS: Record<string, { id: string; name: string; category: ProtocolCategory }> = {
  '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb': { id: 'cryptopunks', name: 'CryptoPunks Market', category: 'nft-market' },
  '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85': { id: 'ens', name: 'ENS', category: 'names' },
  '0x253553366da8546fc250f225fe3d25d0c782303b': { id: 'ens', name: 'ENS', category: 'names' },
  '0x283af0b28c62c092c9727f1ee09c02ca627eb7f5': { id: 'ens', name: 'ENS', category: 'names' },
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': { id: 'opensea', name: 'OpenSea', category: 'nft-market' },
  '0x0000000000000068f116a894984e2db1123eb395': { id: 'opensea', name: 'OpenSea', category: 'nft-market' },
  '0x000000000022d473030f116ddee9f6b43ac78ba3': { id: 'permit2', name: 'Permit2 (key office)', category: 'aggregator' },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { id: 'uniswap', name: 'Uniswap', category: 'dex' },
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af': { id: 'uniswap', name: 'Uniswap', category: 'dex' },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { id: 'uniswap', name: 'Uniswap', category: 'dex' },
  '0x111111125421ca6dc452d289314280a0f8842a65': { id: '1inch', name: '1inch', category: 'aggregator' },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { id: '1inch', name: '1inch', category: 'aggregator' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { id: 'weth', name: 'WETH', category: 'wrapper' },
  // Gondi NFT lending (MultiSourceLoan). Zerion files its loans as plain sends.
  '0xf41b389e0c1950dc0b16c9498eae77131cc08a56': { id: 'gondi', name: 'Gondi', category: 'lending' },
};

/**
 * Contracts that only relay transfers (batch senders, transfer helpers). A send
 * through one of these is still person-to-person, not a visit to a place.
 */
export const PASS_THROUGH = new Set([
  '0x0000000000c2d145a2526bd8c716263bfebe1a72', // OpenSea TransferHelper
  '0xd152f549545093347a162dce210e7293f1452150', // Disperse.app
  '0x40a2accbd92bca938b02010e17a5b8929b49130d', // Gnosis Safe MultiSendCallOnly
  '0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761', // Gnosis Safe MultiSend
]);
