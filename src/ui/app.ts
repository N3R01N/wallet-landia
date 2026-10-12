/**
 * The app: one Sim, one Renderer that can switch projection, and the DOM
 * around them. Everything runs in the browser.
 */

import { buildGuild, type HistoryWindow } from '../domain/mappers.js';
import { CLASS_LABEL, type Guild, type HeroClass, type Journey } from '../domain/model.js';
import { TIER_NAMES, approxUsd } from '../domain/tiers.js';
import { setRealmChains, type RawWallet } from '../data/zerion/endpoints.js';
import { realmGuild, realmOf, realmSummaries } from '../domain/realms.js';
import { realmMap } from './realmMap.js';
import type { LedgerStatus } from '../data/ledger.js';
import { Session, type Shown } from '../data/session.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { guildPanel, historyRows } from './guildPanel.js';
import { looksPanel, themePicker, type LooksContext } from './looksPanel.js';
import { assets } from '../assets/registry.js';
import { loadBundledPacks, loadImportedPacks } from '../assets/packs.js';
import { PROVINCE_POLL_MS, PROVINCE_RPC, setRpcUrl, startHeartbeat, validRpcUrl, type BlockBeat } from '../data/rpc.js';
import { buildingName } from '../assets/art.js';
import { planTown } from '../world/layout.js';
import { Sim } from '../world/sim.js';
import { Renderer } from '../render/renderer.js';
import type { HitTarget, ViewKind, WorldView } from '../render/view.js';
import { loadPrefs, savePrefs, type Prefs } from '../settings.js';
import type { Renderer3D } from '../render/three/renderer3d.js';
import { loadThemeBundles, type ThemeBundle } from '../assets/themeBundles.js';
import { el, fmtDate, shortAddr } from './dom.js';
import { setCrests } from '../util/rng.js';
import { Soundscape } from '../audio/soundscape.js';
import { Tour } from './tour.js';
import { tourSteps } from './tourSteps.js';
import { bindInput } from './input.js';
import { buildLayout } from './layout.js';
import { PlayerController } from './playerController.js';
import { nightFactor } from '../render/overlay.js';
import { priceMove, type PriceMove } from '../domain/risk.js';
import { ethPriceFrom, formatGwei } from '../world/chain.js';
import { BADGE_TIER_NAMES, type PlayerBadge } from '../domain/player.js';
import { buildingPanel, heroPanel, heroQuestPanel, playerPanel, questLogRow, questPanel, type PanelContext } from './panels.js';
import { heroNow, type HeroNow } from '../world/heroNow.js';

