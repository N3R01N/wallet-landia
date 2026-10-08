/** Print the guild built from the fixtures: a text check that data → world is sane. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGuild } from '../src/domain/mappers.js';
import type { RawWallet } from '../src/data/zerion/endpoints.js';

const dir = resolve(process.argv[2] ?? 'fixtures');
const raws = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RawWallet);
const guild = buildGuild(raws, process.argv[3] === 'count' ? { kind: 'count', count: 100 } : { kind: 'days', days: 30 });
for (const h of guild.heroes) {
  console.log(`${h.name} (${h.address}) worth $${Math.round(h.netWorth)} tier ${h.tier} class ${h.suggestedClass}`);
  console.log(`  items ${h.items.length}, nfts ${h.nfts.length}, spam ${h.spamCount}, stashes ${h.stashes.map((s) => s.protocolId).join(', ')}`);
  console.log(`  verbs ${JSON.stringify(h.verbCounts)}`);
}
console.log('\nprotocols:');
for (const p of guild.protocols.values()) console.log(`  ${p.id} → ${p.category}/${p.building} (${p.visits} visits)`);
const unknown = guild.journeys.filter((j) => j.verb === 'unknown').length;
console.log(`\n${guild.journeys.length} journeys, ${unknown} unknown (${Math.round((100 * unknown) / Math.max(1, guild.journeys.length))}%)`);
for (const j of guild.journeys.slice(-15)) console.log(`  ${new Date(j.time).toISOString().slice(0, 16)} ${j.hero.slice(0, 8)} ${j.verb} → ${j.steps.map((s) => s.target.kind === 'building' ? s.target.protocolId : s.target.kind).join(' › ')} :: ${j.label}`);
