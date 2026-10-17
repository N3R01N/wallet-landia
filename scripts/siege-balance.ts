/**
 * Siege of the Ledger's balance report (spec: "Balance targets"): NPC-vs-NPC
 * matches for every pairing, checked against the spec's targets.
 *
 *   npm run siege:balance -- [matches per pairing, default 1000] [shards, default 8]
 *
 * The matches are split over processes (each a shard of the same seeded
 * list) and added up; the report goes to docs/game/BALANCE.md.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { balanceLineups, playMatch, reportSpecs, summarize, type MatchStats } from '../src/game/sim/headlessRunner.js';

const [, , nArg, shardsArg, shardArg, outArg] = process.argv;
const n = Number(nArg ?? 1000);
const shards = Number(shardsArg ?? 8);
const specs = reportSpecs(balanceLineups(), n);

if (shardArg !== undefined) {
  // a worker: its share of the specs, written as JSON
  const shard = Number(shardArg);
  const out: MatchStats[] = specs.filter((_, i) => i % shards === shard).map(playMatch);
  writeFileSync(outArg!, JSON.stringify(out));
} else {
  const started = Date.now();
  const files = Array.from({ length: shards }, (_, i) => `${process.env.TMPDIR ?? '/tmp'}/siege-balance-${process.pid}-${i}.json`);
  await Promise.all(
    files.map(
      (file, i) =>
        new Promise<void>((resolve, reject) => {
          const p = spawn('npx', ['vite-node', 'scripts/siege-balance.ts', String(n), String(shards), String(i), file], { stdio: 'inherit' });
          p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${i} failed`))));
        }),
    ),
  );
  const stats = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as MatchStats[]);
  const r = summarize(stats);
  const lines = [
    '# Siege of the Ledger: balance report',
    '',
    `${stats.length} NPC-vs-NPC matches (normal difficulty, $20,000 a side, sides swapped every other match), ${n} per pairing, ${Math.round((Date.now() - started) / 1000)} s. Made by \`npm run siege:balance\`.`,
    '',
    '| Target | Value | Spec | |',
    '|---|---|---|---|',
    ...r.checks.map((c) => `| ${c.name} | ${c.value} | ${c.target} | ${c.ok ? '✅' : '❌'} |`),
    '',
    '| Pairing | Matches | First wins | Median rounds | Sudden death |',
    '|---|---|---|---|---|',
    ...r.pairs.map((p) => `| ${p.a} vs ${p.b} | ${p.matches} | ${(p.aWins * 100).toFixed(1)}% | ${p.medianRounds} | ${(p.suddenDeath * 100).toFixed(1)}% |`),
    '',
    `Matches with borrowing: ${r.borrowMatches}.`,
    '',
  ];
  writeFileSync('docs/game/BALANCE.md', lines.join('\n'));
  console.log(lines.join('\n'));
}
