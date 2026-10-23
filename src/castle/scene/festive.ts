/**
 * The town dressed for its occasions (world/events.ts; docs/ENGAGEMENT.md
 * B2–B4): bunting across the avenue and lanterns under it for a rising
 * market, fireworks over the keep at dusk, shuttered stalls in a crash; snow
 * on the roofs and falling in December; pumpkins by the doors in late October;
 * fireworks and a toast on the guild's day; a crate at the Wayfarers' Gate for
 * an airdrop or mint that came lately, opened by a tap. Where things go is
 * plain data (planFestive, tested); each piece shows once the theme has its
 * model, nothing stands in for a missing one, and the models load only when an
 * occasion needs them.
 */

import * as THREE from 'three';
import { Figure } from './figure.js';
import { AVENUE_HALF, type CastlePlan } from './plan.js';
import { SNOW } from '../assets/manifest.js';
import { NO_OCCASIONS, dropLine, type Occasions } from '../world/events.js';
import type { Errand } from '../world/world.js';

/** What the dressing reads from the town's plan. */
export type FestivePlan = Pick<CastlePlan, 'buildings' | 'avenue' | 'freeSlots' | 'town' | 'gate'> & Partial<Pick<CastlePlan, 'streets'>>;

/** One piece of dressing. `y` is its height off the ground (a roof's: from the roof's top). */
export interface Dressing {
  name: string;
  /** Models to use instead, in order, when `name` has none (the crate: a plain one). */
  fallbacks?: string[];
  /** The one node of the model to show (prop.snow's caps: `snow.s`, `snow.m`, `snow.l`). */
  part?: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  occasion: 'festival' | 'snow' | 'pumpkins' | 'crate';
}

/** The bunting: its poles this far either side of the avenue's middle (a 6 m span), the string's height at the poles and in the middle. */
const BUNTING_HALF = 3;
const BUNTING_TOP = 3.2;
const BUNTING_SAG = 2.6;
/** Strings of bunting at least this far apart along the avenue (m). */
const BUNTING_EVERY = 7;
/** A festival lantern hangs from the string this far either side of the middle. */
const LANTERN_AT = 1.5;
/** Whether a piece shows its tier part N (its own `tier.N` node visible), for that part's snow. */
function tierShown(piece: THREE.Object3D, n: number): boolean {
  let shown = false;
  piece.traverse((o) => {
    if (new RegExp(`^tier\\.?${n}$`).test((o.userData.name as string | undefined) ?? o.name)) shown ||= o.visible;
  });
  return shown;
}

/** Bunting and lanterns, by turns along the avenue. */
const FESTIVE_COLORS = ['#c8302a', '#e0a83a', '#2f6fbf', '#3d9a4f', '#8e4bd1'];

/** The bunting string's height `x` metres from the avenue's middle (a sag between the poles). */
export function buntingHeight(x: number): number {
  const f = Math.min(1, Math.abs(x) / BUNTING_HALF);
  return BUNTING_SAG + (BUNTING_TOP - BUNTING_SAG) * f * f;
}

/**
 * Where the bunting strings cross the avenue (their z): every so far along it,
 * each pole clear of the buildings' plots and door steps on its side, none in
 * the plaza (the avenue turns round the tower there).
 */
export function buntingRows(plan: Pick<CastlePlan, 'buildings' | 'avenue'> & Partial<Pick<CastlePlan, 'streets'>>): number[] {
  const { avenue } = plan;
  const end = avenue.out ?? avenue.end;
  const clear = (z: number) =>
    !(z > avenue.plazaStart - 2 && z < avenue.plazaEnd + 2) &&
    // (and never across a street's mouth)
    (plan.streets ?? []).every((t) => Math.abs(t.z - z) > 2.5) &&
    plan.buildings.every((b) => (b.street ? Math.abs(b.x) - b.half > BUNTING_HALF + 0.5 || Math.abs(b.z - z) > b.half + 0.5 : Math.abs(b.z - z) > b.half + 0.5 && Math.abs(b.door.z - z) > 1));
  const rows: number[] = [];
  for (let z = 4.5; z < end - 1; z += 0.5) if (clear(z) && (!rows.length || z - rows[rows.length - 1]! >= BUNTING_EVERY)) rows.push(z);
  return rows;
}

