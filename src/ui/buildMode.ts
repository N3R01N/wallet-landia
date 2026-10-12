/**
 * Build mode: the player raises their own town. A drawer lists what their
 * history unlocks (a home per wallet, a building per protocol), a building
 * picked from it follows the pointer over the town as a see-through ghost
 * (green where it may stand, red with the reason where not, with the road it
 * would get), and a click puts it up. What is built is saved at once (see
 * world/townLayout.ts for how a layout becomes a town).
 *
 * Keys while building: R turns the building in hand, Esc puts it down (then
 * leaves build mode), B leaves.
 */

import { brandColor } from '../render/buildings.js';
import { buildingArt, buildingName } from '../assets/art.js';
import type { Guild } from '../domain/model.js';
import type { BuildGhost, WorldView } from '../render/view.js';
import { arrange, BuildPlanner, buildables, emptyLayout, type Buildable, type Land, type Rot, type TownLayout } from '../world/townLayout.js';
import { el, safeHref } from './dom.js';

export interface BuildHost {
  /** The realm's guild, with every protocol its history ever showed (they may all be built). */
  guild(): Guild;
  layout(): TownLayout;
  /** Save this layout and raise the town from it. */
  setLayout(layout: TownLayout): void;
  land(): Land;
  view(): WorldView;
  /** Build mode opened or closed, or what may be built changed (the header's count follows). */
  changed(): void;
}

type Tab = 'homes' | 'protocols' | 'placed';

