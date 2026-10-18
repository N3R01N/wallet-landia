import { describe, expect, it } from 'vitest';
import { BUILDINGS, RULES } from '../src/rts/data/rules.js';
import { cellOf, connected, generateMap, isOpen } from '../src/rts/core/map.js';
import { World } from '../src/rts/core/world.js';

const world = (kit: 'usdc' | 'eth' | 'mix' = 'usdc') => new World({ seed: 'test', kits: { A: kit, B: kit } });
const run = (w: World, seconds: number) => {
  for (let i = 0; i < seconds * RULES.tickHz; i++) w.step();
};

describe('the map', () => {
  it('is the same from the same seed, mirrored through the centre, and the starts are joined', () => {
    const a = generateMap('m1');
    const b = generateMap('m1');
    expect(a.blocked).toEqual(b.blocked);
    for (let i = 0; i < 2000; i++) {
      const x = ((i * 37) % 150) - 75 + 0.5;
      const z = ((i * 91) % 150) - 75 + 0.5;
      expect(isOpen(a, x, z), `${x},${z}`).toBe(isOpen(a, -x, -z));
    }
    expect(connected(a, RULES.start.A, RULES.start.B)).toBe(true);
    // the river is crossed only at the bridges
    expect(isOpen(a, 20, 0)).toBe(false);
    expect(isOpen(a, 0, 0)).toBe(true);
  });
});

describe('the world', () => {
  it('starts each side with its hall and its kit', () => {
    const w = world('eth');
    expect(w.hallOf('A')).toMatchObject({ kind: 'hall', level: 1, x: RULES.start.A.x, z: RULES.start.A.z });
    expect(w.usd('A', 'eth')).toBeCloseTo(10000, 6);
    expect(w.map.blocked[cellOf(w.map, RULES.start.A.x, RULES.start.A.z)]).toBe(2);
  });

  it('builds C&C style: pay, wait, then place near your own buildings', () => {
    const w = world();
    expect(w.command('A', { t: 'build', kind: 'exchange' }).ok).toBe(true);
    expect(w.spendable('A')).toBeCloseTo(10000 - BUILDINGS.exchange.cost, 6);
    expect(w.command('A', { t: 'build', kind: 'barracks' })).toEqual({ ok: false, reason: 'the hall is busy' });
    expect(w.command('A', { t: 'place', x: 0, z: 50 }).ok).toBe(false);
    run(w, BUILDINGS.exchange.time + 0.1);
    expect(w.players.A.ready).toBe('exchange');
    // too far, then on the hall, then beside it
    expect(w.command('A', { t: 'place', x: 0, z: 0 }).reason).toBe('too far from your buildings');
    expect(w.command('A', { t: 'place', x: 0, z: 62 }).reason).toBe('the ground is taken');
    expect(w.command('A', { t: 'place', x: 9, z: 58 }).ok).toBe(true);
    expect(w.has('A', 'exchange')).toBe(true);
    expect(w.players.A.ready).toBeNull();
  });

  it('upgrades need money and the hall a level ahead; the hall gates what can be built', () => {
    const w = world();
    expect(w.cantBuild('A', 'vault')).toContain('wallet hall at level 2');
    const hall = w.hallOf('A')!;
    expect(w.command('A', { t: 'upgrade', id: hall.id }).ok).toBe(true);
    run(w, BUILDINGS.hall.upgradeTime + 0.1);
    expect(hall.level).toBe(2);
    expect(hall.maxHp).toBe(BUILDINGS.hall.hp + BUILDINGS.hall.hpPerLevel);
    expect(w.cantBuild('A', 'vault')).toBe('needs a Bank');
  });

  it('a cancelled build is refunded; prices move, the same with the same seed', () => {
    const w = world();
    w.command('A', { t: 'build', kind: 'bank' });
    w.command('A', { t: 'cancelBuild' });
    expect(w.spendable('A')).toBeCloseTo(10000, 6);
    const v = world();
    run(w, 30);
    run(v, 30);
    expect(w.market.prices.eth).not.toBe(3000);
    expect(w.market.prices).toEqual(v.market.prices);
    expect(w.market.prices.usdc).toBe(1);
  });
});
