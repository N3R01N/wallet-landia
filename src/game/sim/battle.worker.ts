/**
 * The battle, simulated off the main thread (spec: "runs headless (in a Web
 * Worker)"): 900 ticks of up to 600 entities would otherwise stall the town.
 * One battle in, its run out; the frames travel as a transferred buffer.
 */

import { simulateBattle, type BattleOptions, type BattleRun } from '../core/battle.js';
import type { Army } from '../core/types.js';

export interface BattleRequest {
  id: number;
  armies: [Army, Army];
  opts: BattleOptions;
}
export type BattleReply = { id: number; ok: true; run: BattleRun; ms: number } | { id: number; ok: false; error: string };

// (the DOM lib types `self` as a window; in here it is the worker's own scope)
const scope = self as unknown as { onmessage: ((e: MessageEvent<BattleRequest>) => void) | null; postMessage(m: BattleReply, transfer: Transferable[]): void };

scope.onmessage = (e) => {
  const { id, armies, opts } = e.data;
  const started = performance.now();
  try {
    const run = simulateBattle(armies, opts);
    scope.postMessage({ id, ok: true, run, ms: performance.now() - started }, [run.frames.buffer]);
  } catch (error) {
    scope.postMessage({ id, ok: false, error: String(error) }, []);
  }
};
