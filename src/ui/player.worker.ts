/**
 * The player's level and badges, worked out off the main thread: mapping
 * tens of thousands of kept transactions would otherwise stall the town.
 * One job in, one profile out (see `domain/playerJob.ts`).
 */

import { workPlayer, type PlayerJob } from '../domain/playerJob.js';

export interface PlayerRequest {
  id: number;
  job: PlayerJob;
}
export type PlayerReply = { id: number; ok: true; profile: ReturnType<typeof workPlayer>; ms: number } | { id: number; ok: false; error: string };

// (the DOM lib types `self` as a window; in here it is the worker's own scope)
const scope = self as unknown as { onmessage: ((e: MessageEvent<PlayerRequest>) => void) | null; postMessage(m: PlayerReply): void };

scope.onmessage = (e) => {
  const { id, job } = e.data;
  const started = performance.now();
  try {
    const profile = workPlayer(job);
    scope.postMessage({ id, ok: true, profile, ms: performance.now() - started });
  } catch (error) {
    scope.postMessage({ id, ok: false, error: String(error) });
  }
};
