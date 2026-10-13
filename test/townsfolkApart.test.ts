import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGuild } from '../src/domain/mappers.js';
import { planTown } from '../src/world/layout.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

/** How often, over a run, two townsfolk on the ground stand closer than `d` tiles. */
async function overlaps(d: number, steps: number): Promise<{ frames: number; pairs: number; folkSeen: number }> {
  const { Sim } = await import('../src/world/sim.js');
  const demoDir = resolve(__dirname, '../fixtures/demo');
  const demo: RawWallet[] = readdirSync(demoDir).map((f) => JSON.parse(readFileSync(resolve(demoDir, f), 'utf8')) as RawWallet);
  const guild = buildGuild(demo);
  const sim = new Sim(guild, planTown(guild));
  let frames = 0;
  let pairs = 0;
  let folkSeen = 0;
  for (let i = 0; i < steps; i++) {
    sim.step(0.05);
    const folk = sim.agents.filter((a) => a.kind === 'villager' && !a.gone && !a.inside && !a.queued && a.doorway === null && a.acting === null && a.alt === 0);
    folkSeen = Math.max(folkSeen, folk.length);
    let any = false;
    for (let a = 0; a < folk.length; a++) {
      for (let b = a + 1; b < folk.length; b++) {
        if (Math.hypot(folk[a]!.x - folk[b]!.x, folk[a]!.y - folk[b]!.y) < d) {
          pairs++;
          any = true;
        }
      }
    }
    if (any) frames++;
  }
  return { frames, pairs, folkSeen };
}

describe('townsfolk keep apart', () => {
  it('on the ground, two villagers are rarely closer than half their hitboxes (the pass keeps them apart)', async () => {
    const r = await overlaps(0.3, 1500);
    expect(r.folkSeen).toBeGreaterThan(1);
    // without the pass this overlaps in hundreds of frames; with it, only where a wall leaves no room to step aside
    expect(r.frames).toBeLessThanOrEqual(5);
  }, 120_000);
});
