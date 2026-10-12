import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import type { Agent, Effect, Town } from '../src/world/agents.js';
import { planTown } from '../src/world/layout.js';
import { Townsfolk } from '../src/world/townsfolk.js';
import { walkableAt } from '../src/world/route.js';
import { makeRng } from '../src/util/rng.js';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const demoDir = resolve(__dirname, '../fixtures/demo');
const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);

/** A town with only what the townsfolk ask of it: villagers placed by hand. */
function town(): { town: Town; agents: Agent[]; effects: Effect[] } {
  const plan = planTown(buildGuild(demo));
  const agents: Agent[] = [];
  const effects: Effect[] = [];
  const rng = makeRng(7);
  let uid = 0;
  const t: Town = {
    plan,
    rng,
    agents: () => agents,
    addAgent: (a) => agents.push(a),
    makeAgent: (kind, x, y) => ({ id: `${kind}:${uid++}`, kind, x, y, path: [], tasks: [], acting: null, facing: 1, inside: false, doorway: null, goods: [], face: null, speed: 1.2, flying: false, alt: 0, hover: 0, slotAt: null, carrying: null, journey: null, trail: [], phase: 0, dim: false, gone: false }),
    addEffect: (e) => effects.push(e),
    releaseSlot: (a) => (a.slotAt = null),
    toDoor: (b) => ({ type: 'walk', to: b.doorAt }),
    enterable: () => true,
    doorway: (b) => b.doorAt,
  };
  return { town: t, agents, effects };
}

describe('a big moment turns heads', () => {
  it('stops the villagers about, who face it and say so; those far off are left alone', () => {
    const { town: t, agents, effects } = town();
    const folk = new Townsfolk(t);
    const at = t.plan.tower.doorAt;
    const near = t.makeAgent('villager', at.x + 1, at.y);
    const far = t.makeAgent('villager', at.x + 30, at.y);
    const hero = t.makeAgent('hero', at.x - 1, at.y);
    near.path = [{ x: at.x + 5, y: at.y }];
    agents.push(near, far, hero);
    expect(folk.gawk(at, 2)).toBe(1);
    expect(near.path).toEqual([]);
    const acts = near.tasks.filter((x) => x.type === 'act');
    expect(acts.every((x) => x.type === 'act' && x.face === at)).toBe(true);
    expect(acts.some((x) => x.type === 'act' && x.gesture === 'talk')).toBe(true);
    expect(far.tasks).toEqual([]);
    expect(hero.tasks).toEqual([]);
    expect(effects.some((e) => e.kind === 'bubble' && e.fromAgent === near.id)).toBe(true);
  });

  it('on the biggest, they cheer, and the ones further off come closer', () => {
    const { town: t, agents } = town();
    const folk = new Townsfolk(t);
    const at = t.plan.tower.doorAt;
    // a walkable spot about six tiles away, on the road from the tower
    let spot: { x: number; y: number } | null = null;
    for (let dx = 4; dx <= 8 && spot === null; dx++) for (const sx of [1, -1]) if (spot === null && walkableAt(t.plan, { x: at.x + sx * dx, y: at.y })) spot = { x: at.x + sx * dx, y: at.y };
    expect(spot).not.toBeNull();
    const v = t.makeAgent('villager', spot!.x, spot!.y);
    agents.push(v);
    expect(folk.gawk(at, 3)).toBe(1);
    expect(v.tasks.some((x) => x.type === 'act' && x.gesture === 'cheer')).toBe(true);
    expect(v.tasks[0]?.type).toBe('walk');
  });
});