/** The dressing for the occasions (and a crate when there is a fresh drop). */
export function planFestive(plan: FestivePlan, o: Occasions, drop: boolean): Dressing[] {
  const out: Dressing[] = [];
  const piece = (occasion: Dressing['occasion'], name: string, x: number, z: number, more: Partial<Dressing> = {}): Dressing => ({ name, x, y: 0, z, rot: 0, scale: 1, occasion, ...more });
  if (o.festival) {
    for (const z of buntingRows(plan)) {
      out.push(piece('festival', 'prop.bunting', 0, z));
      // a lantern either side of the middle, hanging from the string (by its top)
      for (const x of [-LANTERN_AT, LANTERN_AT]) out.push(piece('festival', 'prop.lantern.festival', x, z, { y: buntingHeight(x) }));
    }
  }
  // (December's snow lies on the roofs from each piece's own snow file, laid by Festive, and falls over the view)

  if (o.pumpkins) {
    // one by each door, beside its step on the avenue's edge, facing the avenue
    plan.buildings.forEach((b, i) => {
      if (b.street) {
        // beside its step on its street's edge, facing the street
        const across = Math.sign(b.door.z - b.street.z) || 1;
        out.push(piece('pumpkins', 'prop.pumpkin', b.door.x + (i % 2 ? 0.75 : -0.75), b.street.z + across * (AVENUE_HALF + 0.35), { rot: across > 0 ? Math.PI : 0 }));
        return;
      }
      const side = Math.sign(b.door.x) || 1;
      out.push(piece('pumpkins', 'prop.pumpkin', side * (AVENUE_HALF + 0.35), b.door.z + (i % 2 ? 0.75 : -0.75), { rot: -side * (Math.PI / 2) }));
    });
  }
  if (drop) out.push(crateAt(plan));
  return out;
}

/** The crate's place: this far in from the gate's door, beside the road (in front of the gate's sign). */
const CRATE_IN = 2.6;
const CRATE_ASIDE = 1.8;

/** The crate: beside the road just inside the Wayfarers' Gate (the avenue's end without one). */
function crateAt(plan: Pick<CastlePlan, 'avenue' | 'gate'>): Dressing {
  const z = (plan.avenue.out ?? plan.avenue.end) - CRATE_IN;
  return { name: 'prop.crate.airdrop', fallbacks: ['prop.crate'], x: CRATE_ASIDE, y: 0, z, rot: -0.3, scale: 1, occasion: 'crate' };
}

/** Every model the dressing may use. */
export const FESTIVE_MODELS = ['prop.bunting', 'prop.lantern.festival', 'fx.firework', 'prop.snow', 'fx.snowfall', 'prop.pumpkin', 'prop.crate.airdrop', 'prop.crate'];

/** What the dressing needs from the view. */
export interface FestiveHost {
  /** Loads a model; whether the theme has it. */
  load(name: string): Promise<boolean>;
  make(name: string): THREE.Object3D;
  clips(name: string): THREE.AnimationClip[];
  /** Into the scene (not the town's layout: the dressing comes and goes by itself). */
  add(obj: THREE.Object3D): void;
  /** A building's placed model, by protocol id (its roof), and the keep. */
  building(protocolId: string): THREE.Object3D | null;
  keep(): THREE.Object3D | null;
  /** The town's market stalls. */
  stalls(): THREE.Object3D[];
  /** The town's and the castle's pieces that may have a snow file: buildings, castle pieces, the town's own, stalls (each named after its asset). */
  placed(): THREE.Object3D[];
  /** 0 by day … 1 at night. */
  night(): number;
  /** Where the camera looks (the falling snow stays over it). */
  focus(): THREE.Vector3;
  /** A speech bubble over something (what the crate held). */
  say(obj: THREE.Object3D, line: string): void;
  /** The view's element (for the toast). */
  element: HTMLElement;
  /** The crate was opened. */
  opened?(errand: Errand): void;
}

