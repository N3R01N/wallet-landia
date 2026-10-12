/**
 * Build mode: the player raises their own town. A drawer lists what their
 * history unlocks (a home per wallet, a building per protocol), a building
 * picked from it follows the pointer over the town as a see-through ghost
 * (green where it may stand, red with the reason where not, with the road it
 * would get), and a click puts it up. What is built is saved at once (see
 * world/townLayout.ts for how a layout becomes a town).
 *
 * A building already up is selected with a click: then it can be moved (M,
 * or dragged), turned where it stands (R), or stored (Del). A building being
 * moved keeps its place in the order the town was built (so the other roads
 * stay as they were); nothing is saved until it is put down, and Esc puts it
 * back where it was. Every change can be undone (Ctrl+Z) and redone
 * (Ctrl+Shift+Z or Ctrl+Y) while the page is open.
 *
 * Keys while building: R turns (Shift+R the other way), M moves, Del stores,
 * Esc lets go (then leaves), B leaves.
 */

import { brandColor } from '../render/buildings.js';
import { buildingArt, buildingName } from '../assets/art.js';
import type { Guild } from '../domain/model.js';
import type { BuildGhost, WorldView } from '../render/view.js';
import type { Placed } from '../world/layout.js';
import { arrange, BuildPlanner, buildables, emptyLayout, type Buildable, type Land, type LayoutEntry, type Rot, type TownLayout } from '../world/townLayout.js';
import { el, safeHref } from './dom.js';

export interface BuildHost {
  /** The realm's guild, with every protocol its history ever showed (they may all be built). */
  guild(): Guild;
  layout(): TownLayout;
  /** Save this layout and raise the town from it. */
  setLayout(layout: TownLayout): void;
  land(): Land;
  view(): WorldView;
  /** A building up in town, as the views know it (for highlighting it). */
  placedOf(id: string): Placed | undefined;
  /** Build mode opened or closed, or what may be built changed (the header's count follows). */
  changed(): void;
}

type Tab = 'homes' | 'protocols' | 'placed';

/** Undo reaches this far back. */
const HISTORY = 100;

export class BuildMode {
  /** The drawer (mounted by the layout; hidden while not building). */
  readonly drawer = el('aside', { class: 'build-drawer panel', 'aria-label': 'Build your town', hidden: '' });
  #open = false;
  #tab: Tab = 'homes';
  #search = '';
  /** In hand: a building to put up, or (`moving`) one already up being moved. */
  #held: { id: string; rot: Rot; moving: boolean } | null = null;
  /** Picked up by dragging it: put down where the drag ends. */
  #dragging = false;
  #at: { x: number; y: number } | null = null;
  /** A building up in town, selected to move, turn or store. */
  #selected: string | null = null;
  #planner: BuildPlanner | null = null;
  #past: TownLayout[] = [];
  #future: TownLayout[] = [];
  readonly #host: BuildHost;
  /** What the drawer says about the last try (why it may not stand there). */
  readonly #hint = el('div', { class: 'build-hint', role: 'status', 'aria-live': 'polite' });

  constructor(host: BuildHost) {
    this.#host = host;
  }

  get open(): boolean {
    return this.#open;
  }

  holding(): boolean {
    return this.#open && this.#held !== null;
  }

