import { describe, expect, it } from 'vitest';
import { MERGE_BLOCK, atTheMerge, claimedEnsAirdrop, historyMoments, inDaoYear, pastOfJourney, type PastTx } from '../src/domain/moments.js';
import type { Journey } from '../src/domain/model.js';
import { planCastle } from '../src/castle/scene/plan.js';
import {
  MONUMENTS,
  SECRETS,
  TapCounter,
  findSecret,
  foundSecrets,
  landmarksOf,
  monumentOf,
  secretPlacements,
  secretsProgress,
  wandererComes,
  type SecretStore,
} from '../src/castle/world/secrets.js';
import type { Errand, WorldProtocol } from '../src/castle/world/world.js';
import { sizeFor } from '../src/castle/world/size.js';

const YEAR = 365.25 * 86_400_000;
const NOW = Date.parse('2026-10-22T12:00:00Z');

const tx = (o: Partial<PastTx>): PastTx => ({ time: Date.parse('2024-01-01T00:00:00Z'), chainId: 'ethereum', block: 19_000_000, verb: 'send', protocolId: null, signed: true, failed: false, got: [], ...o });

function memory(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

let n = 0;
function errand(o: Partial<Errand>): Errand {
  n++;
  return {
    key: `ethereum:0x${n}`, protocolId: null, direction: 'out', failed: false, hash: `0x${n}`, chainId: 'ethereum', verb: 'send', valueUsd: 10, feeUsd: 1,
    wallet: '0xa', steps: [], method: null, block: 19_000_000, tier: 1, time: Date.parse('2024-01-01T00:00:00Z'), label: '', ...o,
  };
}

describe('the guild’s history: moments of Ethereum', () => {
  it('a transaction in 2016 is the year of The DAO (a failed one does not count)', () => {
    expect(inDaoYear(tx({ time: Date.parse('2016-06-17T12:00:00Z') }))).toBe(true);
    expect(inDaoYear(tx({ time: Date.parse('2016-12-31T23:59:00Z') }))).toBe(true);
    expect(inDaoYear(tx({ time: Date.parse('2017-01-01T00:00:01Z') }))).toBe(false);
    expect(inDaoYear(tx({ time: Date.parse('2016-06-17T12:00:00Z'), failed: true }))).toBe(false);
  });

  it('a claim of the ENS airdrop: ENS tokens claimed while it was open, or a claim at ENS', () => {
    const nov = Date.parse('2021-11-09T10:00:00Z');
    expect(claimedEnsAirdrop(tx({ time: nov, verb: 'claim', got: ['ENS'] }))).toBe(true);
    expect(claimedEnsAirdrop(tx({ time: nov, verb: 'receive', got: ['ENS'] }))).toBe(true);
    expect(claimedEnsAirdrop(tx({ time: nov, verb: 'claim', protocolId: 'ens' }))).toBe(true);
    // bought, not claimed; sent by someone else; before it opened; after it closed
    expect(claimedEnsAirdrop(tx({ time: nov, verb: 'swap', got: ['ENS'] }))).toBe(false);
    expect(claimedEnsAirdrop(tx({ time: nov, verb: 'receive', got: ['ENS'], signed: false }))).toBe(false);
    expect(claimedEnsAirdrop(tx({ time: Date.parse('2021-10-30T00:00:00Z'), verb: 'claim', got: ['ENS'] }))).toBe(false);
    expect(claimedEnsAirdrop(tx({ time: Date.parse('2022-06-01T00:00:00Z'), verb: 'claim', got: ['ENS'] }))).toBe(false);
    // registering a name at ENS is no claim
    expect(claimedEnsAirdrop(tx({ time: nov, verb: 'mint', protocolId: 'ens' }))).toBe(false);
  });

  it('the Merge: its block, or its day (UTC), on Ethereum', () => {
    expect(atTheMerge(tx({ block: MERGE_BLOCK, time: Date.parse('2022-09-15T06:42:59Z') }))).toBe(true);
    expect(atTheMerge(tx({ block: 15_540_000, time: Date.parse('2022-09-15T18:00:00Z') }))).toBe(true);
    expect(atTheMerge(tx({ block: 15_600_000, time: Date.parse('2022-09-16T00:00:01Z') }))).toBe(false);
    expect(atTheMerge(tx({ block: 15_540_000, time: Date.parse('2022-09-15T18:00:00Z'), chainId: 'polygon' }))).toBe(false);
  });

  it('lists the moments found, each once, in a fixed order', () => {
    expect(historyMoments([tx({ block: MERGE_BLOCK }), tx({ time: Date.parse('2016-03-01T00:00:00Z') }), tx({ time: Date.parse('2016-04-01T00:00:00Z') })])).toEqual(['dao-year', 'merge']);
    expect(historyMoments([tx({})])).toEqual([]);
  });

  it('reads a journey: its building, what it brought in, who signed', () => {
    const j: Journey = {
      key: 'ethereum:0x1', hash: '0x1', chainId: 'ethereum', hero: '0xa', time: Date.parse('2021-11-10T00:00:00Z'), status: 'confirmed', feeUsd: 1, feeNative: 0.001, block: 13_600_000,
      method: null, initiated: true, verb: 'claim', valueUsd: 100, tier: 1, drama: 0, counterparty: null, counterpartyHero: null, label: '',
      steps: [{ verb: 'claim', target: { kind: 'building', protocolId: 'ens' }, give: [], get: [{ symbol: 'ENS', quantity: 100, usd: 100, isNft: false }] }],
    };
    expect(pastOfJourney(j)).toMatchObject({ protocolId: 'ens', signed: true, failed: false, got: ['ENS'] });
    expect(historyMoments([pastOfJourney(j)])).toEqual(['ens-airdrop']);
  });
});

describe('the secrets', () => {
  it('a registry of distinct secrets, each with a name and how it is found; one per moment with a monument', () => {
    expect(new Set(SECRETS.map((s) => s.id)).size).toBe(SECRETS.length);
    for (const s of SECRETS) expect(s.name && s.hint).toBeTruthy();
    for (const id of Object.keys(MONUMENTS)) expect(SECRETS.map((s) => s.id)).toContain(id);
  });

  it('found ones are kept, once each, and counted', () => {
    const store = memory();
    expect(foundSecrets(store)).toEqual({});
    expect(findSecret('wishing-well', 1000, store)).toBe(true);
    expect(findSecret('wishing-well', 2000, store)).toBe(false);
    expect(findSecret('merge', 3000, store)).toBe(true);
    expect(foundSecrets(store)).toEqual({ 'wishing-well': 1000, merge: 3000 });
    const p = secretsProgress(foundSecrets(store));
    expect(p.total).toBe(SECRETS.length);
    expect(p.found.map((s) => s.id)).toEqual(['wishing-well', 'merge']);
  });

  it('storage that is broken or blocked finds nothing and throws nothing', () => {
    const broken: SecretStore = { getItem: () => 'not json', setItem: () => { throw new Error('full'); } };
    expect(foundSecrets(broken)).toEqual({});
    expect(findSecret('dao-year', 1, broken)).toBe(true);
    expect(foundSecrets(null)).toEqual({});
  });

  it('the well wants three quick taps in a row', () => {
    const well = new TapCounter();
    expect(well.tap(0)).toBe(false);
    expect(well.tap(1)).toBe(false);
    expect(well.tap(1.5)).toBe(true);
    // and starts again
    expect(well.tap(1.6)).toBe(false);
    // too slow: the first tap is forgotten
    const slow = new TapCounter();
    slow.tap(0);
    slow.tap(2);
    expect(slow.tap(4)).toBe(false);
    expect(slow.tap(4.5)).toBe(true);
  });

  it('the old wanderer comes for a guild whose first transaction is over five years old', () => {
    expect(wandererComes(NOW - 5.1 * YEAR, NOW)).toBe(true);
    expect(wandererComes(NOW - 4.9 * YEAR, NOW)).toBe(false);
    expect(wandererComes(null, NOW)).toBe(false);
  });

  it('what the guild has to show: from the loaded errands and the whole kept history', () => {
    const errands = [errand({ time: Date.parse('2022-09-15T08:00:00Z'), block: 15_537_500 }), errand({ time: NOW - YEAR })];
    expect(landmarksOf({ errands, lifetime: null, now: NOW })).toEqual({ moments: ['merge'], wanderer: false });
    expect(landmarksOf({ errands, lifetime: { moments: ['dao-year'], firstAt: Date.parse('2016-05-01T00:00:00Z') }, now: NOW })).toEqual({ moments: ['dao-year', 'merge'], wanderer: true });
    // a claim the guild signed brings ENS in
    const claim = errand({ time: Date.parse('2021-11-12T00:00:00Z'), verb: 'claim', steps: [{ verb: 'claim', where: 'ENS', give: [], get: [{ symbol: 'ENS', quantity: 50, usd: 2000, isNft: false }] }] });
    expect(landmarksOf({ errands: [claim], lifetime: null, now: NOW }).moments).toEqual(['ens-airdrop']);
    // an arrival is not signed by the guild
    expect(landmarksOf({ errands: [{ ...claim, direction: 'in' }], lifetime: null, now: NOW }).moments).toEqual([]);
  });

  it('monuments stand on the plaza clear of the paths, the plots and the tower; the wanderer by the ruin', () => {
    const proto = (id: string, category: WorldProtocol['category']): WorldProtocol => ({ id, name: id, category, tier: 2, signature: null, holdings: [], visits: 0, tvlUsd: 1e9, size: sizeFor(1e9), iconUrl: null });
    const ids = ['aave-v3', 'uniswap-v4', 'lido', 'ens', 'blur', 'across', 'curve', 'maker', 'compound', 'morpho', 'spark', 'pendle'];
    const cats: WorldProtocol['category'][] = ['lending', 'dex', 'staking', 'governance', 'nft', 'bridge'];
    for (const layout of [1, 2] as const) {
      const plan = planCastle({ wallets: 4, tier: 3, protocols: ids.map((id, i) => proto(id, cats[i % cats.length]!)) }, {}, layout);
      const placed = secretPlacements(plan, { moments: ['dao-year', 'ens-airdrop', 'merge'], wanderer: true });
      const monuments = placed.filter((p) => p.name === 'prop.monument');
      expect(monuments.map((p) => monumentOf(p.key))).toEqual(['dao-year', 'ens-airdrop', 'merge']);
      for (const p of placed) expect(p.optional).toBe(true);
      const decor = [...plan.decor.filter((d) => d.key !== 'flag'), ...monuments];
      for (const m of monuments) {
        for (const t of plan.road) expect(Math.abs(m.x - t.x) < 1.2 && Math.abs(m.z - t.z) < 1.2, `on the path at ${m.x},${m.z}`).toBe(false);
        for (const b of plan.buildings) expect(Math.abs(m.x - b.x) < b.half + 0.8 && Math.abs(m.z - b.z) < b.half + 0.8, `on ${b.protocol.id}'s plot`).toBe(false);
        expect(Math.hypot(m.x - plan.tower.x, m.z - plan.tower.z)).toBeGreaterThan(3);
        // not on another prop
        for (const d of decor) if (d !== m) expect(Math.hypot(m.x - d.x, m.z - d.z), `${d.name} at ${d.x},${d.z}`).toBeGreaterThan(1.2);
      }
      const ruin = plan.scenery.find((p) => p.name === 'scenery.ruin')!;
      const wanderer = placed.find((p) => p.key === 'wanderer')!;
      expect(Math.hypot(wanderer.x - ruin.x, wanderer.z - ruin.z)).toBeLessThan(6);
      expect(secretPlacements(plan, { moments: [], wanderer: false })).toEqual([]);
    }
  });
});
