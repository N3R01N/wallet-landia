/**
 * The match, run off the main thread (spec: "Core simulation runs in a Web
 * Worker, communicating via postMessage"). The worker holds the authoritative
 * Match: commands, phase steps, the NPCs' trades and the battles happen here.
 * Each reply carries a hash of the state after it, so the page's replica
 * (sim/matchClient.ts) can check it plays the same match: lockstep, as PvP
 * will need.
 */

import { npcTrade } from '../ai/npcPlanner.js';
import type { BattleRun } from '../core/battle.js';
import { Match, serialize, type MatchSetup } from '../core/match.js';
import type { Command, SideId } from '../core/types.js';
import { hashString } from '../../util/rng.js';

export type MatchRequest =
  | { id: number; t: 'init'; setup: MatchSetup }
  | { id: number; t: 'command'; side: SideId; cmd: Command }
  | { id: number; t: 'npc'; side: SideId }
  | { id: number; t: 'advance' };

export type MatchReply =
  | { id: number; ok: true; hash: number; run?: BattleRun; commands?: Command[]; accepted?: boolean; reason?: string }
  | { id: number; ok: false; error: string };

/** The state's fingerprint (the replica compares its own). */
export function stateHash(m: Match): number {
  return hashString(serialize(m.state));
}

/** Handles one request against a match (the worker's, or the inline fallback's). */
export function handle(match: { m: Match | null }, req: MatchRequest): MatchReply {
  try {
    if (req.t === 'init') {
      match.m = new Match(req.setup);
      return { id: req.id, ok: true, hash: stateHash(match.m) };
    }
    const m = match.m;
    if (!m) throw new Error('no match');
    if (req.t === 'command') {
      const r = m.command(req.side, req.cmd);
      return { id: req.id, ok: true, hash: stateHash(m), accepted: r.ok, ...(r.ok ? {} : { reason: r.reason }) };
    }
    if (req.t === 'npc') {
      const commands = npcTrade(m, req.side);
      return { id: req.id, ok: true, hash: stateHash(m), commands };
    }
    // a step; into a battle, the battle is simulated here and sent to the page to show
    const wasBattle = m.state.phase === 'battle';
    m.advance();
    const run = m.state.phase === 'battle' && !wasBattle ? m.run : null;
    return { id: req.id, ok: true, hash: stateHash(m), ...(run ? { run } : {}) };
  } catch (error) {
    return { id: req.id, ok: false, error: String(error) };
  }
}

// (the DOM lib types `self` as a window; in here it is the worker's own scope)
const scope = globalThis as unknown as { onmessage: ((e: MessageEvent<MatchRequest>) => void) | null; postMessage(m: MatchReply, transfer: Transferable[]): void };
const held: { m: Match | null } = { m: null };

if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e) => {
    const reply = handle(held, e.data);
    // the run's frames are sent, not copied (the worker keeps the outcome, not the frames)
    const transfer = reply.ok && reply.run ? [reply.run.frames.buffer.slice(0)] : [];
    if (reply.ok && reply.run && transfer[0]) reply.run = { ...reply.run, frames: new Float32Array(transfer[0]) };
    scope.postMessage(reply, transfer);
  };
}
