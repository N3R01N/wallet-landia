/**
 * The app: one Sim, one Renderer that can switch projection, and the DOM
 * around them. Everything runs in the browser.
 */

import { buildGuild, type HistoryWindow } from '../domain/mappers.js';
import { CLASS_LABEL, type Guild, type HeroClass, type Journey } from '../domain/model.js';
import { TIER_COLORS, TIER_FLOORS, TIER_NAMES, approxUsd } from '../domain/tiers.js';
import type { RawWallet } from '../data/zerion/endpoints.js';
import { Session, type Shown } from '../data/session.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { guildPanel } from './guildPanel.js';
import { looksPanel } from './looksPanel.js';
import { assets } from '../assets/registry.js';
import { loadBundledPacks, loadImportedPacks } from '../assets/packs.js';
import { startHeartbeat, type BlockBeat } from '../data/rpc.js';
import { buildingName } from '../assets/art.js';
import { planTown } from '../world/layout.js';
import { Sim } from '../world/sim.js';
import { Renderer } from '../render/renderer.js';
import type { HitTarget, ViewKind, WorldView } from '../render/view.js';
import { loadPrefs, savePrefs, type Prefs } from '../settings.js';
import { el, fmtDate } from './dom.js';
import { buildingPanel, heroPanel, questLogRow, questPanel, type PanelContext } from './panels.js';

const SPEEDS = [0.5, 1, 2, 4, 8];

export class App {
  readonly element: HTMLElement;
  #raws: RawWallet[];
  #names: Map<string, string> = new Map();
  #session: Session;
  #shown: Shown | null = null;
  #prefs: Prefs;
  #sourceEl = el('span', { class: 'muted' }, 'Loading…');
  #statusEl = el('span', { class: 'status' });
  #inkEl = el('button', { class: 'btn ink', title: 'Zerion requests left today — open the Guild panel' }, '');
  #homeBtn = el('button', { class: 'btn', hidden: '' }, '⌂ Return home');
  #budget: BudgetSnapshot | null = null;
  #set3dQuality: ((q: Prefs['quality']) => void) | null = null;
  #bookmark: (() => void) | null = null;
  #guildOpen = false;
  #looksOpen = false;
  #guild!: Guild;
  #sim!: Sim;
  /** The view currently on screen. */
  #renderer: WorldView;
  #r2d: Renderer;
  /** Created on first use: `three` is only downloaded when someone opens 3D. */
  #r3d: WorldView | null = null;
  #canvas = el('canvas', { class: 'stage' });
  #stage = el('div', { class: 'stage-wrap' });
  #inspector = el('aside', { class: 'inspector', hidden: '' });
  #inspectorBody = el('div', {});
  #log = el('div', { class: 'questlog-list' });
  #tooltip = el('div', { class: 'tooltip', hidden: '' });
  #scrub = el('input', { type: 'range', min: '0', max: '100', step: '0.05', value: '0', 'aria-label': 'Timeline' });
  #playBtn = el('button', { class: 'btn', title: 'Play / pause (space)' }, '❚❚');
  #dateLabel = el('span', { class: 'date' }, '');
  #modeLabel = el('span', { class: 'mode' }, '');
  #beatLabel = el('span', { class: 'beat muted' }, 'listening for the bell…');
  #viewBtns = new Map<ViewKind, HTMLButtonElement>();
  #speedBtns = new Map<number, HTMLButtonElement>();
  #beat: BlockBeat | null = null;
  #scrubbing = false;
  #logCount = -1;
  #selectedKey = '';