  /** How many buildings may be built but are not yet (the Build button's count). */
  unbuilt(): number {
    const placed = new BuildPlanner(this.#host.guild(), this.#host.layout()).placed;
    return buildables(this.#host.guild()).filter((b) => !placed.has(b.id)).length;
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.enter();
  }

  enter(): void {
    this.#open = true;
    this.#planner = null;
    // homes first while there are any to build, else the protocols
    const placed = this.#planner_().placed;
    this.#tab = buildables(this.#host.guild()).some((b) => b.kind === 'home' && !placed.has(b.id)) ? 'homes' : 'protocols';
    this.drawer.hidden = false;
    this.#render();
    this.#overlay();
    this.#host.changed();
  }

  close(): void {
    this.#open = false;
    this.#held = null;
    this.#dragging = false;
    this.#at = null;
    this.#select(null);
    this.drawer.hidden = true;
    this.#host.view().build = null;
    this.#host.changed();
  }

  /** The town was raised again (a new layout, new history, another realm): try against the new one. */
  refresh(): void {
    this.#planner = null;
    if (!this.#open) return;
    // a selection that is no longer up goes
    if (this.#selected !== null && !this.#planner_().placed.has(this.#selected)) this.#selected = null;
    // (a new plan holds new buildings: point the highlight at the new one)
    const placed = this.#selected === null ? undefined : this.#host.placedOf(this.#selected);
    if (placed !== undefined) this.#host.view().selected = { kind: 'building', placed };
    this.#render();
    this.#overlay();
  }

  /** The pointer is over the town: the building in hand follows it. */
  move(sx: number, sy: number): void {
    const p = this.#host.view().groundAt(sx, sy);
    const held = this.#held;
    if (p === null || held === null) return;
    const what = this.#buildable(held.id);
    if (what === undefined) return;
    // the pointer holds the footprint by its middle
    const at = { x: Math.round(p.x - what.w / 2), y: Math.round(p.y - what.h / 2) };
    if (this.#at !== null && this.#at.x === at.x && this.#at.y === at.y) return;
    this.#at = at;
    this.#overlay();
  }

  /**
   * A click on the town while building (true: it was build mode's). With a
   * building in hand: put it down. Else: select the building of yours under
   * the pointer (or nothing).
   */
  click(sx: number, sy: number, keep: boolean): boolean {
    if (!this.#open) return false;
    if (this.#held === null) {
      this.#select(this.#builtAt(sx, sy));
      return true;
    }
    this.move(sx, sy);
    this.#putDown(keep);
    return true;
  }

  /** The pointer goes down on the town: on the selected building, it is picked up to be dragged (true: build mode's). */
  press(sx: number, sy: number): boolean {
    if (!this.#open || this.#held !== null || this.#selected === null) return false;
    if (this.#builtAt(sx, sy) !== this.#selected) return false;
    this.#pickUp(this.#selected);
    this.#dragging = true;
    this.move(sx, sy);
    return true;
  }

  /** The drag ends: put it down there, or (where it cannot stand) back where it was. */
  release(sx: number, sy: number): void {
    if (!this.#dragging) return;
    this.#dragging = false;
    this.move(sx, sy);
    if (!this.#putDown(false)) this.#letGo();
  }

  dragging(): boolean {
    return this.#dragging;
  }

  key(e: KeyboardEvent): boolean {
    if (!this.#open) return false;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) return this.#undo();
      if ((k === 'z' && e.shiftKey) || k === 'y') return this.#redo();
      return false;
    }
    if (e.altKey) return false;
    if (k === 'r') {
      const turn = (r: Rot): Rot => ((r + (e.shiftKey ? 3 : 1)) % 4) as Rot;
      if (this.#held !== null) {
        this.#held = { ...this.#held, rot: turn(this.#held.rot) };
        this.#overlay();
        return true;
      }
      if (this.#selected !== null) {
        this.#turnInPlace(this.#selected, turn);
        return true;
      }
      return false;
    }
    if (k === 'm' && this.#selected !== null && this.#held === null) {
      this.#pickUp(this.#selected);
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.#selected !== null && this.#held === null) {
      this.#store(this.#selected);
      return true;
    }
    if (e.key === 'Escape') {
      if (this.#held !== null) this.#letGo();
      else if (this.#selected !== null) this.#select(null);
      else this.close();
      return true;
    }
    return false;
  }

  // --- changing the town ------------------------------------------------------------

  /** Save a new layout, remembering the old one for Undo. */
  #commit(layout: TownLayout): void {
    this.#past = [...this.#past, this.#host.layout()].slice(-HISTORY);
    this.#future = [];
    this.#apply(layout);
  }

  #apply(layout: TownLayout): void {
    this.#planner = null;
    this.#host.setLayout(layout);
    this.#render();
    this.#overlay();
  }

  #undo(): boolean {
    const prev = this.#past.at(-1);
    if (prev === undefined) return true;
    this.#past = this.#past.slice(0, -1);
    this.#future = [this.#host.layout(), ...this.#future];
    this.#held = null;
    this.#hint.textContent = 'Undone.';
    this.#apply(prev);
    return true;
  }

  #redo(): boolean {
    const next = this.#future[0];
    if (next === undefined) return true;
    this.#future = this.#future.slice(1);
    this.#past = [...this.#past, this.#host.layout()];
    this.#held = null;
    this.#hint.textContent = 'Redone.';
    this.#apply(next);
    return true;
  }

  /** Put what is in hand down where the pointer is (false: it may not stand there; it stays in hand). */
  #putDown(keep: boolean): boolean {
    const held = this.#held;
    const at = this.#at;
    if (held === null || at === null) return false;
    const pre = this.#planner_().preview(held.id, at.x, at.y, held.rot, this.#host.land());
    if (!pre.ok) {
      this.#hint.textContent = pre.reason ?? '';
      this.#hint.classList.add('bad');
      return false;
    }
    const entry: LayoutEntry = { id: held.id, x: at.x, y: at.y, rot: held.rot };
    const layout = this.#host.layout();
    // a building moved keeps its place in the order the town was built: the others' roads stay
    const placed = held.moving ? layout.placed.map((e) => (e.id === held.id ? entry : e)) : [...layout.placed, entry];
    // Shift: the next one of the same kind in hand (homes after a home, buildings after a building)
    const next = keep && !held.moving ? this.#next(held.id) : undefined;
    this.#held = next === undefined ? null : { id: next.id, rot: held.rot, moving: false };
    this.#hint.textContent = '';
    this.#hint.classList.remove('bad');
    if (held.moving) this.#selected = held.id;
    this.#commit({ v: 1, placed });
    return true;
  }

  /** Let go of what is in hand: a new one goes back to the list, a moved one stays where it was. */
  #letGo(): void {
    const was = this.#held;
    this.#held = null;
    this.#dragging = false;
    this.#planner = null;
    this.#hint.textContent = '';
    this.#hint.classList.remove('bad');
    if (was?.moving === true) this.#selected = was.id;
    this.#render();
    this.#overlay();
  }

  #pickUp(id: string): void {
    const e = this.#entry(id);
    if (e === undefined) return;
    this.#held = { id, rot: e.rot, moving: true };
    this.#at = { x: e.x, y: e.y };
    this.#planner = null;
    this.#hint.classList.remove('bad');
    this.#hint.textContent = 'Move it where it should stand and click · R to turn · Esc to leave it where it was';
    this.#render();
    this.#overlay();
  }

  #turnInPlace(id: string, turn: (r: Rot) => Rot): void {
    const e = this.#entry(id);
    if (e === undefined) return;
    const rot = turn(e.rot);
    const planner = new BuildPlanner(this.#host.guild(), { v: 1, placed: this.#host.layout().placed.filter((x) => x.id !== id) });
    const pre = planner.preview(id, e.x, e.y, rot, this.#host.land());
    if (!pre.ok) {
      this.#hint.textContent = `It cannot face that way here: ${pre.reason ?? ''}`;
      this.#hint.classList.add('bad');
      return;
    }
    this.#hint.textContent = '';
    this.#hint.classList.remove('bad');
    this.#commit({ v: 1, placed: this.#host.layout().placed.map((x) => (x.id === id ? { ...x, rot } : x)) });
  }

  #store(id: string): void {
    if (this.#selected === id) this.#select(null);
    this.#commit({ v: 1, placed: this.#host.layout().placed.filter((e) => e.id !== id) });
  }

  #select(id: string | null): void {
    this.#selected = id;
    const placed = id === null ? undefined : this.#host.placedOf(id);
    this.#host.view().selected = placed === undefined ? null : { kind: 'building', placed };
    if (this.#open) this.#render();
  }

  // --- what is drawn over the town -------------------------------------------

  #overlay(): void {
    const view = this.#host.view();
    if (!this.#open) {
      view.build = null;
      return;
    }
    const land = this.#host.land();
    const held = this.#held;
    const what = held === null ? undefined : this.#buildable(held.id);
    let ghost: BuildGhost | null = null;
    if (held !== null && what !== undefined && this.#at !== null) {
      const pre = this.#planner_().preview(held.id, this.#at.x, this.#at.y, held.rot, land);
      ghost = { kind: what.kind, x: this.#at.x, y: this.#at.y, w: what.w, h: what.h, rot: held.rot, door: pre.door, road: pre.road, ok: pre.ok };
      if (what.protocolId !== undefined) ghost.protocolId = what.protocolId;
      if (what.heroAddress !== undefined) ghost.heroAddress = what.heroAddress;
      this.#hint.textContent = pre.ok ? `${this.#name(what)}: click to ${held.moving ? 'put it' : 'build'} here · R to turn${pre.road.length > 0 ? ' · a road will lead to its door' : ''}` : (pre.reason ?? '');
      this.#hint.classList.toggle('bad', !pre.ok);
    }
    view.build = { land, ghost };
  }

  /** The town to try against: as built, without the building being moved. */
  #planner_(): BuildPlanner {
    if (this.#planner === null) {
      const layout = this.#host.layout();
      const moving = this.#held?.moving === true ? this.#held.id : null;
      this.#planner = new BuildPlanner(this.#host.guild(), moving === null ? layout : { v: 1, placed: layout.placed.filter((e) => e.id !== moving) });
    }
    return this.#planner;
  }

  // --- the drawer ----------------------------------------------------------------

  /**
   * Which of your buildings stands on the ground under the pointer (by its
   * footprint, not by what is drawn on top: a hero at the door, a sign).
   */
  #builtAt(sx: number, sy: number): string | null {
    const p = this.#host.view().groundAt(sx, sy);
    if (p === null) return null;
    for (const e of this.#host.layout().placed) {
      const b = this.#host.placedOf(e.id);
      if (b !== undefined && p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) return e.id;
    }
    return null;
  }

  #entry(id: string): LayoutEntry | undefined {
    return this.#host.layout().placed.find((e) => e.id === id);
  }

  #buildable(id: string): Buildable | undefined {
    return buildables(this.#host.guild()).find((b) => b.id === id);
  }

  #name(b: Buildable): string {
    const g = this.#host.guild();
    if (b.heroAddress !== undefined) return `${g.heroes.find((h) => h.address === b.heroAddress)?.name ?? 'A hero'}'s home`;
    return g.protocols.get(b.protocolId ?? '')?.name ?? b.id;
  }

  /** The next unbuilt one of the same kind (home or protocol building) after this one. */
  #next(id: string): Buildable | undefined {
    const placed = this.#planner_().placed;
    const home = id.startsWith('home:');
    return buildables(this.#host.guild()).find((b) => b.id !== id && b.id.startsWith('home:') === home && !placed.has(b.id));
  }

  #render(): void {
    const g = this.#host.guild();
    const all = buildables(g);
    const placed = this.#planner_().placed;
    const land = this.#host.land();
    const homes = all.filter((b) => b.kind === 'home');
    const protocols = all.filter((b) => b.kind !== 'home');
    const tab = (t: Tab, label: string, n: number): HTMLElement => {
      const b = el('button', { class: `btn tab${this.#tab === t ? ' on' : ''}`, role: 'tab', 'aria-selected': String(this.#tab === t) }, `${label} (${n})`);
      b.onclick = () => {
        this.#tab = t;
        this.#render();
      };
      return b;
    };
    const unbuilt = (list: Buildable[]): number => list.filter((b) => !placed.has(b.id)).length;
    const search = el('input', { type: 'search', placeholder: 'Find a building…', 'aria-label': 'Find a building', value: this.#search });
    search.oninput = () => {
      this.#search = search.value;
      this.#renderList(list, placed);
    };
    const list = el('div', { class: 'build-list', role: 'list' });
    this.#renderList(list, placed);

    const undo = el('button', { class: 'btn small', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, '↶');
    undo.disabled = this.#past.length === 0;
    undo.onclick = () => this.#undo();
    const redo = el('button', { class: 'btn small', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo' }, '↷');
    redo.disabled = this.#future.length === 0;
    redo.onclick = () => this.#redo();
    const auto = el('button', { class: 'btn', title: 'Put up everything not built yet, where the classic town has it (on your land)' }, '✨ Arrange the rest for me');
    auto.onclick = () => {
      this.#held = null;
      this.#commit(arrange(g, this.#host.layout(), land));
    };
    const clear = el('button', { class: 'btn', title: 'Take every building down (they stay in this list)' }, '🧹 Clear the town');
    clear.onclick = () => {
      if (!window.confirm('Take every building down? They stay here to build again (and Undo brings them back).')) return;
      this.#held = null;
      this.#select(null);
      this.#commit(emptyLayout());
    };
    const done = el('button', { class: 'btn primary' }, 'Done');
    done.onclick = () => this.close();

    const w = land.x1 - land.x0;
    const h = land.y1 - land.y0;
    const parts: HTMLElement[] = [
      el('div', { class: 'build-head' }, el('h3', {}, '🔨 Build your town'), el('div', { class: 'form-row' }, undo, redo, done)),
      el('p', { class: 'muted small' }, `Your land: ${w}×${h} tiles${land.nextAt !== null ? ` · more at level ${land.nextAt}` : ' · all of it'}. Pick a building, then click where it should stand. Click one in town to move, turn or store it.`),
      this.#selectedBox() as HTMLElement,
      el('div', { class: 'tabs', role: 'tablist' }, tab('homes', 'Homes', unbuilt(homes)), tab('protocols', 'Buildings', unbuilt(protocols)), tab('placed', 'Built', placed.size)),
      search,
      list,
      this.#hint,
      el('div', { class: 'form-row build-foot' }, auto, clear),
    ].filter((x): x is HTMLElement => x !== null);
    this.drawer.replaceChildren(...parts);
  }

  /** The building selected in town, and what can be done with it. */
  #selectedBox(): HTMLElement | null {
    const id = this.#selected;
    const what = id === null ? undefined : this.#buildable(id);
    if (id === null || what === undefined) return null;
    const moving = this.#held?.moving === true && this.#held.id === id;
    const move = el('button', { class: 'btn small', title: 'Move it (M), or drag it' }, moving ? 'Moving…' : '✥ Move');
    move.disabled = moving;
    move.onclick = () => this.#pickUp(id);
    const turn = el('button', { class: 'btn small', title: 'Turn it where it stands (R)' }, '↻ Turn');
    turn.onclick = () => this.#turnInPlace(id, (r) => ((r + 1) % 4) as Rot);
    const store = el('button', { class: 'btn small', title: 'Take it down (Del): it comes back to the list' }, '📦 Store');
    store.onclick = () => this.#store(id);
    const deselect = el('button', { class: 'btn small', 'aria-label': 'Deselect' }, '✕');
    deselect.onclick = () => this.#select(null);
    return el('div', { class: 'build-selected' }, el('div', { class: 'build-selected-head' }, el('strong', {}, this.#name(what)), deselect), el('div', { class: 'form-row' }, move, turn, store));
  }

  #renderList(list: HTMLElement, placed: ReadonlySet<string>): void {
    const g = this.#host.guild();
    const q = this.#search.trim().toLowerCase();
    // (one being moved still counts as built)
    const isBuilt = (id: string): boolean => placed.has(id) || (this.#held?.moving === true && this.#held.id === id);
    const all = buildables(g).filter((b) => (this.#tab === 'homes' ? b.kind === 'home' && !isBuilt(b.id) : this.#tab === 'protocols' ? b.kind !== 'home' && !isBuilt(b.id) : isBuilt(b.id)));
    const shown = all.filter((b) => q === '' || this.#name(b).toLowerCase().includes(q) || (b.kind !== 'home' && buildingName(b.kind).toLowerCase().includes(q)));
    // the most visited first: the places that matter most to this history
    const visits = (b: Buildable): number => g.protocols.get(b.protocolId ?? '')?.visits ?? 0;
    shown.sort((a, b) => visits(b) - visits(a) || this.#name(a).localeCompare(this.#name(b)));
    if (shown.length === 0) {
      list.replaceChildren(el('p', { class: 'muted' }, this.#tab === 'placed' ? 'Nothing built yet.' : q !== '' ? 'Nothing by that name.' : 'All built. New ones arrive as your history grows.'));
      return;
    }
    list.replaceChildren(...shown.map((b) => this.#card(b, isBuilt(b.id))));
  }

  #card(b: Buildable, built: boolean): HTMLElement {
    const g = this.#host.guild();
    const protocol = b.protocolId !== undefined ? g.protocols.get(b.protocolId) : undefined;
    const hero = b.heroAddress !== undefined ? g.heroes.find((h) => h.address === b.heroAddress) : undefined;
    const held = this.#held?.id === b.id;
    const sub = b.kind === 'home' ? `Home · ${hero?.label || 'your wallet'}` : `${buildingName(b.kind)}${protocol && protocol.visits > 0 ? ` · ${protocol.visits} visit${protocol.visits === 1 ? '' : 's'}` : ''}`;
    const logo = protocol?.iconUrl && safeHref(protocol.iconUrl) !== null ? el('img', { class: 'logo', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : null;
    if (logo && protocol?.iconUrl) logo.src = protocol.iconUrl;
    const card = el(
      'div',
      { class: `build-card${held ? ' held' : ''}${built ? ' built' : ''}${this.#selected === b.id ? ' selected' : ''}`, role: 'listitem', 'data-build': b.id },
      thumb(b, hero?.tier ?? 0),
      el('div', { class: 'build-card-text' }, el('strong', {}, this.#name(b)), el('span', { class: 'muted small' }, sub)),
      logo,
    );
    if (built) {
      const pick = el('button', { class: 'btn small', title: 'Select it in town (to move, turn or store it)' }, 'Select');
      pick.onclick = () => this.#select(b.id);
      const store = el('button', { class: 'btn small', title: 'Take it down (it comes back to this list)' }, '📦 Store');
      store.onclick = () => this.#store(b.id);
      card.append(el('div', { class: 'form-row' }, pick, store));
    } else {
      const pick = el('button', { class: 'btn small' }, held ? 'In hand' : 'Build');
      pick.onclick = () => {
        this.#held = held ? null : { id: b.id, rot: 0, moving: false };
        this.#at = null;
        this.#planner = null;
        this.#hint.classList.remove('bad');
        this.#hint.textContent = this.#held === null ? '' : 'Move over the town and click where it should stand · R to turn · Esc to put it down';
        this.#render();
        this.#overlay();
      };
      card.append(pick);
    }
    return card;
  }
}

/** The building as the top-down town draws it, small, for its card. */
function thumb(b: Buildable, tier: number): HTMLElement {
  const s = buildingArt('top', b.kind, b.w, b.h, b.protocolId !== undefined ? brandColor(b.protocolId) : '#a0522d', tier as 0, '');
  const c = el('canvas', { class: 'build-thumb', width: String(s.canvas.width), height: String(s.canvas.height), 'aria-hidden': 'true' });
  c.getContext('2d')?.drawImage(s.canvas, 0, 0);
  return c;
}
