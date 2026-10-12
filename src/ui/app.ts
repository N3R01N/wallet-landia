/**
 * The app: one Sim, one Renderer that can switch projection, and the DOM
 * around them. Everything runs in the browser.
 */

import { buildGuild, type HistoryWindow } from '../domain/mappers.js';
import { CLASS_LABEL, type Guild, type HeroClass, type Journey } from '../domain/model.js';
import { TIER_COLORS, TIER_FLOORS, TIER_NAMES, approxUsd } from '../domain/tiers.js';
import { setRealmChains, type RawWallet } from '../data/zerion/endpoints.js';
import { realmGuild, realmOf, realmSummaries } from '../domain/realms.js';
import { realmMap } from './realmMap.js';
import type { LedgerStatus } from '../data/ledger.js';
import { Session, type Shown } from '../data/session.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { guildPanel } from './guildPanel.js';
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
import { el, fmtDate } from './dom.js';
import { setCrests } from '../util/rng.js';
import { Soundscape } from '../audio/soundscape.js';
import { Tour, type TourStep } from './tour.js';
import { nightFactor } from '../render/overlay.js';
import { priceMove, type PriceMove } from '../domain/risk.js';
import { ethPriceFrom, formatGwei } from '../world/chain.js';
import { defaultTitle, medalById, titleOptions, type Earned } from '../domain/feats.js';
import { badgeMoments, BADGE_TIER_NAMES, playerProfile, type PlayerBadge, type PlayerProfile, type Provenance } from '../domain/player.js';
import { buildingPanel, heroPanel, playerPanel, questLogRow, questPanel, type PanelContext } from './panels.js';

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
  #realmMap: HTMLElement | null = null;
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
  #viewBtns = new Map<ViewKind, HTMLButtonElement>();
  #speedBtns = new Map<number, HTMLButtonElement>();
  #beat: BlockBeat | null = null;
  #scrubbing = false;
  #logCount = -1;
  #selectedKey = '';
  /** You: the level and badges of all your wallets' whole history (null until first worked out). */
  #player: PlayerProfile | null = null;
  /** Journeys that earned a badge or a tier, to announce them as the replay plays them. */
  #badgeMoments = new Map<string, { badge: PlayerBadge; tier: number }[]>();
  #playerOpen = false;
  #playerBtn = el('button', { class: 'btn player-btn', title: 'You: your level and badges, from all your wallets' }, '🛡 Lv 1');
  /** When the player was last worked out (the walk back through history updates it now and then). */
  #playerAt = 0;
  #playerTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (realmParam !== null && /^[a-z0-9-]{2,40}$/.test(realmParam)) this.#prefs.realm = realmParam;
    this.#sound.setVolume(this.#prefs.volume);
    this.#setSound(this.#prefs.sound, false);
    this.#soundBtn.onclick = () => this.#setSound(!this.#sound.on);
    this.#tourBtn.onclick = () => this.#startTour();
    // test hook: ?expose puts the soundscape (and the living town) on window
    if (new URLSearchParams(location.search).has('expose')) {
      (window as unknown as { soundscape: Soundscape }).soundscape = this.#sound;
      Object.defineProperty(window, 'townSim', { get: () => this.#sim, configurable: true });
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
        if (statuses.reduce((n, x) => n + x.count, 0) !== before) this.#playerSoon();
        // the open Guild panel follows along: at most every 2 s, always ending on the latest (not while the player types in it)
        if (this.#historyRedraw !== null) return;
        this.#historyRedraw = setTimeout(() => {
          this.#historyRedraw = null;
          if (this.#guildOpen && !this.#editingInspector()) this.#openGuild();
        }, 2000);
      },
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
    const beat = this.#prefs.realm === 'ethereum' ? this.#beat : this.#province?.chain === this.#prefs.realm ? this.#province.beat : null;
    if (beat) this.#sim.bell(beat);
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
    const beat = realm === 'ethereum' ? this.#beat : this.#province?.chain === realm ? this.#province.beat : null;
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
    this.#realmMap = map.element;
    this.#realmMap.addEventListener('realm-dispose', () => map.dispose(), { once: true });
    this.#stage.append(map.element);
    map.element.querySelector<HTMLElement>('.realm-isle.here')?.focus();
  }

  #closeRealmMap(): void {
    if (!this.#realmMap) return;
    this.#realmMap.dispatchEvent(new Event('realm-dispose'));
    this.#realmMap.remove();
    this.#realmMap = null;
  }

  /** Go to a realm's town (a chain id); `then`: open that quest there (the far side of a crossing). */
  #enterRealm(id: string, then?: string): void {
    this.#closeRealmMap();
    const changed = id !== this.#prefs.realm;
    this.#prefs.realm = id;
    savePrefs(this.#prefs);
    if (changed) {
      this.#rebuild();
      this.#r2d.setSim(this.#sim);
      this.#r3d?.setSim(this.#sim);
      this.#followRealm();
      this.#bell();
      this.#closeInspector();
      const realm = realmOf(id);
      const toast = el('div', { class: 'toast' }, el('span', { class: 'toast-icon' }, realm.kind === 'kingdom' ? '🏰' : '⛵'), el('div', {}, el('strong', {}, realm.title), el('div', { class: 'muted' }, realm.about)));
      this.#toasts.append(toast);
      setTimeout(() => toast.remove(), 5600);
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
    const q = (sel: string): (() => HTMLElement | null) => () => document.querySelector<HTMLElement>(sel);
    const link = el('a', { href: 'https://dashboard.zerion.io', target: '_blank', rel: 'noopener noreferrer' }, 'dashboard.zerion.io ↗');
    const steps: TourStep[] = [
      {
        title: 'Welcome to Wallet-landia',
        body: [
          'Your Ethereum wallets as a little RPG town: every wallet a hero, every app a building, every transaction a quest.',
          el('p', {}, el('strong', {}, 'What you see now is a demo town. '), 'Its heroes are demo wallets, not yours. In a minute you can add your own, and they move in instead.'),
        ],
      },
      {
        title: 'The town',
        body: [
          'Each hero is a wallet. Their mount (a donkey up to a griffin) and their home grow with what the wallet holds.',
          'Each building is a protocol the wallets used: exchanges are bazaars, lending is a counting house, staking is the temple. Heroes walk there to replay their transactions.',
          'The Chronicle Tower in the square is the blockchain itself: its bell rings for every block, the line at its door shows how busy the chain is, the board shows the gas fee, and the fire on top burns green when it is cheap and red when it is dear.',
          'Click any hero or building to look inside.',
        ],
        target: () => this.#stage,
      },
      {
        title: 'The quest log',
        body: ['Every transaction becomes a quest. The newest appear here as the town replays them; click one to see exactly what happened, and replay it on its own.'],
        target: q('.questlog'),
      },
      {
        title: 'The value scale',
        body: ['One colour scale for everything worth money: item frames, mounts, homes and caravans, from Dust (under $10) to Mythic (over $1M). Click its title to fold it away.'],
        target: () => refs.legend,
      },
      {
        title: 'The timeline',
        body: ['The town replays the wallets\' recent history. Pause, change the speed, or drag to jump; at the end it goes live and plays new transactions as they happen.'],
        target: q('footer.timeline'),
      },
      {
        title: 'Views and looks',
        body: ['Switch between top-down, isometric and 3D here. Under 🎨 Looks you can pick a world theme for the 3D town: medieval, highland, modern or sci-fi.'],
        target: () => refs.views,
      },
      {
        title: 'Make it yours',
        body: ['Your own wallets are set up in the ⚙ Guild panel. Click Next to open it.'],
        target: () => refs.guildBtn,
      },
      {
        title: '1. A Zerion key',
        body: [el('p', {}, 'The town reads wallets through Zerion. Get a free API key at ', link, ', paste it here and click Save. It is kept only in this browser.')],
        before: () => {
          if (!this.#guildOpen) this.#openGuild();
        },
        target: q('.inspector input[aria-label="Zerion API key"]'),
      },
      {
        title: '2. Your wallets',
        body: ['Add a wallet address (0x…) or an ENS name (name.eth) and click Add, or Connect wallet. Each one becomes a hero; the demo heroes leave as soon as your first wallet has loaded.'],
        before: () => {
          if (!this.#guildOpen) this.#openGuild();
        },
        target: q('.inspector input[aria-label="0x… or name.eth"]'),
      },
      {
        title: 'Off you go',
        body: ['That is all. You can show this tour again any time with the ? button at the top.'],
      },
    ];
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

  /**
   * Work out the player (level and badges) from everything kept of your own
   * wallets' history. Only at home: a visited town is someone else's.
   */
  async #refreshPlayer(): Promise<void> {
    const shown = this.#shown;
    if (shown === null || shown.visiting !== null) return;
    this.#playerAt = Date.now();
    const raws = await this.#session.lifetime(shown).catch(() => shown.raws);
    if (this.#shown !== shown) return;
    const life = buildGuild(raws, { kind: 'count', count: Number.MAX_SAFE_INTEGER }, { names: this.#names });
    // badges seen before that the kept history no longer shows (prefs.medals, by wallet) are kept
    const remembered = new Map<string, Provenance>();
    for (const [wallet, ids] of Object.entries(this.#prefs.medals)) for (const [id, at] of Object.entries(ids)) if (medalById(id) && !remembered.has(id)) remembered.set(id, { at, wallet, journey: null });
    const player = playerProfile(life, remembered);
    // and new ones are remembered, under the wallet that earned them
    let changed = false;
    for (const [id, b] of player.badges) {
      const first = b.tiers[0]!;
      const kept = (this.#prefs.medals[first.wallet] ??= {});
      if (!(id in kept)) {
        kept[id] = first.at;
        changed = true;
      }
    }
    if (changed) savePrefs(this.#prefs);
    this.#player = player;
    this.#badgeMoments = badgeMoments(player);
    this.#playerBtn.textContent = `🛡 Lv ${player.level}`;
    this.#playerBtn.title = `You: level ${player.level} ${player.rank} · ${player.badges.size} badges — open your sheet`;
    if (this.#playerOpen && !this.#editingInspector()) this.#openPlayer();
  }

  /** Work the player out again soon (history arriving), at most every 15 s. */
  #playerSoon(): void {
    if (this.#playerTimer !== null) return;
    this.#playerTimer = setTimeout(() => {
      this.#playerTimer = null;
      void this.#refreshPlayer();
    }, Math.max(1500, 15_000 - (Date.now() - this.#playerAt)));
  }

  /** Badges this wallet earned first (for its hero's sheet). */
  #firstEarnedBy(address: string): Map<string, Earned> {
    const out = new Map<string, Earned>();
    for (const [id, b] of this.#player?.badges ?? []) {
      const first = b.tiers[0]!;
      if (first.wallet === address) out.set(id, { at: first.at, journey: first.journey });
    }
    return out;
  }

  #openPlayer(): void {
    const p = this.#player;
    if (p === null) return;
    this.#renderer.selected = null;
    const walking = this.#history?.statuses.filter((s) => !s.complete) ?? [];
    const reach = walking.length > 0 && walking.some((s) => s.oldest !== null) ? `back to ${new Date(Math.min(...walking.map((s) => s.oldest ?? Infinity))).getFullYear()} so far` : null;
    this.#openInspector(
      playerPanel(p, {
        walletName: (a) => this.#world.heroes.find((h) => h.address === a)?.name ?? `${a.slice(0, 6)}…${a.slice(-4)}`,
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

  /** A hero's title: any badge of yours unlocks its title for every one of your heroes. */
  #titleOf(address: string): string {
    const medals = [...(this.#player?.badges.keys() ?? [])];
    const cls = this.#classOf(address);
    const picked = this.#prefs.titles[address];
    const options = titleOptions(cls, medals);
    return picked !== undefined && options.includes(picked) ? picked : defaultTitle(cls, medals);
  }

  /** A badge (or a new tier of one) earned as the replay plays: a moment of glory in the corner of the town. */
  #announce(b: PlayerBadge, tier: number): void {
    const m = b.medal;
    const what = tier === 1 ? `You earned ${m.name}` : `${m.name}: ${BADGE_TIER_NAMES[tier]}`;
    const sub = tier === 1 ? `New title: ${m.title}` : `${b.single ? '' : `${tier === 2 ? 10 : 100} times now`}`;
    const toast = el('div', { class: 'toast' }, el('span', { class: 'toast-icon' }, m.icon), el('div', {}, el('strong', {}, what), el('div', { class: 'muted' }, sub)));
    toast.onclick = () => this.#openPlayer();
    this.#toasts.append(toast);
    this.#sound.fanfare();
    while (this.#toasts.children.length > 3) this.#toasts.firstElementChild?.remove();
    setTimeout(() => toast.classList.add('leaving'), 5000);
    setTimeout(() => toast.remove(), 5600);
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
    this.#rebuild();
    // you, from all your wallets' history (at home; a visited town leaves your level as it was)
    void this.#refreshPlayer();
    // ?at=<seconds>: start the replay at that moment (a link to it; tests)
    const at = Number(new URLSearchParams(location.search).get('at'));
    if (at > 0) this.#sim.seek(at);
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    this.#bell();
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
      this.#selectHero(target.address);
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
    this.#rebuild();
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    this.#sim.goLive();
    for (const j of this.#guild.journeys) if (!before.has(j.key)) this.#sim.playNow(j);
    this.#playerSoon();
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
          void this.#refreshPlayer();
          return said;
        },
        heroes: this.#guild.heroes,
        classOf: (a) => this.#classOf(a),
        onSelectHero: (a) => this.#selectHero(a),
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
    this.#rebuild();
    // ?at=<seconds>: start the replay at that moment (a link to it; tests)
    const at = Number(new URLSearchParams(location.search).get('at'));
    if (at > 0) this.#sim.seek(at);
    this.#r2d.setSim(this.#sim);
    this.#r3d?.setSim(this.#sim);
    this.#bell();
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
      el('h4', {}, el('span', {}, 'Value scale'), el('button', { class: 'fold', 'aria-label': 'Collapse the value scale', 'aria-expanded': 'true' }, '▾')),
      ...TIER_NAMES.map((name, i) => {
        const d = el('span', { class: 'legend-item' }, el('i', {}), `${name} ${i === 0 ? '<$10' : `$${short(TIER_FLOORS[i] ?? 0)}+`}`);
        const dot = d.querySelector('i');
        if (dot) dot.style.background = TIER_COLORS[i] ?? '#888';
        return d;
      }),
    );
    // folds to its title like the quest log (remembered)
    const legendFold = legend.querySelector<HTMLButtonElement>('.fold')!;
    const setLegendFolded = (folded: boolean): void => {
      legend.classList.toggle('collapsed', folded);
      legendFold.textContent = folded ? '▸' : '▾';
      legendFold.setAttribute('aria-expanded', String(!folded));
      legendFold.setAttribute('aria-label', folded ? 'Expand the value scale' : 'Collapse the value scale');
    };
    setLegendFolded(this.#prefs.legendFolded);
    legend.querySelector('h4')!.onclick = () => {
      this.#prefs.legendFolded = !this.#prefs.legendFolded;
      savePrefs(this.#prefs);
      setLegendFolded(this.#prefs.legendFolded);
    };

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
    this.#playerBtn.onclick = () => (this.#playerOpen ? this.#closeInspector() : this.#openPlayer());
    this.#realmBtn.onclick = () => (this.#realmMap ? this.#closeRealmMap() : this.#openRealmMap());
    this.#homeBtn.onclick = () => {
      this.#busy('town', 'Heading home…');
      void this.#session.home();
    };
    const header = el(
      'header',
      { class: 'topbar' },
      el('div', { class: 'brand' }, el('strong', {}, 'Wallet-landia'), this.#sourceEl),
      views,
      windowSel,
      qualitySel,
      this.#playerBtn,
      this.#realmBtn,
      this.#homeBtn,
      this.#statusEl,
      el('div', { class: 'spacer' }),
      this.#soundBtn,
      this.#inkEl,
      looksBtn,
      guildBtn,
      this.#tourBtn,
    );
    this.#tourRefs = { views, guildBtn, legend };

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
    const fold = el('button', { class: 'fold', 'aria-label': 'Collapse the quest log', 'aria-expanded': 'true' }, '▾');
    const questlog = el('section', { class: 'questlog' }, el('h4', {}, el('span', {}, 'Quest log'), fold), this.#log);
    const setFolded = (folded: boolean): void => {
      questlog.classList.toggle('collapsed', folded);
      fold.textContent = folded ? '▸' : '▾';
      fold.setAttribute('aria-expanded', String(!folded));
      fold.setAttribute('aria-label', folded ? 'Expand the quest log' : 'Collapse the quest log');
    };
    setFolded(this.#prefs.questlogFolded);
    questlog.querySelector('h4')!.onclick = () => {
      this.#prefs.questlogFolded = !this.#prefs.questlogFolded;
      savePrefs(this.#prefs);
      setFolded(this.#prefs.questlogFolded);
    };

    return el('div', { class: 'app' }, header, el('main', { class: 'world' }, this.#stage, questlog, legend, this.#toasts, this.#veil, this.#inspector, this.#tooltip), timeline);
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
    if (sim.played !== this.#logCount || sim.log.at(-1)?.journey.key !== this.#selectedKey) {
      // medals for journeys just played (not for a jump along the timeline)
      const fresh = sim.played - this.#logCount;
      if (this.#logCount >= 0 && fresh > 0 && fresh <= 3) for (const e of sim.log.slice(-fresh)) for (const m of this.#badgeMoments.get(e.journey.key) ?? []) this.#announce(m.badge, m.tier);
      this.#logCount = sim.played;
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
      else if (e.key === 'm') this.#setSound(!this.#sound.on);
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
      beat: this.#beat,
      medalsOf: (a) => this.#firstEarnedBy(a),
      playerBadges: () => [...(this.#player?.badges.keys() ?? [])],
      onPlayer: () => this.#openPlayer(),
      titleOf: (a) => this.#titleOf(a),
      setTitle: (a, t) => {
        if (t === null) delete this.#prefs.titles[a];
        else this.#prefs.titles[a] = t;
        savePrefs(this.#prefs);
        this.#selectHero(a);
      },
      setName: (a, name) => {
        this.#rename(a, name);
        this.#selectHero(a);
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
        this.#selectHero(a);
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

  #selectHero(address: string): void {
    const hero = this.#guild.heroes.find((h) => h.address === address);
    if (!hero) return;
    this.#renderer.selected = { kind: 'hero', address };
    this.#openInspector(heroPanel(hero, this.#ctx()));
  }

  #openInspector(body: HTMLElement, guild = false): void {
    this.#guildOpen = guild;
    this.#looksOpen = false;
    this.#playerOpen = false;
    this.#sim.route = null;
    this.#inspectorBody.replaceChildren(body);
    this.#inspector.hidden = false;
  }

  #closeInspector(): void {
    this.#guildOpen = false;
    this.#looksOpen = false;
    this.#playerOpen = false;
    this.#sim.route = null;
    this.#renderer.follow?.(null);
    this.#inspector.hidden = true;
    this.#renderer.selected = null;
  }
}

function short(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : String(n);
}
