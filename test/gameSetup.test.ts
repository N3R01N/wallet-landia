import { describe, expect, it } from 'vitest';
import type { Hero, Item, Protocol } from '../src/domain/model.js';
import { BALANCE } from '../src/game/config/balance.js';
import { qn } from '../src/game/core/fixed.js';
import { Match } from '../src/game/core/match.js';
import { importWallet, nftCollectionKey } from '../src/game/data/walletImporter.js';
import { addDollars, addNft, blankDraft, draftValue, importDraft, opponentPortfolio, preview, room, setDollars, templateDraft } from '../src/game/setup/editor.js';
import { decodeDraft, deleteLoadout, encodeDraft, listLoadouts, saveLoadout } from '../src/game/setup/loadouts.js';
import { templatePortfolio } from '../src/game/data/templates.js';
import { Catalog } from '../src/game/core/catalog.js';

const item = (symbol: string, quantity: number, usd: number, category: Item['category'] = 'token', chainId = 'ethereum'): Item => ({
  id: `${chainId}:${symbol}`,
  chainId,
  name: symbol,
  symbol,
  category,
  quantity,
  usd,
  tier: 0,
  iconUrl: null,
});

function hero(over: Partial<Hero> = {}): Hero {
  return {
    address: '0xabc',
    label: '',
    name: 'Tester',
    netWorth: 0,
    tokenWorth: 0,
    nftWorth: 0,
    tier: 0,
    items: [],
    nfts: [],
    spamCount: 0,
    stashes: [],
    suggestedClass: 'adventurer',
    verbCounts: {},
    lastActiveAt: null,
    ...over,
  };
}

const proto = (id: string, category: Protocol['category']): [string, Protocol] => [id, { id, name: id, iconUrl: null, url: null, category, building: 'bazaar' as Protocol['building'], visits: 0 }];

