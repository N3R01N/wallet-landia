import { describe, expect, it } from 'vitest';
import { RULES } from '../src/rts/data/rules.js';
import { isOpen } from '../src/rts/core/map.js';
import { newUnit, type Unit } from '../src/rts/core/units.js';
import { COMBAT } from '../src/rts/core/combat.js';
import { World } from '../src/rts/core/world.js';
import type { UnitTypeId } from '../src/game/core/types.js';
import { UNIT_TYPES } from '../src/game/core/catalog.js';

const run = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * RULES.tickHz); i++) w.step();
};
let next = 10_000;
/** Units put straight onto the field (training is tested elsewhere). */
function put(w: World, owner: 'A' | 'B', type: UnitTypeId, x: number, z: number, n = 1): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < n; i++) {
    const u = newUnit(next++, type, owner, x + (i % 4) * 1.1, z + Math.floor(i / 4) * 1.1);
    w.units.push(u);
    out.push(u);
  }
  return out;
}
const living = (us: Unit[]) => us.filter((u) => u.died < 0).length;
const world = () => new World({ seed: 'combat', kits: { A: 'usdc', B: 'usdc' }, still: true });

describe('combat', () => {
  it('idle units take on enemies in sight; the stronger side wins; the dead are taken away', () => {
    const w = world();
    const knights = put(w, 'A', 'knight', -20, 30, 4);
    const militia = put(w, 'B', 'militia', -20, 24, 4);
    run(w, 25);
    expect(living(militia)).toBe(0);
    expect(living(knights)).toBeGreaterThan(0);
    run(w, COMBAT.corpse + 0.5);
    expect(w.units.some((u) => militia.includes(u))).toBe(false);
  });

  it('the counter triangle: lancers ride down archers that beat knights', () => {
    // the same money on each side
    const duel = (a: UnitTypeId, b: UnitTypeId) => {
      const w = world();
      const n = (t: UnitTypeId) => Math.round(900 / (RULES.unitValue * UNIT_TYPES[t]!.costMult));
      const x = put(w, 'A', a, -25, 30, n(a));
      const y = put(w, 'B', b, -25, 24, n(b));
      run(w, 40);
      return living(x) - living(y);
    };
    expect(duel('lancer.lido', 'archer.scout')).toBeGreaterThan(0);
    expect(duel('archer.scout', 'knight')).toBeGreaterThan(0);
    expect(duel('knight', 'lancer.lido')).toBeGreaterThan(0);
  });

  it('a plain move walks past enemies; attack-move stops to fight them', () => {
    const w = world();
    const runners = put(w, 'A', 'knight', -30, 35, 3);
    const fighters = put(w, 'A', 'knight', -26, 35, 3);
    const foes = put(w, 'B', 'militia', -28, 28, 2);
    w.command('A', { t: 'order', units: runners.map((u) => u.id), kind: 'move', x: -28, z: 15 });
    w.command('A', { t: 'order', units: fighters.map((u) => u.id), kind: 'attackMove', x: -24, z: 15 });
    run(w, 4);
    expect(runners.every((u) => u.target === null)).toBe(true);
    run(w, 20);
    expect(living(foes)).toBe(0);
  });

  it('held units only strike what comes in reach; idle units chase, then go back to their spot', () => {
    const w = world();
    const [held] = put(w, 'A', 'knight', -30, 35);
    const [guard] = put(w, 'A', 'knight', -20, 35);
    w.command('A', { t: 'order', units: [held!.id], kind: 'hold' });
    put(w, 'B', 'archer.scout', -30, 29);
    const [bait] = put(w, 'B', 'militia', -20, 28);
    // the bait runs off, out of the guard's leash
    w.command('B', { t: 'order', units: [bait!.id], kind: 'move', x: -20, z: 5 });
    run(w, 12);
    expect(Math.hypot(held!.x + 30, held!.z - 35)).toBeLessThan(0.5);
    expect(Math.hypot(guard!.x + 20, guard!.z - 35)).toBeLessThan(1.5);
  });

  it('units bring buildings down (siege hardest); the ground opens; the hall falling ends the match', () => {
    const w = world();
    const hall = w.hallOf('B')!;
    const titans = put(w, 'A', 'titan.bitcoin', hall.x - 6, hall.z + 8, 3);
    const knights = put(w, 'A', 'knight', hall.x + 6, hall.z + 8, 3);
    const ids = [...titans, ...knights].map((u) => u.id);
    w.command('A', { t: 'order', units: ids, kind: 'attack', target: hall.id });
    const hp0 = hall.hp;
    run(w, 2);
    expect(hall.hp).toBeLessThan(hp0);
    run(w, 120);
    expect(w.winner).toBe('A');
    expect(w.buildings.some((b) => b.id === hall.id)).toBe(false);
    expect(isOpen(w.map, hall.x, hall.z)).toBe(true);
    expect(w.command('A', { t: 'order', units: ids, kind: 'stop' }).reason).toBe('the match is over');
  });

  it('a wallet hall shoots what comes near', () => {
    const w = world();
    const hall = w.hallOf('B')!;
    const [scout] = put(w, 'A', 'militia', hall.x + 7, hall.z);
    w.command('A', { t: 'order', units: [scout!.id], kind: 'hold' });
    run(w, 3);
    expect(scout!.hp).toBeLessThan(scout!.maxHp);
  });
});