  constructor() {
    this.#raws = [];
    this.#prefs = loadPrefs();
    this.#session = new Session(this.#prefs, {
      onTown: (shown) => this.#onTown(shown),
      onUpdate: (shown) => this.#onUpdate(shown),
      onStatus: (text, kind) => {
        this.#statusEl.textContent = text;
        this.#statusEl.className = `status ${kind}`;
      },
      onBudget: (snap) => this.#onBudget(snap),
    });
    this.#onBudget(this.#session.budget.snapshot());
    this.#rebuild();
    this.#r2d = new Renderer(this.#canvas, this.#sim);
    this.#r2d.classOf = (a) => this.#classOf(a);
    this.#renderer = this.#r2d;
    this.#stage.append(this.#canvas);
    this.element = this.#layout();
    this.#bindInput();
    void this.#setView(this.#prefs.view, false);
    startHeartbeat((beat) => {
      this.#beat = beat;
      this.#sim.bell(beat.number, beat.busy);
      void this.#session.onBlock();
      this.#beatLabel.textContent = `🔔 block #${beat.number.toLocaleString('en-US')} · ${beat.txCount} txs · base toll ${beat.baseFeeGwei?.toFixed(2) ?? '?'} gwei`;
    });
  }

  start(): void {
    void this.#session.home();
    // Asset packs: restore the loadout, then load packs (bundled and imported).
    assets.setLoadout(this.#prefs.loadout);
    let rebuild: ReturnType<typeof setTimeout> | undefined;
    let packCount = assets.packs.size;
    assets.onChange(() => {
      // Packs arriving (or removed) while the Looks panel is open: show them.
      if (assets.packs.size !== packCount) {
        packCount = assets.packs.size;
        if (this.#looksOpen) this.#openLooks();
      }
      // Sprites re-resolve every frame; 3D meshes need a (debounced) rebuild.
      clearTimeout(rebuild);
      rebuild = setTimeout(() => this.#r3d?.setSim(this.#sim), 200);
    });
    void loadBundledPacks().then(() => loadImportedPacks()).catch((e: unknown) => console.warn('packs', e));
    if (new URLSearchParams(location.search).has('freeze')) this.#sim.playing = false;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      this.#sim.step(dt);
      this.#renderer.draw();
      this.#tick();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  #classOf(address: string): HeroClass {
    const override = this.#prefs.classOverrides[address];
    if (override !== undefined) return override;
    return this.#guild.heroes.find((h) => h.address === address)?.suggestedClass ?? 'adventurer';
  }

  #rebuild(): void {
    this.#guild = buildGuild(this.#raws, this.#prefs.window, { names: this.#names });
    const plan = planTown(this.#guild);
    this.#sim = new Sim(this.#guild, plan);
    this.#sim.speed = this.#prefs.speed;
    this.#logCount = -1;
  }

  #onTown(shown: Shown): void {
    this.#shown = shown;
    this.#raws = shown.raws;
    this.#names = shown.names;
    this.#sourceEl.textContent = shown.label;
    this.#homeBtn.hidden = shown.visiting === null;
    this.#rebuild();
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    if (this.#beat) this.#sim.bell(this.#beat.number, this.#beat.busy);
    if (this.#guildOpen) {
      // Refresh the Guild panel for the new town, unless the player is typing
      // in it: replacing the form would throw away what they typed.
      if (!this.#editingInspector()) this.#openGuild();
    } else if (!this.#looksOpen) this.#closeInspector(); // Looks does not depend on the town: keep it open
  }

  /** Same town, newer data: rebuild quietly and play only what is new, live. */
  #onUpdate(shown: Shown): void {
    const before = new Set(this.#guild.journeys.map((j) => j.key));
    this.#shown = shown;
    this.#raws = shown.raws;
    this.#rebuild();
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    this.#sim.goLive();
    for (const j of this.#guild.journeys) if (!before.has(j.key)) this.#sim.playNow(j);
  }

  /** Is the player mid-edit in the inspector (focused field, or text not yet submitted)? */
  #editingInspector(): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.#inspector.contains(active) && active.matches('input, select, textarea')) return true;
    return [...this.#inspector.querySelectorAll('input')].some((i) => i.type !== 'file' && i.value !== '');
  }

  #onBudget(snap: BudgetSnapshot): void {
    this.#budget = snap;
    this.#inkEl.textContent = `✒ ${snap.remaining}`;
    this.#inkEl.classList.toggle('low', snap.remaining < 30);
  }

  #openLooks(): void {
    this.#renderer.selected = null;
    this.#openInspector(
      looksPanel({
        onLoadout: (loadout) => {
          this.#prefs.loadout = { ...loadout };
          savePrefs(this.#prefs);
        },
        refresh: () => this.#openLooks(),
      }),
    );
    this.#looksOpen = true;
  }

  #openGuild(): void {
    this.#renderer.selected = null;
    this.#openInspector(
      guildPanel({
        prefs: this.#prefs,
        budget: this.#budget ?? this.#session.budget.snapshot(),
        visiting: this.#shown?.visiting ?? null,
        onHomeChanged: () => void this.#session.home(),
        onKeyChanged: () => {
          this.#session.keyChanged();
          void this.#session.home();
        },
        onVisit: (a) => void this.#session.visit(a),
        onClearCache: () => this.#session.clearCache(),
        refresh: () => this.#openGuild(),
      }),
      true,
    );
  }

  #setWindow(w: HistoryWindow): void {
    this.#prefs.window = w;
    savePrefs(this.#prefs);
    this.#rebuild();
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    if (this.#beat) this.#sim.bell(this.#beat.number, this.#beat.busy);
    this.#closeInspector();
  }

  async #setView(v: ViewKind, save = true): Promise<void> {
    if (v === '3d') {
      if (this.#r3d === null) {
        try {
          const { Renderer3D } = await import('../render/three/renderer3d.js');
          const r = new Renderer3D(this.#sim, this.#prefs.quality);
          r.classOf = (a) => this.#classOf(a);
          this.#r3d = r;
          this.#set3dQuality = (q) => r.setQuality(q);
          // Visual-validation hooks: ?debug=nopost|ao|nograde, ?cam=near|design|far
          const url = new URLSearchParams(location.search);
          const debug = url.get('debug');
          if (debug === 'nopost' || debug === 'ao' || debug === 'nograde' || debug === 'final') r.setDebug(debug);
          const cam = url.get('cam');
          if (cam === 'near' || cam === 'design' || cam === 'far') this.#bookmark = () => r.bookmark(cam);
        } catch (error) {
          console.error('3D view unavailable', error);
          return;
        }
      }
      this.#renderer = this.#r3d;
    } else {
      this.#r2d.view = v;
      this.#renderer = this.#r2d;
    }
    this.#renderer.selected = null;
    this.#renderer.hover = null;
    this.#stage.replaceChildren(this.#renderer.element);
    if (save) {
      this.#prefs.view = v;
      savePrefs(this.#prefs);
    }
    for (const [k, b] of this.#viewBtns) b.classList.toggle('on', k === v);
    requestAnimationFrame(() => {
      this.#renderer.fit();
      if (v === '3d') this.#bookmark?.();
    });
  }

  #setSpeed(s: number): void {
    this.#sim.speed = s;
    this.#prefs.speed = s;
    savePrefs(this.#prefs);
    for (const [k, b] of this.#speedBtns) b.classList.toggle('on', k === s);
  }

  // --- layout ----------------------------------------------------------------

  #layout(): HTMLElement {
    const views = el('div', { class: 'seg' });
    for (const [v, label] of [['top', 'Top-down'], ['iso', 'Isometric'], ['3d', '3D']] as const) {
      const b = el('button', { class: `btn${this.#prefs.view === v ? ' on' : ''}` }, label);
      b.onclick = () => void this.#setView(v);
      this.#viewBtns.set(v, b);
      views.append(b);
    }
    const windowSel = el('select', { 'aria-label': 'History window' });
    for (const [value, label] of [['days:30', 'Last 30 days'], ['days:7', 'Last 7 days'], ['count:100', 'Last 100 transactions'], ['count:25', 'Last 25 transactions']] as const) {
      const opt = el('option', { value }, label);
      const cur = this.#prefs.window.kind === 'days' ? `days:${this.#prefs.window.days}` : `count:${this.#prefs.window.count}`;
      if (cur === value) opt.selected = true;
      windowSel.append(opt);
    }
    windowSel.onchange = () => {
      const [kind, n] = windowSel.value.split(':');
      const num = Number(n);
      this.#setWindow(kind === 'days' ? { kind: 'days', days: num } : { kind: 'count', count: num });
    };

    const legend = el(
      'section',
      { class: 'legend', title: 'One value scale for everything: mounts, homes, item frames, caravans' },
      el('h4', {}, 'Value scale'),
      ...TIER_NAMES.map((name, i) => {
        const d = el('span', { class: 'legend-item' }, el('i', {}), `${name} ${i === 0 ? '<$10' : `$${short(TIER_FLOORS[i] ?? 0)}+`}`);
        const dot = d.querySelector('i');
        if (dot) dot.style.background = TIER_COLORS[i] ?? '#888';
        return d;
      }),
    );

    const qualitySel = el('select', { 'aria-label': '3D quality', title: '3D image quality' });
    for (const [value, label] of [['low', 'Quality: low'], ['medium', 'Quality: medium'], ['high', 'Quality: high']] as const) {
      const opt = el('option', { value }, label);
      if (this.#prefs.quality === value) opt.selected = true;
      qualitySel.append(opt);
    }
    qualitySel.onchange = () => {
      this.#prefs.quality = qualitySel.value as Prefs['quality'];
      savePrefs(this.#prefs);
      this.#set3dQuality?.(this.#prefs.quality);
    };
    const looksBtn = el('button', { class: 'btn' }, '🎨 Looks');
    looksBtn.onclick = () => this.#openLooks();
    const guildBtn = el('button', { class: 'btn' }, '⚙ Guild');
    guildBtn.onclick = () => (this.#guildOpen ? this.#closeInspector() : this.#openGuild());
    this.#inkEl.onclick = () => this.#openGuild();
    this.#homeBtn.onclick = () => void this.#session.home();
    const header = el(
      'header',
      { class: 'topbar' },
      el('div', { class: 'brand' }, el('strong', {}, 'Wallet-landia'), this.#sourceEl),
      views,
      windowSel,
      qualitySel,
      this.#homeBtn,
      this.#statusEl,
      el('div', { class: 'spacer' }),
      this.#inkEl,
      looksBtn,
      guildBtn,
    );

    const close = el('button', { class: 'btn close', 'aria-label': 'Close' }, '✕');
    close.onclick = () => this.#closeInspector();
    this.#inspector.append(close, this.#inspectorBody);

    const speeds = el('div', { class: 'seg' });
    for (const s of SPEEDS) {
      const b = el('button', { class: `btn${s === this.#prefs.speed ? ' on' : ''}` }, `${s}×`);
      b.onclick = () => this.#setSpeed(s);
      this.#speedBtns.set(s, b);
      speeds.append(b);
    }
    this.#playBtn.onclick = () => this.#togglePlay();
    this.#scrub.oninput = () => {
      this.#scrubbing = true;
      this.#sim.seek((Number(this.#scrub.value) / 100) * this.#sim.duration);
    };
    this.#scrub.onchange = () => (this.#scrubbing = false);

    const timeline = el('footer', { class: 'timeline' }, this.#playBtn, speeds, this.#scrub, this.#dateLabel, this.#modeLabel, this.#beatLabel);
    const questlog = el('section', { class: 'questlog' }, el('h4', {}, 'Quest log'), this.#log);

    return el('div', { class: 'app' }, header, el('main', { class: 'world' }, this.#stage, questlog, legend, this.#inspector, this.#tooltip), timeline);
  }

  #togglePlay(): void {
    this.#sim.playing = !this.#sim.playing;
    this.#playBtn.textContent = this.#sim.playing ? '❚❚' : '▶';
  }

  #tick(): void {
    const sim = this.#sim;
    if (!this.#scrubbing) this.#scrub.value = String(Math.min(100, (sim.t / sim.duration) * 100));
    this.#dateLabel.textContent = fmtDate(sim.realTime());
    this.#modeLabel.textContent = sim.live ? '● LIVE' : 'replaying';
    this.#modeLabel.classList.toggle('live', sim.live);
    if (sim.log.length !== this.#logCount || sim.log.at(-1)?.journey.key !== this.#selectedKey) {
      this.#logCount = sim.log.length;
      this.#selectedKey = sim.log.at(-1)?.journey.key ?? '';
      this.#log.replaceChildren(...sim.log.slice(-8).reverse().map((e) => questLogRow(e.journey, this.#guild, (j) => this.#openJourney(j))));
    }
  }

  // --- input -----------------------------------------------------------------

  #bindInput(): void {
    const stage = this.#stage;
    const onStage = (e: Event): boolean => e.target instanceof Node && stage.contains(e.target);
    // Left-drag pans; right-drag or shift-drag orbits (3D only).
    let drag: { x: number; y: number; moved: boolean; orbit: boolean } | null = null;
    // Touch: two fingers pinch to zoom and twist to orbit.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; angle: number } | null = null;
    const twoFinger = (): { dist: number; angle: number; cx: number; cy: number } | null => {
      const [a, b] = [...touches.values()];
      if (!a || !b) return null;
      return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        drag = null;
        const t = twoFinger();
        pinch = t ? { dist: t.dist, angle: t.angle } : null;
        return;
      }
      drag = { x: e.clientX, y: e.clientY, moved: false, orbit: e.button === 2 || e.shiftKey };
    });
    const release = (e: PointerEvent): void => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    window.addEventListener('pointercancel', release);
    window.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch !== null) {
        const t = twoFinger();
        if (t) {
          const r = stage.getBoundingClientRect();
          this.#renderer.zoomAt(t.cx - r.left, t.cy - r.top, t.dist / Math.max(1, pinch.dist));
          this.#renderer.rotate((t.angle - pinch.angle) * 160, 0);
          pinch = { dist: t.dist, angle: t.angle };
        }
      }
    });
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointermove', (e) => {
      if (drag !== null) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          if (drag.orbit) this.#renderer.rotate(dx, dy);
          else this.#renderer.pan(dx, dy);
          drag.x = e.clientX;
          drag.y = e.clientY;
        }
      }
      if (onStage(e)) this.#hover(e);
    });
    window.addEventListener('pointerup', (e) => {
      if (drag !== null && !drag.moved && !drag.orbit && onStage(e)) this.#click(e);
      drag = null;
      release(e);
    });
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        this.#renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
    stage.addEventListener('pointerleave', () => {
      this.#tooltip.hidden = true;
      this.#renderer.hover = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        this.#togglePlay();
      } else if (e.key === 't') void this.#setView('top');
      else if (e.key === 'i') void this.#setView('iso');
      else if (e.key === '3') void this.#setView('3d');
      else if (e.key === 'q') this.#renderer.rotate(-60, 0);
      else if (e.key === 'e') this.#renderer.rotate(60, 0);
      else if (e.key === '0') this.#renderer.fit();
      else if (e.key === 'Escape') this.#closeInspector();
    });
    window.addEventListener('resize', () => this.#renderer.fit());
  }

  #hover(e: PointerEvent): void {
    const r = this.#stage.getBoundingClientRect();
    const target = this.#renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
    this.#renderer.hover = target;
    this.#stage.style.cursor = target ? 'pointer' : 'grab';
    if (target === null) {
      this.#tooltip.hidden = true;
      return;
    }
    this.#tooltip.hidden = false;
    this.#tooltip.replaceChildren(...this.#tooltipContent(target));
    this.#tooltip.style.left = `${e.clientX - r.left + 14}px`;
    this.#tooltip.style.top = `${e.clientY - r.top + 14}px`;
  }

  #tooltipContent(t: HitTarget): Node[] {
    if (t.kind === 'hero') {
      const h = this.#guild.heroes.find((x) => x.address === t.address);
      if (!h) return [];
      return [el('strong', {}, h.name), el('div', {}, `${CLASS_LABEL[this.#classOf(h.address)]} · ${approxUsd(h.netWorth)} (${TIER_NAMES[h.tier]})`), el('div', { class: 'muted' }, 'a wallet · click for the character sheet')];
    }
    const b = t.placed;
    if (b.kind === 'home') {
      const h = this.#guild.heroes.find((x) => x.address === b.heroAddress);
      return [el('strong', {}, `${h?.name ?? 'A hero'}'s home`), el('div', {}, `${approxUsd(h?.netWorth)} · click to see the treasure`)];
    }
    if (b.protocolId !== undefined) {
      const p = this.#guild.protocols.get(b.protocolId);
      const mine = this.#guild.heroes.flatMap((h) => h.stashes.filter((s) => s.protocolId === b.protocolId)).reduce((s, x) => s + x.netUsd, 0);
      return [el('strong', {}, p?.name ?? '?'), el('div', {}, `${p ? buildingName(p.building) : ''}`), mine !== 0 ? el('div', {}, `your stash: ${approxUsd(mine)}`) : el('div', { class: 'muted' }, `${p?.visits ?? 0} visits`)];
    }
    const names: Record<string, string> = {
      tower: `${buildingName('tower')} · the blockchain`,
      guildhall: `${buildingName('guildhall')} · all your wallets`,
      gate: `${buildingName('gate')} · the outside world`,
    };
    return [el('strong', {}, names[b.kind] ?? b.kind)];
  }

  #ctx(): PanelContext {
    return {
      guild: this.#guild,
      classOf: (a) => this.#classOf(a),
      setClass: (a, cls) => {
        if (cls === null) delete this.#prefs.classOverrides[a];
        else this.#prefs.classOverrides[a] = cls;
        savePrefs(this.#prefs);
      },
      onSelectHero: (a) => this.#selectHero(a),
      onJourney: (j) => this.#openJourney(j),
      onReplay: (j) => this.#replay(j),
      beat: this.#beat,
    };
  }

  #click(e: PointerEvent): void {
    const r = this.#stage.getBoundingClientRect();
    const target = this.#renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
    if (target === null) {
      this.#closeInspector();
      return;
    }
    if (target.kind === 'hero') {
      this.#selectHero(target.address);
      return;
    }
    this.#renderer.selected = target;
    this.#openInspector(buildingPanel(target.placed, this.#ctx()));
  }

  /** Quest Replay: the storyboard, and the route drawn in town. */
  #openJourney(j: Journey): void {
    this.#renderer.selected = { kind: 'hero', address: j.hero };
    this.#openInspector(questPanel(j, this.#ctx()));
    // After opening: opening any panel clears the previous route.
    this.#sim.route = this.#sim.routeFor(j);
    const home = this.#sim.plan.homes.get(j.hero);
    if (home) this.#renderer.focus(home.doorAt.x, home.doorAt.y);
  }

  #replay(j: Journey): void {
    this.#sim.route = this.#sim.routeFor(j);
    this.#sim.solo(j);
    this.#renderer.follow?.(j.initiated ? j.hero : null);
    if (!this.#sim.playing) this.#togglePlay();
  }

  #selectHero(address: string): void {
    const hero = this.#guild.heroes.find((h) => h.address === address);
    if (!hero) return;
    this.#renderer.selected = { kind: 'hero', address };
    this.#openInspector(heroPanel(hero, this.#ctx()));
  }

  #openInspector(body: HTMLElement, guild = false): void {
    this.#guildOpen = guild;
    this.#looksOpen = false;
    this.#sim.route = null;
    this.#inspectorBody.replaceChildren(body);
    this.#inspector.hidden = false;
  }

  #closeInspector(): void {
    this.#guildOpen = false;
    this.#looksOpen = false;
    this.#sim.route = null;
    this.#renderer.follow?.(null);
    this.#inspector.hidden = true;
    this.#renderer.selected = null;
  }
}

function short(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : String(n);
}
