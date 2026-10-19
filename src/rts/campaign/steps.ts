/**
 * The campaign's objectives, made to order: each factory gives a step with
 * its words, the button it points at and how it is checked. The step's id
 * says what it asks ("train:knight:4"), for the tests' scripted player.
 */

import { UNIT_TYPES } from '../../game/core/catalog.js';
import type { UnitTypeId } from '../../game/core/types.js';
import { BUILDINGS, TOKENS, TRAIN, type BuildingKind, type TokenId } from '../data/rules.js';
import { positionValue, type PositionKind } from '../core/economy.js';
import type { Card, Run, Step } from './run.js';

type Extra = Partial<Pick<Step, 'hint' | 'wait' | 'card' | 'text'>>;

/** Your units of these types standing. */
export function count(r: Run, types?: readonly UnitTypeId[]): number {
  return r.world.units.filter((u) => u.owner === 'A' && u.died < 0 && (!types || types.includes(u.type))).length;
}

/** Where your building of this kind stands (null: none). */
export function at(r: Run, kind: BuildingKind): { x: number; z: number } | null {
  const b = r.world.buildings.find((x) => x.owner === 'A' && x.kind === kind);
  return b ? { x: b.x, z: b.z } : null;
}

const has = (r: Run, kind: PositionKind) => r.world.players.A.positions.some((p) => p.kind === kind);
const name = (kind: BuildingKind) => BUILDINGS[kind].name;
const sel = (kind: BuildingKind) => (r: Run) => at(r, kind);

export function look(): Step {
  return {
    id: 'look',
    text: 'Look around',
    hint: 'Move the view: the arrow keys, or rest the pointer on the arrow strips at the screen’s edges. The wheel zooms, Q and E turn. The enemy lies across the river to the north.',
    done: (r, ui) => Math.hypot(ui.camera.x, ui.camera.z - (r.world.hallOf('A')!.z - 10)) > 10,
  };
}

export function selectHall(): Step {
  return {
    id: 'select:hall',
    text: 'Select your Wallet Hall',
    hint: 'Left-click the big hall at the ringed spot. The panel at the bottom right shows what a selected building can do.',
    beacon: sel('hall'),
    done: (_r, ui) => ui.building === 'hall',
    card: { building: 'hall' },
  };
}

/** Train until you have `n` of the unit. */
export function train(unit: UnitTypeId, n: number, extra: Extra = {}): Step {
  const rule = TRAIN.find((t) => t.unit === unit)!;
  const u = UNIT_TYPES[unit]!;
  const token = TOKENS[rule.token].symbol;
  const swap = rule.token === 'usdc' ? '' : ` They cost ${token}: swap for it at the Exchange first.`;
  return {
    id: `train:${unit}:${n}`,
    text: `Train ${n} ${n === 1 ? u.name : plural(u.name)}`,
    hint: `Select your ${name(rule.at)} and press ${u.name} in the panel.${swap} Training takes ${rule.time} s each; up to 5 wait in the queue.`,
    highlight: [`.rts-train[data-unit="${unit}"]`],
    beacon: sel(rule.at),
    done: (r) => count(r, [unit]) >= n,
    card: { unit },
    ...extra,
  };
}

/** Train `n` units of any of these types (counted together). */
export function trainAny(units: readonly UnitTypeId[], n: number, text: string, hint: string): Step {
  return {
    id: `trainAny:${units.join(',')}:${n}`,
    text,
    hint,
    highlight: units.map((u) => `.rts-train[data-unit="${u}"]:not(:disabled)`),
    done: (r) => count(r, units) >= n,
  };
}

/** Pick the building in the Build menu (the hall builds it). */
export function startBuild(kind: BuildingKind): Step {
  return {
    id: `start:${kind}`,
    text: `Build a ${name(kind)}`,
    hint: `Press ${name(kind)} in the Build menu at the bottom left. The hall pays $${BUILDINGS[kind].cost} and builds it, which takes ${BUILDINGS[kind].time} s.`,
    highlight: [`.rts-build-item[data-kind="${kind}"]`],
    done: (r) => {
      const p = r.world.players.A;
      return p.build?.kind === kind || p.ready === kind || r.world.has('A', kind);
    },
    card: { building: kind },
  };
}

export function place(kind: BuildingKind): Step {
  return {
    id: `place:${kind}`,
    text: `Place the ${name(kind)}`,
    hint: 'When it is ready, press Place, then click the ground near your buildings: green where it fits, red where it doesn’t. Right-click to put it off.',
    highlight: ['.rts-place'],
    done: (r) => r.world.has('A', kind),
  };
}

