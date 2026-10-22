import { describe, expect, it } from 'vitest';
import { buntingHeight, buntingRows, planFestive } from '../src/castle/scene/festive.js';
import { planCastle } from '../src/castle/scene/plan.js';
import { NO_OCCASIONS } from '../src/castle/world/events.js';
import type { WorldProtocol } from '../src/castle/world/world.js';
import { sizeFor } from '../src/castle/world/size.js';

const proto = (id: string, usd: number): WorldProtocol => ({ id, name: id, category: 'dex', tier: 1, signature: null, holdings: [], visits: 0, tvlUsd: usd, size: sizeFor(usd), iconUrl: null });
const world = (n: number) => ({ wallets: 2, tier: 2, protocols: [24e9, 15e9, 6e9, 2.5e9, 1.4e9, 9e8, 3e8, 5e7, 3e6, 1e6, 5e5, 2e5].slice(0, n).map((usd, i) => proto(`p${i}`, usd)) });

describe('the town dressed for its occasions', () => {
  const plans = [planCastle(world(3), {}, 2), planCastle(world(12), {}, 2), planCastle(world(6), {}, 1)];

  it('nothing on an ordinary day', () => {
    for (const plan of plans) expect(planFestive(plan, NO_OCCASIONS, false)).toEqual([]);
  });

  it('a festival strings bunting across the avenue, clear of the plaza, the plots and the door steps, with lanterns under it', () => {
    for (const plan of plans) {
      const rows = buntingRows(plan);
      expect(rows.length).toBeGreaterThan(0);
      for (const z of rows) {
        expect(z > plan.avenue.plazaStart - 2 && z < plan.avenue.plazaEnd + 2, `bunting at ${z} in the plaza`).toBe(false);
        for (const b of plan.buildings) {
          expect(Math.abs(b.z - z), `bunting at ${z} through ${b.protocol.id}'s plot`).toBeGreaterThan(b.half);
          expect(Math.abs(b.door.z - z)).toBeGreaterThan(1);
        }
      }
      for (let i = 1; i < rows.length; i++) expect(rows[i]! - rows[i - 1]!).toBeGreaterThanOrEqual(7);
      const d = planFestive(plan, { ...NO_OCCASIONS, festival: true }, false);
      expect(d.filter((p) => p.name === 'prop.bunting').length).toBe(rows.length);
      const lanterns = d.filter((p) => p.name === 'prop.lantern.festival');
      expect(lanterns.length).toBe(rows.length * 2);
      // hanging from the string: above a courier's head, under the poles' tops
      for (const l of lanterns) expect(l.y).toBeGreaterThan(2.4);
      for (const l of lanterns) expect(l.y).toBeLessThan(3.2);
    }
  });

  it('the bunting sags in the middle', () => {
    expect(buntingHeight(0)).toBeCloseTo(2.6);
    expect(buntingHeight(3)).toBeCloseTo(3.2);
    expect(buntingHeight(1.5)).toBeGreaterThan(2.6);
    expect(buntingHeight(1.5)).toBeLessThan(3.2);
  });

  it('December plans no caps: the snow lies on the roofs from each piece\u2019s own snow file', () => {
    expect(planFestive(plans[1]!, { ...NO_OCCASIONS, snow: true }, false)).toEqual([]);
  });

  it('late October puts a pumpkin by each door, off the avenue', () => {
    const plan = plans[1]!;
    const pumpkins = planFestive(plan, { ...NO_OCCASIONS, pumpkins: true }, false);
    expect(pumpkins.length).toBe(plan.buildings.length);
    for (const p of pumpkins) {
      expect(Math.abs(p.x)).toBeGreaterThan(1.5);
      expect(plan.buildings.some((b) => Math.sign(b.door.x) === Math.sign(p.x) && Math.abs(b.door.z - p.z) < 1)).toBe(true);
    }
  });

  it('a fresh drop leaves a crate just inside the Wayfarers’ Gate, beside the road (a plain crate until the theme has one)', () => {
    for (const plan of plans) {
      const [crate] = planFestive(plan, NO_OCCASIONS, true);
      expect(crate).toMatchObject({ name: 'prop.crate.airdrop', fallbacks: ['prop.crate'], occasion: 'crate' });
      expect(crate!.z).toBeLessThan(plan.avenue.out ?? plan.avenue.end);
      expect(crate!.z).toBeGreaterThan(plan.avenue.plazaEnd);
      expect(Math.abs(crate!.x)).toBeGreaterThan(1);
    }
  });
});
