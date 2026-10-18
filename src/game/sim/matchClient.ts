/**
 * The page's side of the match (sim/match.worker.ts holds the authoritative
 * one). The page keeps a replica, played in lockstep: every command and step
 * goes to the worker and is applied to the replica the same way; a battle is
 * simulated once, in the worker, and the replica takes its outcome. Each
 * reply's state hash is checked against the replica's: a mismatch is a desync
 * (which PvP will need to catch). The HUD and the trade previews read the
 * replica, so they stay instant.
 *
 * Without a worker (none available, or it failed to start) the same handler
 * runs here, on a second Match: still two copies checked against each other.
 */

import type { BattleRun } from '../core/battle.js';
import type { CommandResult } from '../core/ledger.js';
import { Match, type MatchSetup } from '../core/match.js';
import type { Command, SideId } from '../core/types.js';
import { handle, stateHash, type MatchReply, type MatchRequest } from './match.worker.js';

type Pending = { resolve: (r: MatchReply) => void };
type Req = MatchRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export class MatchClient {
  /** The page's copy, read by the HUD (never changed except in step with the worker). */
  readonly replica: Match;
  /** Steps whose hashes disagreed (0 in a sound match). */
  desyncs = 0;
  #worker: Worker | null = null;
  readonly #inline: { m: Match | null } = { m: null };
  #next = 1;
  readonly #pending = new Map<number, Pending>();
  /** Requests run one after another: the worker sees them in the replica's order. */
  #chain: Promise<unknown> = Promise.resolve();
  readonly #setup: MatchSetup;
  /** Everything sent after the setup, to replay inline if the worker dies. */
  readonly #sent: Req[] = [];

  constructor(setup: MatchSetup, useWorker = typeof Worker !== 'undefined') {
    this.replica = new Match(setup);
    if (useWorker) {
      try {
        const w = new Worker(new URL('./match.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<MatchReply>) => {
          const p = this.#pending.get(e.data.id);
          this.#pending.delete(e.data.id);
          p?.resolve(e.data);
        };
        w.onerror = (e) => {
          console.warn('match worker', e.message);
          this.#fallBack(this.#setup);
        };
        this.#worker = w;
      } catch (error) {
        console.warn('match worker', error);
      }
    }
    this.#setup = setup;
    const opening = stateHash(this.replica);
    void this.#send({ t: 'init', setup }).then((r) => this.#check(r, opening));
  }

  /** A command: applied to the replica now (its result is the answer), and to the worker's match. */
  command(side: SideId, cmd: Command): CommandResult {
    const r = this.replica.command(side, cmd);
    // the hash the worker should report: the replica's right after this command
    const expected = stateHash(this.replica);
    if (r.ok) void this.#send({ t: 'command', side, cmd }).then((reply) => this.#check(reply, expected));
    return r;
  }

  /**
   * The NPC's trades for this Trade phase, decided by the worker's planner;
   * the replica takes the same commands. `each` is called
   * just before the replica takes each one; what it returns, just after (to
   * see what the trade changed).
   */
  async npc(side: SideId, each?: (cmd: Command) => (() => void) | void): Promise<Command[]> {
    const reply = await this.#send({ t: 'npc', side });
    const commands = reply.ok ? (reply.commands ?? []) : [];
    for (const c of commands) {
      const after = each?.(c);
      this.replica.command(side, c);
      after?.();
    }
    this.#check(reply, stateHash(this.replica));
    return commands;
  }

  /** One phase on; into a battle, the worker's simulated run comes back (the replica takes its outcome). */
  async advance(): Promise<BattleRun | null> {
    const reply = await this.#send({ t: 'advance' });
    const run = reply.ok ? (reply.run ?? null) : null;
    this.replica.advance(run ?? undefined);
    this.#check(reply, stateHash(this.replica));
    return run;
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }

  #check(reply: MatchReply, expected: number): void {
    if (!reply.ok) {
      console.warn('match worker', reply.error);
      return;
    }
    if (reply.hash !== expected) {
      this.desyncs++;
      console.error('Siege: the page and the worker disagree on the match (desync)');
    }
  }

  #send(req: Req): Promise<MatchReply> {
    const run = this.#chain.then(
      () =>
        new Promise<MatchReply>((resolve) => {
          const id = this.#next++;
          const full = { ...req, id } as MatchRequest;
          if (req.t !== 'init') this.#sent.push(req);
          if (!this.#worker) {
            resolve(handle(this.#inline, full));
            return;
          }
          this.#pending.set(id, { resolve });
          this.#worker.postMessage(full);
        }),
    );
    this.#chain = run;
    return run;
  }

  /** The worker died: the match carries on inline, rebuilt from everything sent so far. */
  #fallBack(setup: MatchSetup): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#inline.m = new Match(setup);
    const waiting = [...this.#pending.entries()];
    this.#pending.clear();
    // the requests already answered replay silently; those still waiting get their answers now
    const answered = this.#sent.length - waiting.length;
    this.#sent.slice(0, answered).forEach((req, i) => handle(this.#inline, { ...req, id: -1 - i } as MatchRequest));
    for (const [id, p] of waiting) {
      const req = this.#sent[answered + waiting.findIndex(([x]) => x === id)]!;
      p.resolve(handle(this.#inline, { ...req, id } as MatchRequest));
    }
  }
}