/** Build and place, in one step (once the player knows how). */
export function build(kind: BuildingKind, extra: Extra = {}): Step {
  return {
    id: `build:${kind}`,
    text: `Build and place a ${name(kind)}`,
    hint: `Build menu → ${name(kind)} ($${BUILDINGS[kind].cost}, ${BUILDINGS[kind].time} s), then Place it near your buildings.`,
    highlight: [`.rts-build-item[data-kind="${kind}"]`, '.rts-place'],
    done: (r) => r.world.has('A', kind),
    card: { building: kind },
    ...extra,
  };
}

export function upgrade(kind: BuildingKind, level: number, extra: Extra = {}): Step {
  return {
    id: `upgrade:${kind}:${level}`,
    text: `Raise the ${name(kind)} to level ${level}`,
    hint: `Select the ${name(kind)} and press ⬆ in the panel. It takes ${BUILDINGS[kind].upgradeTime} s.${kind === 'hall' ? '' : ' No building may be above the wallet hall.'}`,
    highlight: ['.rts-upgrade'],
    beacon: sel(kind),
    done: (r) => r.world.level('A', kind) >= level,
    ...extra,
  };
}

export function selectUnits(n: number): Step {
  return {
    id: 'select:units',
    text: 'Select your soldiers',
    hint: 'Hold the left button and drag a box round them. (A click selects one; Shift-click adds more; a double-click picks all of a kind in view.)',
    done: (_r, ui) => ui.selectedUnits >= n,
  };
}

export function moveTo(x: number, z: number, n: number): Step {
  return {
    id: `move:${x}:${z}`,
    text: 'March to the ring',
    hint: 'With your soldiers selected, right-click the ground in the ring: they walk there in formation.',
    beacon: () => ({ x, z }),
    done: (r) => r.world.units.filter((u) => u.owner === 'A' && u.died < 0 && Math.hypot(u.x - x, u.z - z) < 7).length >= n,
  };
}

export function rally(kind: BuildingKind): Step {
  return {
    id: `rally:${kind}`,
    text: 'Set a rally point',
    hint: `Select the ${name(kind)} and right-click the ground in front of your base: a flag goes there, and every new unit walks to it.`,
    beacon: sel(kind),
    done: (r) => r.world.buildings.some((b) => b.owner === 'A' && b.kind === kind && b.rally !== null),
  };
}

export function group(): Step {
  return {
    id: 'group',
    text: 'Make your army group 1',
    hint: 'Select your army and press Ctrl+1. From then on, 1 selects it again from anywhere; press 1 twice to jump the view to it.',
    done: (_r, ui) => ui.groups > 0,
  };
}

/** A raid sets off (after `wait`), and must be beaten. */
export function raid(name: string, units: readonly [UnitTypeId, number][], from: { x: number; z: number }, text: string, hint: string, wait = 0, card?: Card): Step {
  return {
    id: `fight:${name}`,
    text,
    hint,
    wait,
    start: (r) => {
      r.raid(name, units, from.x, from.z);
      r.say('⚔ Raiders are coming!');
    },
    beacon: (r) => r.where(name),
    done: (r) => r.alive(name).length === 0,
    ...(card ? { card } : {}),
  };
}

/** Guards of the setup (or put down as it starts), to be beaten. */
export function clear(name: string, text: string, hint: string, spawn?: { units: readonly [UnitTypeId, number][]; x: number; z: number }): Step {
  return {
    id: `fight:${name}`,
    text,
    hint,
    ...(spawn ? { start: (r: Run) => void r.groups.set(name, r.place('B', spawn.units, spawn.x, spawn.z)) } : {}),
    beacon: (r) => r.where(name),
    done: (r) => r.alive(name).length === 0,
  };
}

export function attackMove(): Step {
  return {
    id: 'attackMove',
    text: 'Attack-move across the river',
    hint: 'Select your army, press A (or ⚔ Attack-move in the panel) and click the ground beyond the river: they walk there and fight everything they meet on the way.',
    highlight: ['.rts-attack-move'],
    done: (r) => r.world.log.some((l) => l.tick >= r.startTick && l.player === 'A' && l.cmd.t === 'order' && l.cmd.kind === 'attackMove'),
  };
}

/** A building of the enemy's setup, to be destroyed. */
export function destroy(tag: string, text: string, hint: string): Step {
  return {
    id: `destroy:${tag}`,
    text,
    hint,
    beacon: (r) => r.building(tag),
    done: (r) => r.building(tag) === null,
  };
}

