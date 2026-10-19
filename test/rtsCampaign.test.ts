import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS, RULES, STABLES, TRAIN, type BuildingKind, type TokenId } from '../src/rts/data/rules.js';
import { MISSIONS } from '../src/rts/campaign/missions.js';
import { NO_UI, Run, type Mission, type Ui } from '../src/rts/campaign/run.js';
import { count } from '../src/rts/campaign/steps.js';
import { spotFor } from '../src/rts/ai/opponent.js';
import { NOT_YET } from '../src/rts/core/world.js';
import type { UnitTypeId } from '../src/game/core/types.js';

/**
 * A scripted player: each second it does what the current objective asks,
 * by the step's id, through the same commands as the page sends.
 */
function act(r: Run, ui: Ui): void {
  const w = r.world;
  const step = r.step;
  if (!step || !r.started) return;
  const send = (cmd: Parameters<typeof w.command>[1]) => w.command('A', cmd);
  const [what, a = '', b = ''] = step.id.split(':');
  const mine = (kind: BuildingKind) => w.buildings.find((x) => x.owner === 'A' && x.kind === kind);
  const army = () => w.units.filter((u) => u.owner === 'A' && u.died < 0);
  const charge = (x: number, z: number) => {
    const idle = army().filter((u) => u.order.t === 'idle' && u.target === null);
    if (idle.length) send({ t: 'order', units: idle.map((u) => u.id), kind: 'attackMove', x, z });
  };
  const richest = (not: TokenId): TokenId => ([...STABLES, 'eth'] as TokenId[]).filter((t) => t !== not).sort((x, y) => w.usd('A', y) - w.usd('A', x))[0]!;
  const buy = (to: TokenId, usd: number) => {
    const from = richest(to);
    send({ t: 'swap', from, to, qty: Math.min(w.players.A.tokens[from], usd / w.market.prices[from]) });
  };
  const trainUnit = (unit: UnitTypeId, n: number) => {
    const rule = TRAIN.find((t) => t.unit === unit)!;
    const at = mine(rule.at);
    if (!at) return false;
    if (at.level < rule.level) {
      send({ t: 'upgrade', id: at.id });
      return true;
    }
    if (count(r, [unit]) + at.queue.filter((q) => q.unit === unit).length >= n || at.queue.length >= 2) return true;
    const cost = w.unitCost(rule) * w.market.prices[rule.token];
    if (w.usd('A', rule.token) < cost) buy(rule.token, cost * 1.2);
    return send({ t: 'train', id: at.id, unit }).ok;
  };
  const buildIt = (kind: BuildingKind) => {
    const p = w.players.A;
    if (p.ready) {
      const s = spotFor(w, 'A', p.ready);
      if (s) send({ t: 'place', x: s.x, z: s.z });
    } else if (!p.build && !w.has('A', kind)) send({ t: 'build', kind });
  };
  // keep an army coming while there is a fight
  const reinforce = () => {
    if (w.usd('A', 'usdc') < 400 && w.has('A', 'exchange') && w.spendable('A') > 700) buy('usdc', w.spendable('A') - w.usd('A', 'usdc') - 100);
    for (const unit of ['knight', 'archer.scout'] as const) if (w.usd('A', 'usdc') > 350) trainUnit(unit, 40);
  };
  switch (what) {
    case 'look':
      ui.camera = { x: 0, z: 0 };
      break;
    case 'select':
      if (a === 'hall') ui.building = 'hall';
      else ui.selectedUnits = army().length;
      break;
    case 'start':
    case 'place':
    case 'build':
      buildIt(a as BuildingKind);
      break;
    case 'rally': {
      const at = mine(a as BuildingKind);
      if (at) send({ t: 'rally', id: at.id, x: 0, z: 45 });
      break;
    }
    case 'train':
      trainUnit(a as UnitTypeId, Number(b));
      break;
    case 'trainAny':
      for (const u of a.split(',') as UnitTypeId[]) if (trainUnit(u, Number(b))) break;
      break;
    case 'upgrade': {
      const at = mine(a as BuildingKind);
      if (at && !at.upgrading) send({ t: 'upgrade', id: at.id });
      break;
    }
    case 'move':
      send({ t: 'order', units: army().map((u) => u.id), kind: 'move', x: Number(a), z: Number(b) });
      break;
    case 'group':
      ui.groups = 1;
      break;
    case 'attackMove':
      send({ t: 'order', units: army().map((u) => u.id), kind: 'attackMove', x: 0, z: -8 });
      break;
    case 'fight': {
      reinforce();
      const at = r.where(a);
      if (at) charge(at.x, at.z);
      break;
    }
    case 'destroy': {
      reinforce();
      const t = r.building(a);
      if (t) charge(t.x, t.z);
      break;
    }
    case 'hall': {
      reinforce();
      const h = w.hallOf('B');
      if (h && army().length >= 10) charge(h.x, h.z);
      break;
    }
    case 'swap':
      buy(a as TokenId, (Number(b) - w.usd('A', a as TokenId)) * 1.05 + 5);
      break;
    case 'pool':
      if (w.usd('A', 'eth') < 500) buy('eth', 1000);
      send({ t: 'lpAdd', a: 'eth', b: 'usdc', qty: w.players.A.tokens.eth });
      break;
    case 'unpool':
      for (const p of w.players.A.positions.filter((x) => x.kind === 'lp')) send({ t: 'lpRemove', id: p.id });
      break;
    case 'stake':
      send({ t: 'stake', qty: w.players.A.tokens.eth / 2 });
      break;
    case 'restake':
      send({ t: 'restake', qty: w.players.A.tokens.steth });
      break;
    case 'supply':
      send({ t: 'supply', token: 'eth', qty: w.players.A.tokens.eth / 2 });
      break;
    case 'borrow':
      send({ t: 'borrow', token: 'usdc', qty: 1000 });
      break;
    case 'vault': {
      const eth = w.players.A.tokens.eth / 2;
      send({ t: 'vaultOpen', eth, dai: Math.floor(eth * w.market.prices.eth * 0.5) });
      break;
    }
    case 'earn':
      break;
    default:
      throw new Error(`no script for ${step.id}`);
  }
}