describe('WalletImporter', () => {
  it('known tokens become sim assets, unknown ones custom assets in a fallback category; other chains are left out', () => {
    const h = hero({
      items: [
        item('ETH', 2, 6400, 'native'),
        item('USDC', 500, 500, 'stable'),
        item('WOJAK', 1e6, 300, 'meme'),
        item('FOO', 10, 100, 'token'),
        item('ETH', 1, 3200, 'native', 'base'),
      ],
    });
    const r = importWallet(h, new Map());
    const by = Object.fromEntries(r.portfolio.positions.map((p) => [p.asset, qn(p.qty)]));
    expect(by).toEqual({ eth: 2, usdc: 500, 'x:wojak': 1e6, 'x:foo': 10 });
    expect(r.customAssets.find((a) => a.id === 'x:wojak')?.category).toBe('meme');
    expect(r.customAssets.find((a) => a.id === 'x:wojak')?.collateral).toBe(false);
    expect(r.customAssets.find((a) => a.id === 'x:foo')?.category).toBe('misc');
    expect(r.notes.join(' ')).toContain('other chains');
  });

  it('tokens are matched by their contract: a look-alike under a known symbol is not taken for the real one', () => {
    const real = { ...item('USDC', 100, 100, 'stable'), address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' };
    const fake = { ...item('USDC', 50, 50, 'stable'), id: 'ethereum:fake', address: '0x000000000000000000000000000000000000dead' };
    const r = importWallet(hero({ items: [real, fake] }), new Map());
    const ids = r.portfolio.positions.map((p) => p.asset).sort();
    expect(ids).toEqual(['usdc', 'x:0x000000000000000000000000000000000000dead']);
    expect(r.customAssets[0]).toMatchObject({ symbol: 'USDC', address: '0x000000000000000000000000000000000000dead' });
  });

  it('protocol positions map onto the game’s kinds', () => {
    const entry = (symbol: string, kind: 'deposit' | 'loan' | 'staked', quantity: number, usd: number) => ({ name: symbol, symbol, kind, module: null, quantity, usd, chainId: 'ethereum' });
    const stash = (protocolId: string, entries: ReturnType<typeof entry>[]) => ({ protocolId, entries, netUsd: 0, grossUsd: 0, tier: 0 as const, hasRewards: false, hasDebt: false });
    const h = hero({
      stashes: [
        stash('aave', [entry('WETH', 'deposit', 3, 9000), entry('USDC', 'loan', 2000, -2000)]),
        stash('uniswap', [entry('ETH', 'deposit', 1, 3000), entry('USDC', 'deposit', 3000, 3000)]),
        stash('lido', [entry('stETH', 'staked', 5, 15000)]),
        stash('eigenlayer', [entry('stETH', 'deposit', 2, 6000)]),
        stash('maker', [entry('ETH', 'deposit', 4, 12000), entry('DAI', 'loan', 5000, -5000)]),
      ],
    });
    const protocols = new Map([proto('aave', 'lending'), proto('uniswap', 'dex'), proto('lido', 'staking'), proto('eigenlayer', 'restaking'), proto('maker', 'lending')]);
    const ps = importWallet(h, protocols).portfolio.positions;
    const find = (asset: string, kind: string) => ps.find((p) => p.asset === asset && p.kind === kind);
    expect(find('weth', 'supplied')?.protocol).toBe('lending');
    expect(find('usdc', 'borrowed')?.protocol).toBe('lending');
    expect(find('eth', 'lp')?.pairWith).toBe('usdc');
    expect(find('steth', 'staked')?.protocol).toBe('staking');
    expect(find('steth', 'restaked')?.protocol).toBe('restaking');
    expect(find('eth', 'supplied')?.protocol).toBe('vault');
    expect(find('dai', 'borrowed')?.protocol).toBe('vault');
  });

  it('NFTs: one holding per collection, keyed by contract, at its best floor', () => {
    expect(nftCollectionKey('ethereum:0xB47E3cD837dDF8e4c57F05d70Ab865de6e193BBB:7', 'Punks')).toBe('0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb');
    expect(nftCollectionKey('weird-id', 'Some Collection')).toBe('Some Collection');
    const nft = (id: string, usd: number) => ({ ...item('Coll', 1, usd, 'nft'), id });
    const h = hero({ nfts: [nft('ethereum:0x0000000000000000000000000000000000000001:1', 50), nft('ethereum:0x0000000000000000000000000000000000000001:2', 80)] });
    expect(importWallet(h, new Map()).portfolio.nfts).toEqual([{ collection: '0x0000000000000000000000000000000000000001', floor: 80 }]);
  });
});

describe('Portfolio Editor', () => {
  it('an import above the match cap is scaled down proportionally, with a notice', () => {
    const r = importWallet(hero({ items: [item('ETH', 1000, 3.2e6, 'native'), item('USDC', 1e6, 1e6, 'stable')] }), new Map());
    const d = importDraft(r.portfolio, r.customAssets);
    // valued at sim prices: 1000 ETH × 3000 + 1M USDC = $4M → ×0.25
    expect(draftValue(d)).toBeCloseTo(BALANCE.match.matchCap, 0);
    expect(qn(d.portfolio.positions.find((p) => p.asset === 'eth')!.qty)).toBeCloseTo(250, 6);
    expect(d.notice).toContain('scaled down');
  });

  it('a blank build spends a budget, and adding past it is refused', () => {
    const d = blankDraft(10000);
    expect(addDollars(d, 'eth', 6000).ok).toBe(true);
    expect(addDollars(d, 'wbtc', 5000).ok).toBe(false);
    expect(room(d)).toBeCloseTo(4000, 3);
    expect(addDollars(d, 'wbtc', 4000).ok).toBe(true);
    expect(setDollars(d, 0, 7000).ok).toBe(false);
    expect(setDollars(d, 0, 3000).ok).toBe(true);
    expect(draftValue(d)).toBeCloseTo(7000, 3);
  });

  it('staking ETH in the editor holds stETH; a template matches its archetype', () => {
    const d = blankDraft(10000);
    addDollars(d, 'eth', 3000, 'staked', 'staking');
    expect(d.portfolio.positions[0]).toMatchObject({ asset: 'steth', kind: 'staked', protocol: 'staking' });
    const whale = templateDraft('whale', 10000);
    expect(draftValue(whale)).toBeCloseTo(10000, 0);
  });

  it('the preview marks dust and walls, and matches the match’s opening armies', () => {
    const d = blankDraft(10000);
    addDollars(d, 'eth', 6000);
    addDollars(d, 'usdc', 3000);
    addDollars(d, 'link', 10); // far below 0.25 × UNIT_VALUE
    addNft(d, { collection: 'sim:punks', floor: 120000 });
    const pv = preview(d, 'whale', 'normal');
    expect(pv.rows[1]).toBe('walls');
    expect(pv.rows[2]).toBe('dust');
    expect(typeof pv.rows[0]).toBe('number');
    const m = new Match({ seed: 'pv', portfolios: [d.portfolio, opponentPortfolio(d, 'whale', 'normal')] });
    expect(m.state.unitValue).toBeCloseTo(pv.unitValue, 9);
    expect(m.state.sides[0].keepHpMax).toBeCloseTo(pv.keepHp, 9);
  });

  it('the opponent starts at the player’s value × the difficulty', () => {
    const d = templateDraft('balanced', 20000);
    const cat = new Catalog();
    const value = (p: ReturnType<typeof templatePortfolio>) => draftValue({ portfolio: p, customAssets: [], budget: null, notice: null });
    expect(value(opponentPortfolio(d, 'degen', 'easy'))).toBeCloseTo(14000, 0);
    expect(value(opponentPortfolio(d, 'degen', 'hard'))).toBeCloseTo(25000, 0);
    expect(cat.has('eth')).toBe(true);
  });
});

describe('loadouts', () => {
  class MemoryStorage {
    data = new Map<string, string>();
    get length() {
      return this.data.size;
    }
    clear() {
      this.data.clear();
    }
    getItem(k: string) {
      return this.data.get(k) ?? null;
    }
    key() {
      return null;
    }
    removeItem(k: string) {
      this.data.delete(k);
    }
    setItem(k: string, v: string) {
      this.data.set(k, v);
    }
  }

  it('drafts survive the trip through JSON, bigints included', () => {
    const d = templateDraft('yield-farmer', 5000);
    expect(decodeDraft(encodeDraft(d))).toEqual(d);
  });

  it('save, list newest first, replace by name, delete; no storage is no crash', () => {
    const s = new MemoryStorage() as unknown as Storage;
    expect(saveLoadout('Turtle', templateDraft('stable-maxi'), 1, s)).toBe(true);
    expect(saveLoadout('Yolo', templateDraft('degen'), 2, s)).toBe(true);
    expect(saveLoadout('Turtle', templateDraft('whale'), 3, s)).toBe(true);
    expect(listLoadouts(s).map((l) => l.name)).toEqual(['Turtle', 'Yolo']);
    expect(saveLoadout('   ', templateDraft('degen'), 4, s)).toBe(false);
    deleteLoadout('Yolo', s);
    expect(listLoadouts(s).map((l) => l.name)).toEqual(['Turtle']);
    expect(listLoadouts(null)).toEqual([]);
    expect(saveLoadout('x', templateDraft('degen'), 1, null)).toBe(false);
  });
});

describe('loadouts off the device', () => {
  it('a loadout code round-trips (names with any letters), and anything else is refused', async () => {
    const { loadoutCode, readLoadoutCode } = await import('../src/game/setup/loadouts.js');
    const d = templateDraft('yield-farmer', 5000);
    const code = loadoutCode('Hodl ⚔ Ü', d);
    expect(code.startsWith('SIEGE1:')).toBe(true);
    const back = readLoadoutCode(`  ${code}\n`);
    expect(back.name).toBe('Hodl ⚔ Ü');
    expect(back.draft.portfolio).toEqual(d.portfolio);
    expect(() => readLoadoutCode('hello')).toThrow();
    expect(() => readLoadoutCode('SIEGE1:bm9wZQ')).toThrow();
  });
});