export class BuildMode {
  /** The drawer (mounted by the layout; hidden while not building). */
  readonly drawer = el('aside', { class: 'build-drawer panel', 'aria-label': 'Build your town', hidden: '' });
  #open = false;
  #tab: Tab = 'homes';
  #search = '';
  #held: { id: string; rot: Rot } | null = null;
  #at: { x: number; y: number } | null = null;
  #planner: BuildPlanner | null = null;
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
    const placed = this.#placedIds();
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
    const placed = this.#placedIds();
    this.#tab = buildables(this.#host.guild()).some((b) => b.kind === 'home' && !placed.has(b.id)) ? 'homes' : 'protocols';
    this.drawer.hidden = false;
    this.#render();
    this.#overlay();
    this.#host.changed();
  }

  close(): void {
    this.#open = false;
    this.#held = null;
    this.#at = null;
    this.drawer.hidden = true;
    this.#host.view().build = null;
    this.#host.changed();
  }

  /** The town was raised again (a new layout, new history, another realm): try against the new one. */
  refresh(): void {
    this.#planner = null;
    if (!this.#open) return;
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

  /** A click on the town while building: put up what is in hand (true: it was build mode's). */
  click(sx: number, sy: number, keep: boolean): boolean {
    if (!this.#open) return false;
    if (this.#held === null) return false;
    this.move(sx, sy);
    const held = this.#held;
    const at = this.#at;
    if (at === null) return true;
    const pre = this.#planner_().preview(held.id, at.x, at.y, held.rot, this.#host.land());
    if (!pre.ok) {
      this.#hint.textContent = pre.reason ?? '';
      return true;
    }
    const layout = this.#host.layout();
    this.#host.setLayout({ v: 1, placed: [...layout.placed, { id: held.id, x: at.x, y: at.y, rot: held.rot }] });
    this.#planner = null;
    // Shift: the next one of the same kind in hand (homes after a home, buildings after a building)
    const next = keep ? this.#next(held.id) : undefined;
    this.#held = next === undefined ? null : { id: next.id, rot: held.rot };
    this.#hint.textContent = '';
    this.#render();
    this.#overlay();
    return true;
  }

  key(e: KeyboardEvent): boolean {
    if (!this.#open) return false;
    if (e.key === 'r' || e.key === 'R') {
      if (this.#held === null) return false;
      this.#held = { ...this.#held, rot: ((this.#held.rot + (e.shiftKey ? 3 : 1)) % 4) as Rot };
      this.#overlay();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.#held !== null) {
        this.#held = null;
        this.#hint.textContent = '';
        this.#render();
        this.#overlay();
      } else this.close();
      return true;
    }
    return false;
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
      this.#hint.textContent = pre.ok ? `${this.#name(what)}: click to build here · R to turn${pre.road.length > 0 ? ' · a road will lead to its door' : ''}` : (pre.reason ?? '');
      this.#hint.classList.toggle('bad', !pre.ok);
    }
    view.build = { land, ghost };
  }

  #planner_(): BuildPlanner {
    this.#planner ??= new BuildPlanner(this.#host.guild(), this.#host.layout());
    return this.#planner;
  }

  // --- the drawer ----------------------------------------------------------------

  #placedIds(): Set<string> {
    return new Set(new BuildPlanner(this.#host.guild(), this.#host.layout()).placed);
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

    const auto = el('button', { class: 'btn', title: 'Put up everything not built yet, where the classic town has it (on your land)' }, '✨ Arrange the rest for me');
    auto.onclick = () => {
      this.#host.setLayout(arrange(g, this.#host.layout(), land));
      this.#planner = null;
      this.#render();
      this.#overlay();
    };
    const clear = el('button', { class: 'btn', title: 'Take every building down (they stay in this list)' }, '🧹 Clear the town');
    clear.onclick = () => {
      if (!window.confirm('Take every building down? They stay here to build again.')) return;
      this.#held = null;
      this.#host.setLayout(emptyLayout());
      this.#planner = null;
      this.#render();
      this.#overlay();
    };
    const done = el('button', { class: 'btn primary' }, 'Done');
    done.onclick = () => this.close();

    const w = land.x1 - land.x0;
    const h = land.y1 - land.y0;
    this.drawer.replaceChildren(
      el('div', { class: 'build-head' }, el('h3', {}, '🔨 Build your town'), done),
      el('p', { class: 'muted small' }, `Your land: ${w}×${h} tiles${land.nextAt !== null ? ` · more at level ${land.nextAt}` : ' · all of it'}. Pick a building, then click where it should stand.`),
      el('div', { class: 'tabs', role: 'tablist' }, tab('homes', 'Homes', unbuilt(homes)), tab('protocols', 'Buildings', unbuilt(protocols)), tab('placed', 'Built', placed.size)),
      search,
      list,
      this.#hint,
      el('div', { class: 'form-row build-foot' }, auto, clear),
    );
  }

  #renderList(list: HTMLElement, placed: ReadonlySet<string>): void {
    const g = this.#host.guild();
    const q = this.#search.trim().toLowerCase();
    const all = buildables(g).filter((b) => (this.#tab === 'homes' ? b.kind === 'home' && !placed.has(b.id) : this.#tab === 'protocols' ? b.kind !== 'home' && !placed.has(b.id) : placed.has(b.id)));
    const shown = all.filter((b) => q === '' || this.#name(b).toLowerCase().includes(q) || (b.kind !== 'home' && buildingName(b.kind).toLowerCase().includes(q)));
    // the most visited first: the places that matter most to this history
    const visits = (b: Buildable): number => g.protocols.get(b.protocolId ?? '')?.visits ?? 0;
    shown.sort((a, b) => visits(b) - visits(a) || this.#name(a).localeCompare(this.#name(b)));
    if (shown.length === 0) {
      list.replaceChildren(el('p', { class: 'muted' }, this.#tab === 'placed' ? 'Nothing built yet.' : q !== '' ? 'Nothing by that name.' : 'All built. New ones arrive as your history grows.'));
      return;
    }
    list.replaceChildren(...shown.map((b) => this.#card(b, placed.has(b.id))));
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
      { class: `build-card${held ? ' held' : ''}${built ? ' built' : ''}`, role: 'listitem', 'data-build': b.id },
      thumb(b, hero?.tier ?? 0),
      el('div', { class: 'build-card-text' }, el('strong', {}, this.#name(b)), el('span', { class: 'muted small' }, sub)),
      logo,
    );
    if (built) {
      const store = el('button', { class: 'btn small', title: 'Take it down (it comes back to this list)' }, '📦 Store');
      store.onclick = () => {
        const layout = this.#host.layout();
        this.#host.setLayout({ v: 1, placed: layout.placed.filter((e) => e.id !== b.id) });
        this.#planner = null;
        this.#render();
        this.#overlay();
      };
      card.append(store);
    } else {
      const pick = el('button', { class: 'btn small' }, held ? 'In hand' : 'Build');
      pick.onclick = () => {
        this.#held = held ? null : { id: b.id, rot: 0 };
        this.#at = null;
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