/** Fireworks: how often (s, plus up to as much again), how high over the keep's top, how far about it; the opening volley. */
const FIREWORK_EVERY = 5;
const FIREWORK_LIFT = 3;
const FIREWORK_SPREAD = 4;
const VOLLEY = 5;
/** Fireworks at a festival only from dusk (the night factor). */
const DUSK = 0.25;
const FIREWORK_COLORS = ['#ffd45a', '#ff6f61', '#7fd0ff', '#b98cff', '#8fe388'];
/** Falling snow: tiles of fx.snowfall (12 m) at this scale, this many a side, over the camera's point. */
const SNOW_TILE = 12;
const SNOW_SCALE = 1.5;
const SNOW_TILES = 3;
/** The toast stays this long (s); an opened crate this long before it goes. */
const TOAST_TIME = 8;
const CRATE_LINGER = 6;
/** A shut stall's parts: its awning and its wares (the v2 stall's apples), hidden. */
const STALL_SHUT = new Set(['awning', 'awning.mount', 'goods', 'apple', 'apple.fruit']);

interface Piece {
  dressing: Dressing;
  obj: THREE.Object3D;
  figure: Figure | null;
}

export class Festive {
  readonly #host: FestiveHost;
  #plan: FestivePlan;
  #occasions: Occasions = NO_OCCASIONS;
  #drop: Errand | null = null;
  #pieces: Piece[] = [];
  #snowfall: Piece[] = [];
  #fireworks: { figure: Figure; until: number }[] = [];
  #nextFirework = 0;
  #volley = 0;
  #popped = 0;
  #time = 0;
  #toast: { el: HTMLElement; until: number } | null = null;
  #crate: Piece | null = null;
  #crateGoes = 0;
  /** Stall parts hidden for the crash (shown again after). */
  #shut: THREE.Object3D[] = [];
  /** Each dressing call's number: a slower load for an older one is dropped. */
  #generation = 0;
  #has = new Map<string, boolean>();
  readonly #tinted = new Map<string, THREE.Material>();
  readonly #scratch = new THREE.Vector3();
  #disposed = false;

  constructor(host: FestiveHost, plan: FestivePlan) {
    this.#host = host;
    this.#plan = plan;
  }

