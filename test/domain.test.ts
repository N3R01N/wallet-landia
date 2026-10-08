import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild, refineVerb, suggestClass } from '../src/domain/mappers.js';
import { approxUsd, tierOf } from '../src/domain/tiers.js';
import { classifyAsset, classifyProtocol } from '../src/domain/catalog.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';
import type { TransferResource } from '../src/data/zerion/types.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

function transfer(direction: 'in' | 'out', symbol: string, value = 100, name = symbol): TransferResource {
  return {
    direction,
    quantity: { int: '1', decimals: 0, float: 1, numeric: '1' },
    value,
    price: value,
    sender: '0xaaa',
    recipient: '0xbbb',
    fungible_info: { name, symbol, icon: null },
  };
}

const ctx = (over: Partial<Parameters<typeof refineVerb>[1]> = {}): Parameters<typeof refineVerb>[1] => ({
  wallet: '0xme',
  category: null,
  initiated: true,
  ins: [],
  outs: [],
  loanSymbols: new Set(),
  ...over,
});

describe('tiers', () => {
  it('maps value onto the log scale', () => {
    expect(tierOf(0)).toBe(0);
    expect(tierOf(9.99)).toBe(0);
    expect(tierOf(10)).toBe(1);
    expect(tierOf(5_000)).toBe(3);
    expect(tierOf(2_000_000)).toBe(6);
    expect(tierOf(-50_000)).toBe(4); // debt is sized by magnitude
  });
  it('approximates for the at-a-glance label', () => {
    expect(approxUsd(12_345)).toBe('~$12k');
    expect(approxUsd(1_500)).toBe('~$1.5k');
    expect(approxUsd(null)).toBe('?');
  });
});

describe('classification', () => {
  it('sorts assets into item categories', () => {
    expect(classifyAsset('ETH', 'Ethereum', 'ethereum', true)).toBe('native');
    expect(classifyAsset('USDC', 'USD Coin', 'ethereum', false)).toBe('stable');
    expect(classifyAsset('stETH', 'Lido Staked ETH', 'ethereum', false)).toBe('lst');
    expect(classifyAsset('variableDebtEthWETH', 'Aave Variable Debt WETH', 'ethereum', false)).toBe('debt');
    expect(classifyAsset('PEPE', 'Pepe', 'ethereum', false)).toBe('meme');
    expect(classifyAsset('XYZ', 'Something', 'ethereum', false)).toBe('token');
  });
  it('sorts protocols into buildings, falling back to position modules', () => {
    expect(classifyProtocol('aave-v3', 'Aave V3')).toBe('lending');
    expect(classifyProtocol('uniswap-v3', 'Uniswap V3')).toBe('dex');
    expect(classifyProtocol('lido', 'Lido')).toBe('staking');
    expect(classifyProtocol('eigenlayer', 'EigenLayer')).toBe('restaking');
    expect(classifyProtocol('obscure', 'Obscure Fi', ['lending'])).toBe('lending');
    expect(classifyProtocol('obscure', 'Obscure Fi')).toBe('unknown');
  });
});

describe('verb refinement', () => {
  it('turns coarse operation types into what the hero did', () => {
    expect(refineVerb('trade', ctx({ ins: [transfer('in', 'USDC')], outs: [transfer('out', 'ETH')] }))).toBe('swap');
    expect(refineVerb('deposit', ctx({ category: 'staking' }))).toBe('stake');
    expect(refineVerb('deposit', ctx({ category: 'dex' }))).toBe('addLiquidity');
    expect(refineVerb('withdraw', ctx({ category: 'dex' }))).toBe('removeLiquidity');
    expect(refineVerb('deposit', ctx({ category: 'lending' }))).toBe('supply');
  });
  it('spots borrowing and repaying from debt tokens or open loans', () => {
    expect(refineVerb('execute', ctx({ category: 'lending', ins: [transfer('in', 'variableDebtWETH'), transfer('in', 'WETH')] }))).toBe('borrow');
    expect(refineVerb('withdraw', ctx({ category: 'lending', ins: [transfer('in', 'ETH')], loanSymbols: new Set(['ETH']) }))).toBe('borrow');
    expect(refineVerb('deposit', ctx({ category: 'lending', outs: [transfer('out', 'ETH')], loanSymbols: new Set(['ETH']) }))).toBe('repay');
  });
  it('treats collateral taken by someone else as a liquidation', () => {
    expect(refineVerb('execute', ctx({ category: 'lending', initiated: false, outs: [transfer('out', 'aEthWETH')] }))).toBe('liquidated');
  });
  it('never drops a transaction it cannot read', () => {
    expect(refineVerb('execute', ctx())).toBe('unknown');
    expect(refineVerb('something-new', ctx())).toBe('unknown');
  });
});

describe('classes', () => {
  it('suggests the dominant behaviour, or Adventurer when mixed', () => {
    expect(suggestClass({ swap: 8, send: 1 })).toBe('merchant');
    expect(suggestClass({ stake: 3, claim: 2 })).toBe('monk');
    expect(suggestClass({ swap: 1, stake: 1, send: 1, buyNft: 1 })).toBe('adventurer');
    expect(suggestClass({})).toBe('sleeper');
  });
});