export function destroyHall(hint: string, extra: Extra = {}): Step {
  return {
    id: 'hall',
    text: 'Destroy the enemy’s Wallet Hall',
    hint,
    beacon: (r) => r.world.hallOf('B'),
    done: (r) => r.world.hallOf('B') === null,
    ...extra,
  };
}

export function swap(to: TokenId, usd: number, extra: Extra = {}): Step {
  return {
    id: `swap:${to}:${usd}`,
    text: `Swap for $${usd.toLocaleString('en-US')} of ${TOKENS[to].symbol}`,
    hint: `Select the Exchange. Under Swap, pick From USDC → To ${TOKENS[to].symbol} and press a share (25%, 50%, All).`,
    highlight: ['.rts-swap[data-share="0.25"]', '.rts-swap'],
    beacon: sel('exchange'),
    done: (r) => r.world.usd('A', to) >= usd,
    ...extra,
  };
}

export function pool(): Step {
  return {
    id: 'pool',
    text: 'Open an ETH–USDC pool',
    hint: 'At the Exchange, under Pool, pick ETH + USDC and press All: your ETH goes in with as much USDC, half and half. The pool earns fees every second.',
    highlight: ['.rts-pool[data-share="1"]', '.rts-pool'],
    beacon: sel('exchange'),
    done: (r) => has(r, 'lp'),
    card: { concept: 'positions' },
  };
}

/** Wait until positions have earned this much (from when the step starts). */
export function earn(usd: number): Step {
  const worth = (r: Run) => r.world.players.A.positions.reduce((s, p) => s + positionValue(r.world.econ, p), 0);
  return {
    id: `earn:${usd}`,
    text: `Earn $${usd} from your positions`,
    hint: 'Nothing to do but wait (or get on with something else): watch 📈 at the top, what your positions earn a minute, and the pool’s worth in the Exchange’s panel.',
    start: (r) => r.marks.set('worth', worth(r)),
    done: (r) => worth(r) - (r.marks.get('worth') ?? 0) >= usd,
  };
}

export function unpool(): Step {
  return {
    id: 'unpool',
    text: 'Take the pool back out',
    hint: 'Select the Exchange and press Remove beside the pool: its tokens, earnings and all, come back to your wallet to be spent.',
    highlight: ['.rts-pos .rts-tap'],
    beacon: sel('exchange'),
    done: (r) => !has(r, 'lp'),
  };
}

export function stake(): Step {
  return {
    id: 'stake',
    text: 'Stake your ETH',
    hint: 'Select the Staking House and press a share under Stake ETH. Staked ETH comes back as stETH, and grows every second.',
    highlight: ['.rts-stake[data-share="1"]', '.rts-stake'],
    beacon: sel('staking'),
    done: (r) => has(r, 'staked'),
  };
}

export function restake(): Step {
  return {
    id: 'restake',
    text: 'Restake your stETH',
    hint: 'Select the Restaking Hall and press a share under Restake stETH: the best yield in the game.',
    highlight: ['.rts-restake[data-share="1"]', '.rts-restake'],
    beacon: sel('restaking'),
    done: (r) => has(r, 'restaked'),
  };
}

export function supply(): Step {
  return {
    id: 'supply',
    text: 'Supply ETH at the Bank',
    hint: 'Select the Bank, pick ETH under Supply and press a share. Supplied tokens earn a little and back your loans.',
    highlight: ['.rts-supply[data-share="0.5"]', '.rts-supply'],
    beacon: sel('bank'),
    done: (r) => has(r, 'supplied'),
  };
}

export function borrow(): Step {
  return {
    id: 'borrow',
    text: 'Borrow USDC against it',
    hint: 'At the Bank, pick USDC under Borrow and press 50% (of what you may borrow). Watch the health: keep it well above 1.',
    highlight: ['.rts-borrow[data-share="0.5"]', '.rts-borrow'],
    beacon: sel('bank'),
    done: (r) => has(r, 'borrowed'),
    card: { concept: 'borrow' },
  };
}

export function vault(): Step {
  return {
    id: 'vault',
    text: 'Lock ETH in the Vault for DAI',
    hint: 'Select the Vault and press a share under Lock ETH: you get DAI for half its worth, and the ETH stays yours to take back when you repay.',
    highlight: ['.rts-vault[data-share="0.5"]', '.rts-vault'],
    beacon: sel('vault'),
    done: (r) => has(r, 'vault'),
  };
}

const plural = (n: string) => (n === 'Militia' ? n : `${n}s`);