/** Plays a mission: each step within `perStep` seconds. Returns the run and where it stopped. */
function play(m: Mission, opts: { perStep?: number; upTo?: number } = {}): { run: Run; stuck: string | null } {
  const run = new Run(m);
  const ui: Ui = { ...NO_UI, camera: { x: 0, z: 52 } };
  const upTo = opts.upTo ?? m.steps.length;
  let since = 0;
  let last = -1;
  for (let t = 0; run.state === 'playing' && run.index < upTo; t++) {
    run.world.step();
    run.tick(ui);
    if (run.index !== last) {
      last = run.index;
      since = 0;
    }
    if (t % RULES.tickHz === 0) act(run, ui);
    if (++since > (opts.perStep ?? 300) * RULES.tickHz) return { run, stuck: run.step?.id ?? '?' };
  }
  return { run, stuck: null };
}

describe('the campaign', () => {
  it('introduces every building and unit of the game once, each in the mission that opens it', () => {
    const seenUnits = new Map<string, number>();
    const seenBuildings = new Map<string, number>();
    for (const m of MISSIONS) {
      for (const c of m.cards) {
        if ('unit' in c) {
          expect(seenUnits.has(c.unit), `${c.unit} twice`).toBe(false);
          seenUnits.set(c.unit, m.n);
          expect(m.allowed.units, `${m.n} ${c.unit}`).toContain(c.unit);
        }
        if ('building' in c && c.building !== 'hall') {
          expect(seenBuildings.has(c.building), `${c.building} twice`).toBe(false);
          seenBuildings.set(c.building, m.n);
          expect(m.allowed.buildings, `${m.n} ${c.building}`).toContain(c.building);
        }
      }
      // nothing allowed before it is introduced
      for (const u of m.allowed.units) expect(seenUnits.get(u) ?? 99, `${u} in ${m.n}`).toBeLessThanOrEqual(m.n);
      for (const k of m.allowed.buildings) expect(seenBuildings.get(k) ?? 99, `${k} in ${m.n}`).toBeLessThanOrEqual(m.n);
    }
    expect([...seenUnits.keys()].sort()).toEqual(TRAIN.map((t) => t.unit).sort());
    expect([...seenBuildings.keys()].sort()).toEqual(BUILDING_KINDS.filter((k) => k !== 'hall').sort());
  });

  it('keeps locked buildings, units and levels from the player, and from the menus’ tokens', () => {
    const run = new Run(MISSIONS[0]!);
    const w = run.world;
    expect(w.cantBuild('A', 'barracks')).toBe(NOT_YET);
    expect(w.cantUpgrade('A', w.hallOf('A')!)).toBe(NOT_YET);
    expect(w.cantTrain('A', w.hallOf('A')!, 'militia')).toBeNull();
    expect(w.tokensInPlay('A')).toEqual(['usdc', 'eth']);
    // the enemy, unplayed, has nothing
    expect(w.cantBuild('B', 'barracks')).toBe(NOT_YET);
    // a skirmish has everything
    const six = new Run(MISSIONS[5]!).world;
    expect(six.tokensInPlay('A')).toEqual(expect.arrayContaining(['usdc', 'eth', 'ldo', 'link', 'uni', 'steth']));
    expect(six.tokensInPlay('A')).not.toContain('wbtc');
  });

  it('sets a mission up: buildings standing, the enemy’s base and guards', () => {
    const run = new Run(MISSIONS[5]!);
    const w = run.world;
    for (const k of ['barracks', 'archery', 'exchange', 'staking'] as const) expect(w.has('A', k), k).toBe(true);
    expect(run.building('barracks')?.owner).toBe('B');
    expect(run.alive('gate')).toHaveLength(8);
    expect(w.units.filter((u) => u.owner === 'A')).toHaveLength(6);
  });

  it('shows the objectives one at a time, with a wait before a raid', () => {
    const run = new Run(MISSIONS[1]!);
    expect(run.step?.id).toBe('start:barracks');
    run.world.command('A', { t: 'build', kind: 'barracks' });
    run.tick(NO_UI);
    expect(run.step?.id).toBe('place:barracks');
    expect(run.takeSaid()).toEqual(['✓ Build a Barracks']);
  });

  for (const m of MISSIONS.filter((x) => !x.enemy?.ai)) {
    it(`mission ${m.n}, ${m.title}: a scripted player wins it`, () => {
      const { run, stuck } = play(m);
      expect(stuck, `stuck at ${stuck} after ${Math.round(run.world.time)} s`).toBeNull();
      expect(run.state).toBe('won');
      expect(run.world.winner).toBe('A');
    });
  }

  for (const m of MISSIONS.filter((x) => x.enemy?.ai)) {
    it(`mission ${m.n}, ${m.title}: its objectives can be met against the computer, which keeps to its own`, () => {
      const { run, stuck } = play(m, { upTo: m.steps.length - 1 });
      expect(stuck, `stuck at ${stuck} after ${Math.round(run.world.time)} s`).toBeNull();
      const w = run.world;
      if (w.allowed.B) for (const b of w.buildings.filter((x) => x.owner === 'B' && x.kind !== 'hall')) expect(w.allowed.B.buildings).toContain(b.kind);
      // the last fight, won here by an army put down at the enemy's door
      const hall = w.hallOf('B')!;
      for (let i = 0; i < 16; i++) run.place('A', [['titan.bitcoin', 1]], hall.x - 6 + (i % 4) * 3, hall.z + 10 + Math.floor(i / 4) * 2);
      w.command('A', { t: 'order', units: w.units.filter((u) => u.owner === 'A').map((u) => u.id), kind: 'attack', target: hall.id });
      for (let i = 0; i < 300 * RULES.tickHz && run.state === 'playing'; i++) {
        w.step();
        run.tick(NO_UI);
      }
      expect(run.state).toBe('won');
    });
  }
});