describe('buildGuild (demo fixtures)', () => {
  const guild = buildGuild(demo);

  it('makes one hero per wallet with a stable generated name', () => {
    expect(guild.heroes).toHaveLength(demo.length);
    expect(buildGuild(demo).heroes.map((h) => h.name)).toEqual(guild.heroes.map((h) => h.name));
  });

  it('draws a transfer between two guild heroes once, from the sender', () => {
    const keys = guild.journeys.map((j) => j.key);
    expect(new Set(keys).size).toBe(keys.length);
    const internal = guild.journeys.filter((j) => j.counterpartyHero !== null);
    expect(internal.length).toBeGreaterThan(0);
    for (const j of internal) if (j.verb === 'send') expect(j.initiated).toBe(true);
  });

  it('keeps journeys in time order', () => {
    for (let i = 1; i < guild.journeys.length; i++) expect(guild.journeys[i]!.time).toBeGreaterThanOrEqual(guild.journeys[i - 1]!.time);
  });

  it('respects a transaction-count window', () => {
    const small = buildGuild(demo, { kind: 'count', count: 2 });
    for (const h of small.heroes) expect(small.journeys.filter((j) => j.hero === h.address).length).toBeLessThanOrEqual(2);
  });
});

describe('transfers that pass through a contract', () => {
  const ME = '0x8ebfe0a1b5989c87f3c34bec8c160cf9e80b2a78';
  const FRIEND = '0xc8f78e1c47f9fd9e7cadf95c47a90681574f2fc0';
  const BORROWER = '0xb4970704aaaaaaaaaaaaaaaaaaaaaaaaaaaa6495';
  const GONDI = '0xf41b389e0c1950dc0b16c9498eae77131cc08a56';
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const weth = { name: 'Wrapped Ether', symbol: 'WETH', icon: null, implementations: [{ chain_id: 'ethereum', address: WETH }] };
  let n = 0;
  const tx = (op: string, from: string, to: string, transfers: TransferResource[]): RawWallet['transactions'][number] => ({
    type: 'transactions',
    id: `t${n}`,
    attributes: {
      operation_type: op as never,
      hash: `0x${(n++).toString(16).padStart(4, '0')}`,
      mined_at_block: 1,
      mined_at: '2026-10-06T06:17:00Z',
      sent_from: from,
      sent_to: to,
      status: 'confirmed',
      nonce: 1,
      fee: { value: 1, price: null },
      transfers,
    },
    relationships: { chain: { data: { type: 'chains', id: 'ethereum' } } },
  });
  const t = (direction: 'in' | 'out', sender: string, recipient: string, value: number): TransferResource => ({
    direction,
    quantity: { int: '1', decimals: 18, float: value / 2700, numeric: '1' },
    value,
    price: 2700,
    sender,
    recipient,
    fungible_info: weth,
  });
  const wallet = (address: string, transactions: RawWallet['transactions']): RawWallet => ({
    address,
    currency: 'usd',
    capturedAt: Date.parse('2026-10-08T00:00:00Z'),
    label: 'test',
    portfolio: null,
    simple: [],
    complex: [],
    nfts: [],
    transactions,
  });

  it('a Gondi loan goes to the Gondi building as "lend", not to the gate', () => {
    const g = buildGuild([wallet(ME, [tx('send', ME, GONDI, [t('out', ME, BORROWER, 82_000), t('out', ME, '0x4169447a00000000000000000000000000000000', 30)])])]);
    const j = g.journeys[0]!;
    expect(j.verb).toBe('lend');
    expect(j.steps[0]!.target).toEqual({ kind: 'building', protocolId: 'gondi' });
    expect(g.protocols.get('gondi')?.building).toBe('bank');
  });

  it('a repayment arrives from the Gondi building', () => {
    const g = buildGuild([wallet(ME, [tx('receive', BORROWER, GONDI, [t('in', BORROWER, ME, 79_000)])])]);
    expect(g.journeys[0]!.verb).toBe('loanRepaid');
    expect(g.journeys[0]!.steps[0]!.target).toEqual({ kind: 'building', protocolId: 'gondi' });
  });

  it('a plain token send (calling the token contract) still goes to the gate', () => {
    const g = buildGuild([wallet(ME, [tx('send', ME, WETH, [t('out', ME, BORROWER, 500)])])]);
    expect(g.journeys[0]!.verb).toBe('send');
    expect(g.journeys[0]!.steps[0]!.target).toEqual({ kind: 'gate' });
  });

  it('a send between guild wallets through a transfer helper stays home to home', () => {
    const helper = '0x0000000000c2d145a2526bd8c716263bfebe1a72';
    const g = buildGuild([wallet(ME, [tx('send', ME, helper, [t('out', ME, FRIEND, 100)])]), wallet(FRIEND, [])]);
    expect(g.journeys[0]!.steps[0]!.target).toEqual({ kind: 'home', address: FRIEND });
  });

  it('learns contract → dApp from transactions where Zerion names it', () => {
    const named = tx('execute', ME, '0x1234000000000000000000000000000000005678', []);
    named.relationships = { ...named.relationships, dapp: { data: { type: 'dapps', id: 'some-lender' } } };
    named.attributes.application_metadata = { name: 'Some Lender' };
    const unnamed = tx('send', ME, '0x1234000000000000000000000000000000005678', [t('out', ME, BORROWER, 1000)]);
    const g = buildGuild([wallet(ME, [named, unnamed])]);
    for (const j of g.journeys) expect(j.steps[0]!.target).toEqual({ kind: 'building', protocolId: 'some-lender' });
  });
});