  /** The occasions now, and the drop whose crate waits at the gate (null: none). The town is dressed again. */
  set(o: Occasions, drop: Errand | null): void {
    // the same as before (new data, the same day): nothing to do
    if (this.#generation > 0 && JSON.stringify(o) === JSON.stringify(this.#occasions) && drop?.key === this.#drop?.key) return;
    const anniversaryNow = o.anniversary !== null && this.#occasions.anniversary === null;
    this.#occasions = o;
    this.#drop = drop;
    if (anniversaryNow) this.#celebrate(o.anniversary!);
    void this.#dress();
  }

  /** The town laid out again (build mode): the dressing follows. */
  relayout(plan: FestivePlan): void {
    this.#plan = plan;
    void this.#dress();
  }

  async #dress(): Promise<void> {
    const generation = ++this.#generation;
    const o = this.#occasions;
    const wanted = planFestive(this.#plan, o, this.#drop !== null);
    const names = new Set(wanted.flatMap((d) => [d.name, ...(d.fallbacks ?? [])]));
    if (o.snow) names.add('fx.snowfall');
    if (o.festival || o.anniversary !== null) names.add('fx.firework');
    await Promise.all([...names].filter((n) => !this.#has.has(n)).map(async (n) => this.#has.set(n, await this.#host.load(n))));
    if (this.#disposed || generation !== this.#generation) return;
    this.#clear();
    for (const d of wanted) {
      const name = [d.name, ...(d.fallbacks ?? [])].find((n) => this.#has.get(n));
      if (!name) continue; // decoration waits for its model
      const obj = this.#host.make(name);
      if (d.part) showOnly(obj, d.part);
      obj.scale.setScalar(d.scale);
      obj.rotation.y = d.rot;
      obj.position.set(d.x, d.y, d.z);
      obj.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.receiveShadow = true;
      });
      // the dressing's own colours: festive ones taking turns along the avenue, the airdrop's ribbon gold
      const dressed = this.#pieces.length;
      if (name === 'prop.bunting' || name === 'prop.lantern.festival') this.#tint(obj, FESTIVE_COLORS[dressed % FESTIVE_COLORS.length]!, 'Tint');
      else if (name === 'prop.crate.airdrop') this.#tint(obj, '#e0a83a', 'Tint');
      const clips = this.#host.clips(name);
      const figure = clips.length ? new Figure(obj, clips, ['open']) : null;
      if (figure?.has('idle')) figure.play('idle');
      this.#host.add(obj);
      const piece = { dressing: d, obj, figure };
      this.#pieces.push(piece);
      if (d.occasion === 'crate') {
        obj.userData.crate = true;
        this.#crate = piece;
      }
    }
    if (o.snow) void this.#laySnow(generation);
    // falling snow over the view
    if (o.snow && this.#has.get('fx.snowfall')) {
      const clip = this.#host.clips('fx.snowfall');
      for (let i = 0; i < SNOW_TILES * SNOW_TILES; i++) {
        const obj = this.#host.make('fx.snowfall');
        obj.scale.setScalar(SNOW_SCALE);
        const figure = new Figure(obj, clip);
        figure.play('idle');
        this.#host.add(obj);
        this.#snowfall.push({ dressing: { name: 'fx.snowfall', x: 0, y: 0, z: 0, rot: 0, scale: SNOW_SCALE, occasion: 'snow' }, obj, figure });
      }
    }
    this.#shutStalls(o.storm);
  }

  /**
   * December's snow on the town: each piece that has a snow file
   * (`<asset>.snow`, docs/batches/29-winter.md) gets it laid on, as a child so
   * it sits exactly on its roofs; its tier parts' snow shows with the piece's.
   */
  async #laySnow(generation: number): Promise<void> {
    const pieces = this.#host.placed();
    const names = [...new Set(pieces.map((p) => p.name + SNOW))];
    await Promise.all(names.filter((n) => !this.#has.has(n)).map(async (n) => this.#has.set(n, await this.#host.load(n))));
    if (this.#disposed || generation !== this.#generation) return;
    for (const piece of pieces) {
      const name = piece.name + SNOW;
      if (!this.#has.get(name)) continue;
      const snow = this.#host.make(name);
      snow.traverse((o) => {
        const tier = /^tier\.?(\d)$/.exec((o.userData.name as string | undefined) ?? o.name);
        if (tier) o.visible = tierShown(piece, Number(tier[1]));
        if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
      });
      // under its `body`, so it bounces with the piece's tap
      (piece.getObjectByName('body') ?? piece).add(snow);
      this.#snowFiles.push(snow);
    }
  }

  /** The snow files laid on the town's pieces (taken off again with the season). */
  #snowFiles: THREE.Object3D[] = [];

  /** The stalls shut (their awnings and wares hidden) in a crash, open again after. */
  #shutStalls(shut: boolean): void {
    for (const o of this.#shut) o.visible = true;
    this.#shut = [];
    if (!shut) return;
    for (const stall of this.#host.stalls())
      stall.traverse((o) => {
        if (o !== stall && o.visible && STALL_SHUT.has((o.userData.name as string | undefined) ?? o.name)) {
          o.visible = false;
          this.#shut.push(o);
        }
      });
  }

  /** The guild's day: a toast, and a volley of fireworks. */
  #celebrate(years: number): void {
    this.#toast?.el.remove();
    const el = document.createElement('div');
    el.className = 'occasion-toast';
    el.setAttribute('role', 'status');
    el.textContent = `🎉 The guild's day: ${years === 1 ? 'a year' : `${years} years`} since its first transaction!`;
    this.#host.element.append(el);
    this.#toast = { el, until: this.#time + TOAST_TIME };
    this.#volley = VOLLEY;
    this.#nextFirework = this.#time + 0.5;
  }

  /** A tap on the crate (the raycaster set by the view): it opens and shows what came. Whether it was hit. */
  tap(raycaster: THREE.Raycaster): boolean {
    const crate = this.#crate;
    if (!crate) return false;
    if (!raycaster.intersectObject(crate.obj, true).length) return false;
    this.#openCrate();
    return true;
  }

  #openCrate(): void {
    const crate = this.#crate;
    const drop = this.#drop;
    if (!crate || !drop) return;
    // its lid flips open and stays open (a plain crate just shows what came)
    crate.figure?.play('open');
    this.#host.say(crate.obj, dropLine(drop));
    this.#host.opened?.(drop);
    // no crate when the town is dressed again
    this.#drop = null;
    this.#crate = null;
    this.#crateGoes = this.#time + CRATE_LINGER;
    crate.obj.userData.crate = false;
  }

  /** Test hook: opens the crate as a tap would (false: none waiting). */
  openCrate(): boolean {
    if (!this.#crate) return false;
    this.#openCrate();
    return true;
  }

  /** The crate's point to tap, in the world (null: none waiting). */
  get crateAt(): THREE.Vector3 | null {
    return this.#crate ? this.#crate.obj.getWorldPosition(new THREE.Vector3()).setY(0.5) : null;
  }

  update(dt: number): void {
    this.#time += dt;
    const t = this.#time;
    for (const p of this.#pieces) p.figure?.update(dt);
    // the opened crate goes after a while
    if (this.#crateGoes && t > this.#crateGoes) {
      this.#crateGoes = 0;
      const opened = this.#pieces.filter((p) => p.dressing.occasion === 'crate');
      for (const p of opened) this.#remove(p);
      this.#pieces = this.#pieces.filter((p) => !opened.includes(p));
    }
    // the falling snow keeps over the camera's point, in whole tiles (so it does not slide as the view pans)
    if (this.#snowfall.length) {
      const f = this.#host.focus();
      const step = SNOW_TILE * SNOW_SCALE;
      const cx = Math.round(f.x / step) * step;
      const cz = Math.round(f.z / step) * step;
      const half = (SNOW_TILES - 1) / 2;
      this.#snowfall.forEach((s, i) => {
        s.obj.position.set(cx + ((i % SNOW_TILES) - half) * step, 0, cz + (Math.floor(i / SNOW_TILES) - half) * step);
        s.figure?.update(dt);
      });
    }
    // fireworks: the guild's day any time, a festival from dusk
    const o = this.#occasions;
    const firing = this.#volley > 0 || o.anniversary !== null || (o.festival && this.#host.night() > DUSK);
    if (firing && t >= this.#nextFirework && this.#has.get('fx.firework')) {
      this.#firework();
      if (this.#volley > 0) this.#volley--;
      this.#nextFirework = t + (this.#volley > 0 ? 0.4 : FIREWORK_EVERY * (1 + Math.random()));
    }
    this.#fireworks = this.#fireworks.filter((f) => {
      f.figure.update(dt);
      if (t < f.until) return true;
      f.figure.object.removeFromParent();
      f.figure.dispose();
      return false;
    });
    if (this.#toast && t > this.#toast.until) {
      this.#toast.el.remove();
      this.#toast = null;
    }
  }

  /** One firework over the keep (the plaza without one), in a festive colour. */
  #firework(): void {
    const pop = this.#host.clips('fx.firework').find((c) => c.name === 'pop');
    if (!pop) return;
    const obj = this.#host.make('fx.firework');
    const keep = this.#host.keep();
    let top = 8;
    if (keep) {
      const box = new THREE.Box3().setFromObject(keep);
      box.getCenter(this.#scratch);
      top = box.max.y;
    } else this.#scratch.set(0, 0, (this.#plan.avenue.plazaStart + this.#plan.avenue.plazaEnd) / 2);
    obj.position.set(this.#scratch.x + (Math.random() - 0.5) * 2 * FIREWORK_SPREAD, top + FIREWORK_LIFT + Math.random() * 2, this.#scratch.z + (Math.random() - 0.5) * FIREWORK_SPREAD);
    this.#tint(obj, FIREWORK_COLORS[this.#popped % FIREWORK_COLORS.length]!);
    const figure = new Figure(obj, [pop], ['pop']);
    this.#host.add(obj);
    figure.react('pop', false);
    this.#fireworks.push({ figure, until: this.#time + pop.duration });
    this.#popped++;
  }

  /** A firework's Glow (or a dressing's Tint: bunting, lanterns, the crate's ribbon) in a colour (one copy per colour, kept). */
  #tint(root: THREE.Object3D, color: string, material = 'Glow'): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => {
        if (m.name !== material) return m;
        const key = `${m.uuid}|${color}`;
        let own = this.#tinted.get(key);
        if (!own) {
          own = m.clone();
          (own as THREE.MeshStandardMaterial).color?.set(color);
          if (material === 'Glow') (own as THREE.MeshStandardMaterial).emissive?.set(color);
          this.#tinted.set(key, own);
        }
        return own;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  /** Test hook: what is dressed now. */
  state(): { occasions: Occasions; planned: Record<string, number>; shown: Record<string, number>; snowfall: number; snowFiles: number; fireworks: number; crate: string | null; shut: number; toast: string | null } {
    const count = (list: Dressing[]) => list.reduce<Record<string, number>>((t, d) => ((t[d.name] = (t[d.name] ?? 0) + 1), t), {});
    return {
      occasions: this.#occasions,
      planned: count(planFestive(this.#plan, this.#occasions, this.#drop !== null)),
      shown: this.#pieces.reduce<Record<string, number>>((t, p) => ((t[p.obj.name] = (t[p.obj.name] ?? 0) + 1), t), {}),
      snowfall: this.#snowfall.length,
      snowFiles: this.#snowFiles.length,
      fireworks: this.#popped,
      crate: this.#crate ? (this.#drop?.key ?? null) : null,
      shut: this.#shut.length,
      toast: this.#toast?.el.textContent ?? null,
    };
  }

  #remove(p: Piece): void {
    p.obj.removeFromParent();
    p.figure?.dispose();
  }

  #clear(): void {
    for (const p of [...this.#pieces, ...this.#snowfall]) this.#remove(p);
    for (const snow of this.#snowFiles) snow.removeFromParent();
    this.#snowFiles = [];
    this.#pieces = [];
    this.#snowfall = [];
    this.#crate = null;
    this.#crateGoes = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.#clear();
    for (const f of this.#fireworks) {
      f.figure.object.removeFromParent();
      f.figure.dispose();
    }
    this.#fireworks = [];
    this.#shutStalls(false);
    this.#toast?.el.remove();
    // the models' geometry and materials belong to the view's library; the firework colours are ours
    for (const m of this.#tinted.values()) m.dispose();
    this.#tinted.clear();
  }
}

/** Shows one node of a model (and what is under it), hiding its siblings along the way up. */
function showOnly(root: THREE.Object3D, part: string): void {
  const named = (o: THREE.Object3D) => ((o.userData.name as string | undefined) ?? o.name) === part;
  let target: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!target && named(o)) target = o;
  });
  if (!target) return;
  for (let o: THREE.Object3D = target; o.parent && o !== root; o = o.parent) for (const sibling of o.parent.children) if (sibling !== o) sibling.visible = false;
}