export class App {
  readonly element: HTMLElement;
  #raws: RawWallet[];
  #names: Map<string, string> = new Map();
  #session: Session;
  #shown: Shown | null = null;
  #prefs: Prefs;
  #sourceEl = el('span', { class: 'muted' }, 'Loading…');
  #statusEl = el('span', { class: 'status' });
  /** The first-visit tour, and what it points at. */
  #tourBtn = el('button', { class: 'btn', title: 'Show the tour again', 'aria-label': 'Show the tour again' }, '?');
  #tourRefs: { views: HTMLElement; guildBtn: HTMLElement; legend: HTMLElement } | null = null;
  #tourShown = false;
  /** The town's sounds (off by default). */
  #sound = new Soundscape();
  #soundBtn = el('button', { class: 'btn sound', title: 'Sound on / off (m)', 'aria-label': 'Sound', 'aria-pressed': 'false' }, '🔇');
  #inkEl = el('button', { class: 'btn ink', title: 'Zerion requests left today — open the Guild panel' }, '');
  #homeBtn = el('button', { class: 'btn', hidden: '' }, '⌂ Return home');
  #budget: BudgetSnapshot | null = null;
  #set3dQuality: ((q: Prefs['quality']) => void) | null = null;
  #bookmark: (() => void) | null = null;
  #guildOpen = false;
  #looksOpen = false;
  /** Theme bundles for the 3D view (bundled, and imported packs that carry one). */
  #themes: ThemeBundle[] = [];
  /** The whole guild, every realm (medals, the ETH price, the Realm Map). */
  #world!: Guild;
  /** The guild as it stands in the realm on show (its town). */
  #guild!: Guild;
  #sim!: Sim;
  #realmBtn = el('button', { class: 'btn realm-btn', title: 'The Realm Map: Ethereum and its L2 provinces' }, '🗺');
  #realmMap: { element: HTMLElement; dispose: () => void } | null = null;
  /** Your wallets' lifetime history, as the walk back last reported it. */
  #history: { statuses: LedgerStatus[]; paused: string | null } | null = null;
  #historyRedraw: ReturnType<typeof setTimeout> | null = null;
  /** The view currently on screen. */
  #renderer: WorldView;
  #r2d: Renderer;
  /** Created on first use: `three` is only downloaded when someone opens 3D. */
  #r3d: Renderer3D | null = null;
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
  #viewSel: HTMLSelectElement | null = null;
  /** The hero whose card is open (their current quest, or their whole sheet), and the stage the quest card shows. */
  #heroCard: { address: string; view: 'quest' | 'overview'; stage: string } | null = null;
  #speedBtns = new Map<number, HTMLButtonElement>();
  #beat: BlockBeat | null = null;
  #scrubbing = false;
  #logCount = -1;
  #selectedKey = '';
  /** You: the level and badges of all your wallets' whole history. */
  #player: PlayerController;
  #playerOpen = false;
  #toasts = el('div', { class: 'toasts', 'aria-live': 'polite' });
  /** What is still loading (reason → what to tell the player); the veil shows while any is. */
  #loading = new Map<string, string>();
  #veilText = el('div', { class: 'veil-text' }, '');
  #veil = el(
    'div',
    { class: 'veil', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'veil-card' }, el('div', { class: 'veil-crest' }, el('span', {}), el('span', {}), el('span', {})), this.#veilText, el('div', { class: 'veil-bar' }, el('i', {}))),
  );

  constructor() {
    this.#raws = [];
    this.#prefs = loadPrefs();
    setCrests(this.#prefs.crests);
    if (this.#prefs.rpcUrl !== '' && validRpcUrl(this.#prefs.rpcUrl)) setRpcUrl(this.#prefs.rpcUrl);
    // the realm's chains, for every request from here on; ?realm= opens a province's town (links, tests)
    setRealmChains(this.#prefs.chains);
    const realmParam = new URLSearchParams(location.search).get('realm');
    // only a realm that is loaded: an unknown one would be saved as the default town, an empty one
    if (realmParam !== null && this.#prefs.chains.includes(realmParam)) this.#prefs.realm = realmParam;
    this.#sound.setVolume(this.#prefs.volume);
    this.#setSound(this.#prefs.sound, false);
    this.#soundBtn.onclick = () => this.#setSound(!this.#sound.on);
    this.#tourBtn.onclick = () => this.#startTour();
    // test hook: ?expose puts the soundscape (and the living town) on window
    if (new URLSearchParams(location.search).has('expose')) {
      (window as unknown as { soundscape: Soundscape }).soundscape = this.#sound;
      Object.defineProperty(window, 'townSim', { get: () => this.#sim, configurable: true });
      Object.defineProperty(window, 'townView', { get: () => this.#renderer, configurable: true });
    }
    this.#busy('town', 'Gathering your heroes…');
    this.#session = new Session(this.#prefs, {
      onTown: (shown) => this.#onTown(shown),
      onUpdate: (shown) => this.#onUpdate(shown),
      onStatus: (text, kind) => {
        this.#statusEl.textContent = text;
        this.#statusEl.className = `status ${kind}`;
        if (kind === 'error') this.#busy('town', null); // never hide the town behind a failed load
      },
      onBudget: (snap) => this.#onBudget(snap),
      onHistory: (statuses, paused) => {
        // history arriving: the level and badges grow with it
        const before = this.#history?.statuses.reduce((n, x) => n + x.count, 0) ?? 0;
        this.#history = { statuses, paused };
        if (statuses.reduce((n, x) => n + x.count, 0) !== before) this.#player.soon();
        // the open Guild panel follows along: at most every 2 s, always ending on the latest
        if (this.#historyRedraw !== null) return;
        this.#historyRedraw = setTimeout(() => {
          this.#historyRedraw = null;
          if (!this.#guildOpen) return;
          // just the history rows: a whole new panel would wipe its messages ("Saved.", an import's result)
          const rows = this.#inspectorBody.querySelector('.history-rows');
          if (rows) rows.replaceWith(historyRows({ history: this.#history, prefs: this.#prefs }));
          else if ((this.#history?.statuses.length ?? 0) > 0 && !this.#editingInspector()) this.#openGuild(); // no section yet: it appears with the first rows
        }, 2000);
      },
    });
    this.#player = new PlayerController({
      session: this.#session,
      prefs: this.#prefs,
      shown: () => this.#shown,
      names: () => this.#names,
      classOf: (a) => this.#classOf(a),
      changed: () => {
        if (this.#playerOpen && !this.#editingInspector()) this.#openPlayer();
      },
    });
    this.#onBudget(this.#session.budget.snapshot());
    this.#rebuild();
    this.#r2d = new Renderer(this.#canvas, this.#sim);
    this.#r2d.classOf = (a) => this.#classOf(a);
    this.#renderer = this.#r2d;
    this.#stage.append(this.#canvas);
    this.element = this.#layout();
    bindInput({
      stage: this.#stage,
      tooltip: this.#tooltip,
      renderer: () => this.#renderer,
      tooltipContent: (t) => this.#tooltipContent(t),
      click: (e) => this.#click(e),
      togglePlay: () => this.#togglePlay(),
      setView: (v) => void this.#setView(v),
      toggleSound: () => this.#setSound(!this.#sound.on),
      closeInspector: () => this.#closeInspector(),
    });
    void this.#setView(this.#prefs.view, false);
    startHeartbeat((beat) => {
      this.#beat = beat;
      this.#bell();
      void this.#session.onBlock();
      this.#showBeat();
    });
    this.#followRealm();
  }

  start(): void {
    void this.#session.home();
    // a themed 3D town waits for its bundle: say so rather than show the plain look first
    if (this.#prefs.view === '3d' && (new URLSearchParams(location.search).get('theme') ?? this.#prefs.theme) !== '') this.#busy('theme', 'Raising the town…');
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
    void loadBundledPacks()
      .then(() => loadImportedPacks())
      .catch((e: unknown) => console.warn('packs', e))
      .then(() => loadThemeBundles('/themes', assets.packs.values()))
      .then((themes) => {
        this.#themes = themes;
        if (!this.#applyTheme()) this.#busy('theme', null);
        this.#refreshThemePicker();
      })
      .catch((e: unknown) => {
        // no themes: the plain look, never a town stuck behind the veil
        console.warn('themes', e);
        this.#busy('theme', null);
      });
    if (new URLSearchParams(location.search).has('freeze')) this.#sim.playing = false;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      this.#sim.step(dt);
      this.#renderer.draw();
      this.#tick();
      this.#sound.update(this.#sim, nightFactor());
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Draw the 3D town with the chosen theme bundle (?theme= overrides, for tests). */
  /** True if a theme started loading. */
  #applyTheme(): boolean {
    const r = this.#r3d;
    if (r === null) return false;
    const id = new URLSearchParams(location.search).get('theme') ?? this.#prefs.theme;
    const bundle = this.#themes.find((t) => t.id === id) ?? null;
    if ((bundle?.id ?? '') === r.themeId) return false;
    if (bundle) this.#busy('theme', `Raising ${bundle.name}…`);
    void r
      .setTheme(bundle)
      .catch((e: unknown) => console.warn('theme', e))
      .finally(() => this.#busy('theme', null));
    return bundle !== null;
  }

  /** The town's bell rings with its own chain's blocks: Ethereum's in the kingdom, a province's from its own node. */
  #bell(): void {
    const beat = this.#realmBeat();
    if (beat) this.#sim.bell(beat);
  }

  /** The latest block of the realm on show (null: none heard yet, or a province with no node to ask). */
  #realmBeat(): BlockBeat | null {
    const realm = this.#prefs.realm;
    return realm === 'ethereum' ? this.#beat : this.#province?.chain === realm ? this.#province.beat : null;
  }

  /** A province's feed, while its town is open (Ethereum's runs always: it also checks the wallets). */
  #province: { chain: string; beat: BlockBeat | null; stop: () => void } | null = null;

  /** Follow the blocks of the realm on show (a province with a known node), and only that one. */
  #followRealm(): void {
    const chain = this.#prefs.realm;
    if (this.#province?.chain === chain) return;
    this.#province?.stop();
    this.#province = null;
    const url = PROVINCE_RPC[chain];
    if (url !== undefined) {
      const province: { chain: string; beat: BlockBeat | null; stop: () => void } = { chain, beat: null, stop: () => undefined };
      this.#province = province;
      province.stop = startHeartbeat(
        (beat) => {
          if (this.#province !== province) return;
          province.beat = beat;
          this.#bell();
          this.#showBeat();
        },
        { chain, url, every: PROVINCE_POLL_MS },
      );
    }
    this.#showBeat();
  }

  /** The bar's bell line: the latest block of the realm on show. */
  #showBeat(): void {
    const realm = this.#prefs.realm;
    const beat = this.#realmBeat();
    const name = realmOf(realm).name;
    if (beat === null) {
      this.#beatLabel.textContent = realm === 'ethereum' || PROVINCE_RPC[realm] !== undefined ? `listening for ${name}'s bell…` : `${name}: no bell to listen to yet`;
      return;
    }
    const where = realm === 'ethereum' ? 'block' : `${name} block`;
    this.#beatLabel.textContent = `🔔 ${where} #${beat.number.toLocaleString('en-US')} · ${beat.txCount} txs · base toll ${beat.baseFeeGwei !== null ? formatGwei(beat.baseFeeGwei) : '?'} gwei`;
  }

  #openRealmMap(): void {
    this.#closeRealmMap();
    const map = realmMap({
      summaries: realmSummaries(this.#world, this.#prefs.chains),
      current: this.#prefs.realm,
      onEnter: (id) => this.#enterRealm(id),
      onClose: () => this.#closeRealmMap(),
    });
    this.#realmMap = map;
    this.#stage.append(map.element);
    map.element.querySelector<HTMLElement>('.realm-isle.here')?.focus();
  }

  #closeRealmMap(): void {
    if (!this.#realmMap) return;
    this.#realmMap.dispose();
    this.#realmMap.element.remove();
    this.#realmMap = null;
  }

  /** Go to a realm's town (a chain id); `then`: open that quest there (the far side of a crossing). */
  #enterRealm(id: string, then?: string): void {
    this.#closeRealmMap();
    const changed = id !== this.#prefs.realm;
    this.#prefs.realm = id;
    savePrefs(this.#prefs);
    if (changed) {
      // (its bell first: the new town rings with its own chain's)
      this.#followRealm();
      this.#swapSim();
      this.#closeInspector();
      const realm = realmOf(id);
      this.#toast(realm.kind === 'kingdom' ? '🏰' : '⛵', realm.title, realm.about);
    }
    if (then !== undefined) {
      const j = this.#guild.journeys.find((x) => x.key === then);
      if (j) this.#openJourney(j);
    }
  }

  #classOf(address: string): HeroClass {
    const override = this.#prefs.classOverrides[address];
    if (override !== undefined) return override;
    return this.#guild.heroes.find((h) => h.address === address)?.suggestedClass ?? 'adventurer';
  }

  #rebuild(): void {
    this.#world = buildGuild(this.#raws, this.#prefs.window, { names: this.#names });
    this.#nameHeroes();
    this.#guild = realmGuild(this.#world, this.#prefs.realm);
    const plan = planTown(this.#guild);
    this.#sim = new Sim(this.#guild, plan);
    this.#sim.realm = this.#prefs.realm;
    // a province may hold no ETH of its own: price its toll from all the guild holds
    this.#sim.ethUsd ??= ethPriceFrom(this.#world.heroes.flatMap((h) => h.items));
    this.#realmBtn.textContent = `🗺 ${realmOf(this.#prefs.realm).name}`;
    this.#sim.speed = this.#prefs.speed;
    this.#sim.fog = this.#prefs.fog;
    this.#sim.setPriceMove(this.#priceMove);
    this.#logCount = -1;
  }

  /**
   * A new town in place of the old: rebuilt, handed to both views, and rung
   * with the latest block (`bell: false` for a quiet update, which plays only
   * what is new). `seek`: honour ?at=<seconds> (a link to a moment; tests).
   */
  #swapSim(o: { seek?: boolean; bell?: boolean } = {}): void {
    this.#rebuild();
    const at = o.seek === true ? Number(new URLSearchParams(location.search).get('at')) : 0;
    if (at > 0) this.#sim.seek(at);
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    if (o.bell !== false) this.#bell();
  }

  /** How ETH moved since the player's last visit (settled from the first home town of the session). */
  #priceMove: PriceMove | null = null;
  #priceSettled = false;

  /**
   * "Since you were last here": the price seen on a visit more than an hour
   * ago is the baseline (reloads within a session keep the same one).
   */
  #settlePrice(): void {
    if (this.#priceSettled || this.#shown?.visiting) return;
    const now = ethPriceFrom(this.#world.heroes.flatMap((h) => h.items));
    if (now === null) return;
    this.#priceSettled = true;
    const eth = this.#prefs.eth;
    const t = Date.now();
    if (eth.seen && t - eth.seen.at > 60 * 60_000) eth.prev = eth.seen;
    eth.seen = { usd: now, at: t };
    savePrefs(this.#prefs);
    this.#priceMove = eth.prev ? priceMove(now, eth.prev) : null;
    this.#sim.setPriceMove(this.#priceMove);
  }

  /** The names heroes were given by the town (ENS or a generated one), before the player renamed any. */
  #bornNames = new Map<string, string>();

  /** Heroes wear the names the player gave them. */
  #nameHeroes(): void {
    for (const h of this.#world.heroes) {
      this.#bornNames.set(h.address, h.name);
      const mine = this.#prefs.names[h.address.toLowerCase()];
      if (mine !== undefined && mine.trim() !== '') h.name = mine;
    }
  }

  #rename(address: string, name: string | null): void {
    const key = address.toLowerCase();
    const clean = name?.trim().slice(0, 40) ?? '';
    if (clean === '' || clean === this.#bornNames.get(address)) delete this.#prefs.names[key];
    else this.#prefs.names[key] = clean;
    savePrefs(this.#prefs);
    for (const g of [this.#world, this.#guild]) {
      const hero = g.heroes.find((h) => h.address === address);
      if (hero) hero.name = this.#prefs.names[key] ?? this.#bornNames.get(address) ?? hero.name;
    }
    this.#logCount = -1; // the quest log shows names: redraw it
  }

  #startTour(): void {
    const refs = this.#tourRefs;
    if (!refs) return;
    const steps = tourSteps({
      ...refs,
      stage: this.#stage,
      showGuild: () => {
        if (!this.#guildOpen) this.#openGuild();
      },
    });
    new Tour(steps, () => {
      this.#prefs.tourDone = true;
      savePrefs(this.#prefs);
    }).start();
  }

  /** Sound on or off (from a click: browsers start audio only on a gesture). */
  #setSound(on: boolean, save = true): void {
    this.#sound.setOn(on);
    this.#soundBtn.textContent = on ? '🔊' : '🔇';
    this.#soundBtn.setAttribute('aria-pressed', String(on));
    if (save) {
      this.#prefs.sound = on;
      savePrefs(this.#prefs);
    }
  }

  /** Show (text) or clear (null) one reason the town is not ready yet. */
  #busy(reason: string, text: string | null): void {
    if (text === null) this.#loading.delete(reason);
    else this.#loading.set(reason, text);
    const last = [...this.#loading.values()].at(-1);
    this.#veil.hidden = last === undefined;
    if (last !== undefined) this.#veilText.textContent = last;
  }

  #openPlayer(): void {
    const p = this.#player.profile;
    if (p === null) return;
    this.#renderer.selected = null;
    const walking = this.#history?.statuses.filter((s) => !s.complete) ?? [];
    const reach = walking.length > 0 && walking.some((s) => s.oldest !== null) ? `back to ${new Date(Math.min(...walking.map((s) => s.oldest ?? Infinity))).getFullYear()} so far` : null;
    this.#openInspector(
      playerPanel(p, {
        walletName: (a) => this.#world.heroes.find((h) => h.address === a)?.name ?? shortAddr(a),
        openQuest: (key) => {
          const j = this.#guild.journeys.find((x) => x.key === key) ?? this.#world.journeys.find((x) => x.key === key);
          if (!j) return false;
          this.#openJourney(j);
          return true;
        },
        reach,
      }),
    );
    this.#playerOpen = true;
  }

  /** A badge (or a new tier of one) earned as the replay plays: a moment of glory in the corner of the town. */
  #announce(b: PlayerBadge, tier: number): void {
    const m = b.medal;
    const what = tier === 1 ? `You earned ${m.name}` : `${m.name}: ${BADGE_TIER_NAMES[tier]}`;
    const sub = tier === 1 ? `New title: ${m.title}` : `${b.single ? '' : `${tier === 2 ? 10 : 100} times now`}`;
    this.#toast(m.icon, what, sub).onclick = () => this.#openPlayer();
    this.#sound.fanfare();
  }

  /**
   * A note in the corner of the town (a realm entered, a badge, a failure),
   * fading out after `ms`; the oldest go when more than three pile up.
   */
  #toast(icon: string, title: string, sub: string, ms = 5600, extra?: Node): HTMLElement {
    const toast = el('div', { class: 'toast' }, el('span', { class: 'toast-icon' }, icon), el('div', {}, el('strong', {}, title), el('div', { class: 'muted' }, sub), extra));
    this.#toasts.append(toast);
    while (this.#toasts.children.length > 3) this.#toasts.firstElementChild?.remove();
    setTimeout(() => toast.classList.add('leaving'), ms - 600);
    setTimeout(() => toast.remove(), ms);
    return toast;
  }

  #onTown(shown: Shown): void {
    this.#busy('town', null);
    // a first visit: the tour, once the town is there (not in automated browsers unless ?tour asks)
    const forced = new URLSearchParams(location.search).has('tour');
    if (!this.#tourShown && (forced || (!this.#prefs.tourDone && !navigator.webdriver))) {
      this.#tourShown = true;
      setTimeout(() => this.#startTour(), 600);
    }
    queueMicrotask(() => this.#settlePrice());
    // what the open panel shows, to keep it if the new town still has it
    const was = this.#inspector.hidden ? null : this.#renderer.selected;
    this.#shown = shown;
    this.#raws = shown.raws;
    this.#names = shown.names;
    this.#sourceEl.textContent = shown.label;
    this.#homeBtn.hidden = shown.visiting === null;
    this.#swapSim({ seek: true });
    // you, from all your wallets' history (at home; a visited town leaves your level as it was)
    void this.#player.refresh();
    // an open Realm Map shows what just arrived
    if (this.#realmMap) this.#openRealmMap();
    if (this.#guildOpen) {
      // Refresh the Guild panel for the new town, unless the player is typing
      // in it: replacing the form would throw away what they typed.
      if (!this.#editingInspector()) this.#openGuild();
    } else if (!this.#looksOpen && !this.#reopen(was)) this.#closeInspector(); // Looks does not depend on the town: keep it open
  }

  /**
   * Show the same hero or building in the new town (the first load finishing
   * just after a click, a refresh with the same wallets). False if it is gone.
   */
  #reopen(target: HitTarget | null): boolean {
    if (target === null) return false;
    if (target.kind === 'hero') {
      if (!this.#guild.heroes.some((h) => h.address === target.address)) return false;
      if (this.#heroCard?.view === 'overview') this.#heroOverview(target.address);
      else this.#selectHero(target.address, false);
      return true;
    }
    const placed = this.#sim.plan.buildings.find((b) => b.id === target.placed.id);
    if (!placed) return false;
    this.#renderer.selected = { kind: 'building', placed };
    this.#openInspector(buildingPanel(placed, this.#ctx()));
    return true;
  }

  /** Same town, newer data: rebuild quietly and play only what is new, live. */
  #onUpdate(shown: Shown): void {
    const before = new Set(this.#guild.journeys.map((j) => j.key));
    this.#shown = shown;
    this.#raws = shown.raws;
    this.#swapSim({ bell: false });
    this.#sim.goLive();
    for (const j of this.#guild.journeys) if (!before.has(j.key)) this.#sim.playNow(j);
    this.#player.soon();
    if (this.#realmMap) this.#openRealmMap();
  }

  /** Is the player mid-edit in the inspector (focused field, or text not yet submitted)? */
  #editingInspector(): boolean {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.#inspector.contains(active) && active.matches('input, select, textarea')) return true;
    // text typed and not yet submitted (a checkbox's value is always "on": not typing)
    // (against what the field was drawn with: a saved RPC address is not something being typed)
    return [...this.#inspector.querySelectorAll('input')].some((i) => !['file', 'checkbox', 'radio'].includes(i.type) && i.value !== i.defaultValue);
  }

  #onBudget(snap: BudgetSnapshot): void {
    this.#budget = snap;
    this.#inkEl.textContent = `✒ ${snap.remaining}`;
    this.#inkEl.classList.toggle('low', snap.remaining < 30);
  }

  #looksCtx(): LooksContext {
    return {
      onLoadout: (loadout) => {
        this.#prefs.loadout = { ...loadout };
        savePrefs(this.#prefs);
      },
      refresh: () => this.#openLooks(),
      themes: this.#themes.map((t) => (t.description ? { id: t.id, name: t.name, description: t.description } : { id: t.id, name: t.name })),
      theme: this.#prefs.theme,
      onTheme: (id) => {
        this.#prefs.theme = id;
        savePrefs(this.#prefs);
        this.#applyTheme();
        this.#refreshThemePicker();
      },
      volume: this.#prefs.volume,
      onVolume: (v) => {
        this.#prefs.volume = v;
        savePrefs(this.#prefs);
        this.#sound.setVolume(v);
      },
      fog: this.#prefs.fog,
      onFog: (on) => {
        this.#prefs.fog = on;
        savePrefs(this.#prefs);
        this.#sim.fog = on;
      },
    };
  }

  #openLooks(): void {
    this.#renderer.selected = null;
    this.#openInspector(looksPanel(this.#looksCtx()));
    this.#looksOpen = true;
  }

  /** Update just the theme picker in an open Looks panel (rebuilding it would lose an import in progress). */
  #refreshThemePicker(): void {
    if (!this.#looksOpen) return;
    this.#inspectorBody.querySelector('.theme-pick')?.replaceWith(themePicker(this.#looksCtx()));
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
        onVisit: (a) => {
          this.#busy('town', 'Travelling to their town…');
          void this.#session.visit(a);
        },
        onClearCache: () => this.#session.clearCache(),
        onRefresh: this.#shown?.mode === 'live' ? () => this.#session.refresh() : null,
        onRpc: (url) => {
          this.#prefs.rpcUrl = url;
          savePrefs(this.#prefs);
          setRpcUrl(url);
        },
        onChains: (chains) => {
          this.#prefs.chains = chains;
          if (!chains.includes(this.#prefs.realm)) this.#prefs.realm = 'ethereum';
          savePrefs(this.#prefs);
          setRealmChains(chains);
          this.#followRealm();
          this.#busy('town', 'Charting the realm…');
          void this.#session.home();
        },
        refresh: () => this.#openGuild(),
        history: this.#history,
        onExportHistory: async () => {
          const blob = await this.#session.exportHistory();
          if (blob === null) return false;
          const a = el('a', { href: URL.createObjectURL(blob), download: `wallet-landia-history-${new Date().toISOString().slice(0, 10)}.json.gz` });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
          return true;
        },
        onImportHistory: async (data) => {
          const said = await this.#session.importHistory(data);
          void this.#player.refresh();
          return said;
        },
        heroes: this.#guild.heroes,
        classOf: (a) => this.#classOf(a),
        // the Guild's "Character sheet": the whole sheet (a click in town shows the hero's quest)
        onSelectHero: (a) => this.#heroOverview(a),
        setName: (a, name) => {
          this.#rename(a, name);
          this.#openGuild();
        },
        bornName: (a) => this.#bornNames.get(a) ?? '',
        portraitOf: (a, cls) => this.#r3d?.portrait(a, cls) ?? null,
      }),
      true,
    );
  }

  #setWindow(w: HistoryWindow): void {
    this.#prefs.window = w;
    savePrefs(this.#prefs);
    this.#swapSim({ seek: true });
    this.#closeInspector();
  }

  async #setView(v: ViewKind, save = true): Promise<void> {
    if (v === '3d') {
      if (this.#r3d === null) {
        this.#busy('3d', 'Raising the town in 3D…');
        try {
          const { Renderer3D } = await import('../render/three/renderer3d.js');
          const r = new Renderer3D(this.#sim, this.#prefs.quality);
          r.classOf = (a) => this.#classOf(a);
          this.#r3d = r;
          this.#set3dQuality = (q) => r.setQuality(q);
          this.#applyTheme();
          // test hook: ?expose puts the 3D view on window
          if (new URLSearchParams(location.search).has('expose')) (window as unknown as { town3d: Renderer3D }).town3d = r;
          // Visual-validation hooks: ?debug=nopost|ao|nograde, ?cam=near|design|far
          const url = new URLSearchParams(location.search);
          const debug = url.get('debug');
          if (debug === 'nopost' || debug === 'ao' || debug === 'nograde' || debug === 'final') r.setDebug(debug);
          const cam = url.get('cam');
          if (cam === 'near' || cam === 'design' || cam === 'far') this.#bookmark = () => r.bookmark(cam);
        } catch (error) {
          console.error('3D view unavailable', error);
          // most often a tab older than the latest deploy: its 3D file (named by content) is gone from the server
          const reload = el('button', { class: 'btn small' }, 'Reload');
          reload.onclick = () => location.reload();
          this.#toast('⚠', 'The 3D view could not load', 'The town may have been updated since this tab opened. ', 12_000, reload);
          // the picker goes back to the view still on show
          if (this.#viewSel !== null) this.#viewSel.value = this.#renderer === this.#r2d ? this.#r2d.view : '3d';
          return;
        } finally {
          this.#busy('3d', null);
        }
      }
      this.#renderer = this.#r3d;
    } else {
      this.#r2d.view = v;
      this.#renderer = this.#r2d;
    }
    // a hero being watched stays watched in the new view
    const watched = this.#heroCard?.address ?? null;
    this.#renderer.selected = watched === null ? null : { kind: 'hero', address: watched };
    this.#renderer.hover = null;
    if (watched !== null) this.#renderer.follow?.(watched);
    // the Realm Map lives in the stage too: close it properly (replacing it away would leave its animation running)
    this.#closeRealmMap();
    this.#stage.replaceChildren(this.#renderer.element);
    if (save) {
      this.#prefs.view = v;
      savePrefs(this.#prefs);
    }
    if (this.#viewSel !== null) this.#viewSel.value = v;
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
    const layout = buildLayout(
      this.#prefs,
      {
        source: this.#sourceEl,
        status: this.#statusEl,
        playerBtn: this.#player.button,
        realmBtn: this.#realmBtn,
        homeBtn: this.#homeBtn,
        soundBtn: this.#soundBtn,
        inkBtn: this.#inkEl,
        tourBtn: this.#tourBtn,
        stage: this.#stage,
        inspector: this.#inspector,
        inspectorBody: this.#inspectorBody,
        log: this.#log,
        toasts: this.#toasts,
        veil: this.#veil,
        tooltip: this.#tooltip,
        playBtn: this.#playBtn,
        scrub: this.#scrub,
        dateLabel: this.#dateLabel,
        modeLabel: this.#modeLabel,
        beatLabel: this.#beatLabel,
      },
      {
        setView: (v) => void this.#setView(v),
        setWindow: (w) => this.#setWindow(w),
        setQuality: (q) => {
          this.#prefs.quality = q;
          savePrefs(this.#prefs);
          this.#set3dQuality?.(q);
        },
        setSpeed: (s) => this.#setSpeed(s),
        openLooks: () => this.#openLooks(),
        toggleGuild: () => (this.#guildOpen ? this.#closeInspector() : this.#openGuild()),
        openGuild: () => this.#openGuild(),
        togglePlayer: () => (this.#playerOpen ? this.#closeInspector() : this.#openPlayer()),
        toggleRealmMap: () => (this.#realmMap ? this.#closeRealmMap() : this.#openRealmMap()),
        goHome: () => {
          this.#busy('town', 'Heading home…');
          void this.#session.home();
        },
        closeInspector: () => this.#closeInspector(),
        togglePlay: () => this.#togglePlay(),
        scrub: (value) => {
          this.#scrubbing = true;
          this.#sim.seek((value / 100) * this.#sim.duration);
        },
        scrubEnd: () => (this.#scrubbing = false),
      },
    );
    this.#viewSel = layout.viewSel;
    this.#speedBtns = layout.speedBtns;
    this.#tourRefs = { views: layout.views, guildBtn: layout.guildBtn, legend: layout.legend };
    return layout.element;
  }

  #togglePlay(): void {
    this.#sim.playing = !this.#sim.playing;
    this.#playBtn.textContent = this.#sim.playing ? '❚❚' : '▶';
  }

  /** Was the timeline last shown live (null: not shown yet)? */
  #wasLive: boolean | null = null;

  #tick(): void {
    const sim = this.#sim;
    // every frame: touch the DOM only when something shown changed (each write costs a style recalc)
    // (to the slider's own step: it would snap the value anyway, so a raw one always looks changed)
    const pos = (Math.round(Math.min(100, (sim.t / sim.duration) * 100) * 20) / 20).toString();
    if (!this.#scrubbing && this.#scrub.value !== pos) this.#scrub.value = pos;
    const date = fmtDate(sim.realTime());
    if (this.#dateLabel.textContent !== date) this.#dateLabel.textContent = date;
    if (this.#wasLive !== sim.live) {
      this.#wasLive = sim.live;
      this.#modeLabel.textContent = sim.live ? '● LIVE' : 'replaying';
      this.#modeLabel.classList.toggle('live', sim.live);
    }
    if (sim.played !== this.#logCount || sim.log.at(-1)?.journey.key !== this.#selectedKey) {
      // medals for journeys just played (not for a jump along the timeline)
      const fresh = sim.played - this.#logCount;
      if (this.#logCount >= 0 && fresh > 0 && fresh <= 3) for (const e of sim.log.slice(-fresh)) for (const m of this.#player.momentsOf(e.journey.key)) this.#announce(m.badge, m.tier);
      this.#logCount = sim.played;
      this.#selectedKey = sim.log.at(-1)?.journey.key ?? '';
      this.#log.replaceChildren(...sim.log.slice(-8).reverse().map((e) => questLogRow(e.journey, this.#guild, (j) => this.#openJourney(j))));
    }
    // a hero's quest card follows them from stop to stop
    const card = this.#heroCard;
    if (card !== null && card.view === 'quest' && stageKey(heroNow(sim, card.address)) !== card.stage) this.#selectHero(card.address, false);
  }

  // --- what the town shows on hover and click ----------------------------------

  #tooltipContent(t: HitTarget): Node[] {
    if (t.kind === 'hero') {
      const h = this.#guild.heroes.find((x) => x.address === t.address);
      if (!h) return [];
      return [el('strong', {}, h.name), el('div', {}, `${CLASS_LABEL[this.#classOf(h.address)]} · ${approxUsd(h.netWorth)} (${TIER_NAMES[h.tier]})`), el('div', { class: 'muted' }, 'a wallet · click to see their quest and follow them')];
    }
    const b = t.placed;
    if (b.kind === 'home') {
      const h = this.#guild.heroes.find((x) => x.address === b.heroAddress);
      return [el('strong', {}, `${h?.name ?? 'A hero'}'s home`), el('div', {}, `${approxUsd(h?.netWorth)} · click to see the treasure`)];
    }
    if (b.protocolId !== undefined && this.#sim.fogOver(b) > 0.5) return [el('strong', {}, 'Unexplored'), el('div', { class: 'muted' }, 'No hero has been here yet in this replay')];
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
      onCrossing: (realm, key) => this.#enterRealm(realm, key),
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
      beat: this.#realmBeat(),
      playerBadges: () => this.#player.badgeIds(),
      titleOf: (a) => this.#player.titleOf(a),
      setTitle: (a, t) => {
        if (t === null) delete this.#prefs.titles[a];
        else this.#prefs.titles[a] = t;
        savePrefs(this.#prefs);
        this.#heroOverview(a);
      },
      setName: (a, name) => {
        this.#rename(a, name);
        this.#heroOverview(a);
      },
      bornName: (a) => this.#bornNames.get(a) ?? '',
      portraitOf: (a, cls) => this.#r3d?.portrait(a, cls) ?? null,
      setCrest: (a, color) => {
        const key = a.toLowerCase();
        if (color === null) delete this.#prefs.crests[key];
        else this.#prefs.crests[key] = [color, '#e6e4de'];
        savePrefs(this.#prefs);
        setCrests(this.#prefs.crests);
        // banners, shields and caravans are built with the crest: redraw the town
        this.#r2d.setSim(this.#sim);
        this.#r3d?.setSim(this.#sim);
        this.#heroOverview(a);
      },
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
    this.#renderer.follow?.(null);
    if (this.#sim.fogOver(target.placed) > 0.5) {
      this.#openInspector(el('div', { class: 'panel-body' }, el('h2', {}, 'Unexplored'), el('p', {}, 'A bank of mist hides this building. No hero has been here yet in this replay: it lifts when one visits, and the map is fully charted when the replay ends.'), el('p', { class: 'muted' }, 'Fog of war can be turned off in 🎨 Looks.')));
      return;
    }
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
    // follow whoever carries it out: the hero, or the raven, herald or bailiffs coming to them (then the hero)
    const actor = this.#sim.soloActor;
    this.#renderer.follow?.(actor?.id ?? j.hero, j.hero);
    if (!this.#sim.playing) this.#togglePlay();
  }

  /**
   * A hero, clicked: the quest they are on right now, kept current as they
   * go (see #tick), and the camera follows them (panning by hand stops it).
   * `follow` false: only redraw the card.
   */
  #selectHero(address: string, follow = true): void {
    const hero = this.#guild.heroes.find((h) => h.address === address);
    if (!hero) return;
    const now = heroNow(this.#sim, address);
    this.#renderer.selected = { kind: 'hero', address };
    this.#openInspector(heroQuestPanel(hero, now, this.#ctx(), { overview: () => this.#heroOverview(address) }));
    this.#heroCard = { address, view: 'quest', stage: stageKey(now) };
    if (follow) this.#renderer.follow?.(address);
  }

  /** The hero's whole sheet (treasure, class, title, quest log), a click away from their quest. */
  #heroOverview(address: string): void {
    const hero = this.#guild.heroes.find((h) => h.address === address);
    if (!hero) return;
    this.#renderer.selected = { kind: 'hero', address };
    const back = el('button', { class: 'btn back' }, '◀ Current quest');
    back.onclick = () => this.#selectHero(address, false);
    this.#openInspector(el('div', {}, back, heroPanel(hero, this.#ctx())));
    this.#heroCard = { address, view: 'overview', stage: '' };
  }

  #openInspector(body: HTMLElement, guild = false): void {
    this.#heroCard = null;
    this.#guildOpen = guild;
    this.#looksOpen = false;
    this.#playerOpen = false;
    this.#sim.route = null;
    this.#inspectorBody.replaceChildren(body);
    this.#inspector.hidden = false;
  }

  #closeInspector(): void {
    this.#heroCard = null;
    this.#guildOpen = false;
    this.#looksOpen = false;
    this.#playerOpen = false;
    this.#sim.route = null;
    this.#renderer.follow?.(null);
    this.#inspector.hidden = true;
    this.#renderer.selected = null;
  }
}

/** Where a hero's quest stands, as a key: the card is redrawn when it changes. */
function stageKey(n: HeroNow): string {
  return `${n.journey?.key ?? ''}|${n.phase}|${n.step ?? ''}|${n.busy}`;
}
