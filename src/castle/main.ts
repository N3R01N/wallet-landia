/**
 * The castle view's entry (index.html). The guild's wallets come from the
 * same session as the town (src/data/session.ts: the demo or captured wallets,
 * or live from Zerion with the player's key), become the castle's world
 * (world/world.ts), and the Castle and Town tabs show it in 3D. New
 * transactions send couriers out at once; each block rings the bell. Tapping a
 * protocol's building opens its sheet. The Badges and Guild tabs hold
 * placeholders for now.
 */

import { inject } from '@vercel/analytics';
import { el, shortAddr } from '../util/dom.js';
import { Shell } from './shell.js';
import { TAB_LABEL, type SheetState, type TabId } from './shellState.js';
import { CastleView } from './scene/castleView.js';
import { assetPath } from './assets/manifest.js';
import { loadCastleTheme, themeFileUrl } from './assets/theme.js';
import { newErrands, worldFromGuild, type CastleWorld } from './world/world.js';
import { lightAt, weatherFor, type Weather } from './world/sky.js';
import { priceMove } from '../domain/risk.js';
import { chronicleSheet, errandSheet, protocolSheet } from './sheets.js';
import { buildGuild } from '../domain/mappers.js';
import { Session, type Mode, type Shown } from '../data/session.js';
import { setRealmChains } from '../data/zerion/endpoints.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { guildTab, modeText } from './guildTab.js';
import { decodeShare } from './share.js';
import { attachTimeline } from './timeline.js';
import { attachArrange, type ArrangeTap } from './arrange.js';
import { Tour } from './tour.js';
import { tourSteps } from './tourSteps.js';
import { BADGE_SHEET, badgeSheet, badgesTab, castleBadgeSheet, playerTitle, type WalletQuest } from './badgesTab.js';
import { teachingQuests } from '../domain/feats.js';
import type { Guild } from '../domain/model.js';
import { castleBadges } from './world/castleBadges.js';
import { PlayerController } from './player.js';
import type { CastleTheme } from './assets/theme.js';
import { setRpcUrl, startHeartbeat, validRpcUrl } from '../data/rpc.js';
import { loadPrefs, savePrefs } from '../settings.js';
import { Soundscape } from '../audio/soundscape.js';
import { setCrests } from '../util/rng.js';

const SHEET_PREFIX = 'protocol:';
const ERRAND_SHEET = 'errand:';
const CHRONICLE_SHEET = 'chronicle';

/** The theme's manifest, read once: its version keeps players' copies of the models fresh. */
const theme = loadCastleTheme(import.meta.env.BASE_URL);
const prefs = loadPrefs();
// Ethereum only for now (docs/REDESIGN.md §14b): the castle's town is mainnet; other chains come later.
setRealmChains(['ethereum']);
// the crests the player chose (in the town) colour their towers' flags here too
setCrests(prefs.crests);
/** The theme once its manifest is read (the badge and rank pictures need its version). */
let themeNow: CastleTheme | null = null;

let world: CastleWorld | null = null;
let view: CastleView | null = null;
let mode: Mode | null = null;
let budget: BudgetSnapshot | null = null;
let shown: Shown | null = null;
/** The market's weather: ETH now against the last visit more than an hour ago (null until known). */
let weather: Weather = weatherFor(null);
let priceSettled = false;
const hourParam = Number(new URLSearchParams(location.search).get('hour'));
const pinnedHour = Number.isFinite(hourParam) && new URLSearchParams(location.search).has('hour') ? hourParam : undefined;

function placeholderScene(label: string): HTMLElement {
  return el('div', { class: 'scene-placeholder' }, el('p', {}, label));
}

function renderTab(tab: TabId, open: (sheet: SheetState) => void): HTMLElement {
  if (tab === 'castle' || tab === 'town') {
    if (!world) {
      view = null;
      return el('section', { class: 'tab-page', 'data-tab-page': tab }, placeholderScene('Raising the castle…'));
    }
    // The castle and the town are one scene; the camera starts on the chosen part.
    // Your own castle keeps your arrangement (build mode); a visited one is shown as it comes.
    const own = !shown?.visiting;
    let arrangeTap: ((tap: ArrangeTap) => void) | null = null;
    view = new CastleView({
      ...(own ? { arranged: prefs.castleArrangement } : {}),
      onArrangeTap: (tap) => arrangeTap?.(tap),
      world,
      focus: tab,
      theme,
      weather,
      ...(pinnedHour !== undefined ? { hour: pinnedHour } : {}),
      onSelect: (b) => open({ id: SHEET_PREFIX + b.protocol.id, title: b.protocol.name }),
      onSelectErrand: (e) => open({ id: ERRAND_SHEET + e.key, title: e.label || 'A transaction' }),
      onToll: (e) => sound.tollNow(Math.min(3, e.tier / 2)),
      onRefused: () => sound.refused(),
    });
    // Test hook (dev server only): the browser tests find buildings on screen through it.
    if (import.meta.env.DEV) (window as unknown as { castleView?: CastleView }).castleView = view;
    // the chronicle: every recent transaction, a tap away
    const chronicle = el('button', { class: 'btn scene-action chronicle-btn', type: 'button', 'aria-label': 'Chronicle: recent transactions' }, '📜 Chronicle');
    chronicle.addEventListener('click', () => open({ id: CHRONICLE_SHEET, title: 'Chronicle' }));
    view.element.append(chronicle);
    attachTimeline(view, world.errands);
    if (own)
      arrangeTap = attachArrange(view, {
        get: () => prefs.castleArrangement,
        set: (a) => {
          prefs.castleArrangement = a;
          savePrefs(prefs);
        },
      });
    return el('section', { class: 'tab-page scene-tab', 'data-tab-page': tab }, view.element);
  }
  view = null;
  if (tab === 'badges')
    return badgesTab(player.profile, themeNow, open, world ? castleBadges(world, player.profile?.stats ?? null) : [], {
      picked: prefs.title,
      onPick: (t) => {
        prefs.title = t;
        savePrefs(prefs);
        showTopbar();
      },
    }, walletQuests());
  if (tab === 'guild') {
    return guildTab({
      prefs,
      mode,
      budget,
      onWalletsChanged: () => void session.home(),
      onKeyChanged: () => {
        session.keyChanged();
        void session.home();
      },
      refresh: () => shell.refresh(),
      onExportHistory: async () => {
        const blob = await session.exportHistory();
        if (blob === null) return false;
        const a = el('a', { href: URL.createObjectURL(blob), download: `wallet-landia-history-${new Date().toISOString().slice(0, 10)}.json.gz` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        return true;
      },
      onImportHistory: async (data) => {
        const said = await session.importHistory(data);
        void player.refresh();
        return said;
      },
      onRpc: (url) => {
        prefs.rpcUrl = url;
        savePrefs(prefs);
        setRpcUrl(url);
      },
      visiting: shown?.visiting ?? null,
      onVisit: (a) => {
        void session.visit(a);
        shell.go('castle');
      },
    });
  }
  const wrap = el('section', { class: 'tab-page', 'data-tab-page': tab });
  wrap.append(el('h1', {}, TAB_LABEL[tab]));
  wrap.append(placeholderScene(`${TAB_LABEL[tab]} view arrives in a later step.`));
  return wrap;
}

function renderSheet(sheet: SheetState): HTMLElement {
  if (sheet.id === CHRONICLE_SHEET) return chronicleSheet(world?.errands ?? [], (e) => shell.open({ id: ERRAND_SHEET + e.key, title: e.label || 'A transaction' }));
  if (sheet.id.startsWith(ERRAND_SHEET)) {
    const e = world?.errands.find((x) => x.key === sheet.id.slice(ERRAND_SHEET.length));
    if (e)
      return errandSheet(e, e.protocolId ? (world?.protocols.find((p) => p.id === e.protocolId)?.name ?? null) : null, () => {
        // its courier goes next; the sheet closes so the scene shows it
        view?.enqueue([e]);
        shell.close();
      });
  }
  if (sheet.id.startsWith(BADGE_SHEET)) {
    const id = sheet.id.slice(BADGE_SHEET.length);
    const castle = world ? castleBadges(world, player.profile?.stats ?? null).find((b) => b.id === id) : undefined;
    return castle ? castleBadgeSheet(castle, themeNow) : badgeSheet(id, player.profile, themeNow);
  }
  const id = sheet.id.startsWith(SHEET_PREFIX) ? sheet.id.slice(SHEET_PREFIX.length) : null;
  const p = id ? world?.protocols.find((x) => x.id === id) : undefined;
  return p ? protocolSheet(p) : el('div', { class: 'sheet-content' }, el('p', {}, 'Details arrive here.'));
}

/** Sound: off until the player turns it on (the same setting as the town). */
const sound = new Soundscape();
sound.setVolume(prefs.volume);

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from index.html');

const shell = new Shell({ renderTab, renderSheet, topbar: { guild: 'Your guild', rank: 'Wanderer', level: 'Lv 1' } });
root.replaceChildren(shell.element);

/** Back to your own castle, while visiting someone else's. */
const homeBtn = el('button', { class: 'btn home-btn', type: 'button', hidden: '' }, '⌂ Return home');
homeBtn.addEventListener('click', () => {
  // leaving a shared castle: the link's hash goes, so a reload is home
  if (decodeShare(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  void session.home();
});

const soundBtn = el('button', { class: 'btn sound-toggle', type: 'button', 'aria-label': 'Sound', 'aria-pressed': 'false' }, '🔇');
function showSound(): void {
  soundBtn.textContent = sound.on ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(sound.on));
  soundBtn.title = sound.on ? 'Sound on: the bell for each block, coins at the toll' : 'Sound off';
}
soundBtn.addEventListener('click', () => {
  sound.setOn(!sound.on);
  prefs.sound = sound.on;
  savePrefs(prefs);
  showSound();
});
// on after a reload: it starts with the first tap (browsers allow sound only after one)
if (prefs.sound) sound.setOn(true);
showSound();
// the tour: once on a first visit, and again from the ? button
const TOUR_SEEN = 'wallet-landia-v4/castle/tour-seen';
const tourBtn = el('button', { class: 'btn topbar-icon tour-btn', type: 'button', 'aria-label': 'Show the tour', title: 'Show the tour' }, '?');
function startTour(): void {
  new Tour(
    tourSteps({ go: (t) => shell.go(t), find: (sel) => shell.element.querySelector<HTMLElement>(sel), demo: mode === 'demo' || mode === 'captured' }),
    () => {
      try {
        localStorage.setItem(TOUR_SEEN, '1');
      } catch {
        // storage unavailable: it may show again next time
      }
    },
  ).start();
}
tourBtn.addEventListener('click', startTour);
let tourOffered = false;
/** On the first visit, once the castle is up: the tour. */
function offerTour(): void {
  if (tourOffered) return;
  tourOffered = true;
  let seen = false;
  try {
    seen = localStorage.getItem(TOUR_SEEN) === '1';
  } catch {
    seen = true; // no storage: do not insist on every visit
  }
  if (!seen && !new URLSearchParams(location.search).has('notour')) setTimeout(startTour, 800);
}
shell.addTopbarAction(tourBtn);
shell.addTopbarAction(homeBtn);
shell.addTopbarAction(soundBtn);
// the ambience: rain from the market, birds by day, crickets at night
setInterval(() => {
  const now = new Date();
  sound.ambience(weather.rain, lightAt(pinnedHour ?? now.getHours() + now.getMinutes() / 60).night);
}, 1000);
// Test hook (dev server only): what the sound has played.
if (import.meta.env.DEV) (window as unknown as { castleSound?: Soundscape }).castleSound = sound;

/** Your own guild (never a visited one): its teaching quests. */
let homeGuild: Guild | null = null;

function worldOf(town: Shown): CastleWorld {
  const guild = buildGuild(town.raws, prefs.window, { names: town.names });
  if (town.visiting === null) homeGuild = guild;
  return worldFromGuild(guild);
}

/** Each of your wallets' teaching quests. */
function walletQuests(): WalletQuest[] {
  const g = homeGuild;
  if (!g) return [];
  return g.heroes.flatMap((h) => teachingQuests(h, g).map((quest) => ({ wallet: h.address, walletName: prefs.ens[h.address] ?? shortAddr(h.address), quest })));
}

/** Whether the castle and the town would be laid out differently (then the scene is built again). */
function layoutChanged(a: CastleWorld, b: CastleWorld): boolean {
  const shape = (w: CastleWorld) => JSON.stringify([w.wallets, w.tier, w.protocols]);
  return shape(a) !== shape(b);
}

/**
 * New data: the scene tabs are built again; a form tab is not (that would wipe
 * what the player is typing), only its line about where the data comes from.
 */
function redrawForData(): void {
  const tab = shell.state.tab;
  if (tab === 'castle' || tab === 'town') shell.refresh();
  const source = shell.element.querySelector('.guild-tab .source');
  if (source) source.textContent = modeText(mode);
}

/**
 * "Since you were last here": the ETH price seen on a visit more than an hour
 * ago is the baseline (the town's rule and setting, prefs.eth), once per load,
 * and only at home.
 */
function settlePrice(w: CastleWorld): void {
  if (priceSettled || shown?.visiting || w.ethUsd === null) return;
  priceSettled = true;
  const eth = prefs.eth;
  const t = Date.now();
  if (eth.seen && t - eth.seen.at > 60 * 60_000) eth.prev = eth.seen;
  eth.seen = { usd: w.ethUsd, at: t };
  savePrefs(prefs);
  weather = weatherFor(eth.prev ? priceMove(w.ethUsd, eth.prev).mood : null);
  view?.setWeather(weather);
}

function showTopbar(): void {
  homeBtn.hidden = !shown?.visiting;
  const p = player.profile;
  shell.setTopbar({ guild: shown?.label ?? 'Your guild', rank: p?.rank ?? 'Wanderer', level: `Lv ${p?.level ?? 1}` });
  shell.setRankTitle(p ? `${p.rank}, ${playerTitle(p, prefs.title)}` : '');
}

const session = new Session(prefs, {
  onTown: (town) => {
    shown = town;
    world = worldOf(town);
    mode = town.mode;
    settlePrice(world);
    showTopbar();
    redrawForData();
    void player.refresh();
    if (!town.visiting) offerTour();
  },
  onUpdate: (town) => {
    shown = town;
    player.soon();
    const next = worldOf(town);
    const fresh = newErrands(world, next);
    const rebuild = !world || layoutChanged(world, next);
    world = next;
    if (rebuild) redrawForData();
    else view?.enqueue(fresh);
  },
  onStatus: (text, kind) => shell.setStatus(text, kind),
  onBudget: (snap) => {
    budget = snap;
  },
});

// the player's own node, if they chose one (the same setting as the town)
if (prefs.rpcUrl !== '' && validRpcUrl(prefs.rpcUrl)) setRpcUrl(prefs.rpcUrl);
startHeartbeat((beat) => {
  view?.ringBell();
  sound.ringNow(0.5 + beat.busy * 0.5); // a fuller block rings louder
  void session.onBlock();
});

/** The player: level, rank and badges from all the guild's history, worked out off the main thread. */
const player = new PlayerController({
  session,
  prefs,
  shown: () => shown,
  names: () => shown?.names ?? new Map(),
  classOf: () => 'adventurer',
  changed: () => {
    showTopbar();
    if (shell.state.tab === 'badges') shell.refresh();
  },
});

void theme.then((t) => {
  themeNow = t;
  shell.setTabIcons((tab) => themeFileUrl(t, assetPath({ name: `ui.icon.${tab}`, kind: 'art' })));
  if (shell.state.tab === 'badges') shell.refresh();
});


// Keep the castle's files on the device (public/sw.js): a returning player
// downloads nothing that has not changed. Production only: in development
// the dev server's files change constantly.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e: unknown) => console.warn('service worker', e));
  });
}

// Vercel Web Analytics: cookie-less page views, on the deployed site only (the
// script and its reports are same-origin there, /_vercel/insights/, so the
// page's security policy needs no change). Query strings are dropped: only the
// page path is counted.
if (import.meta.env.PROD) {
  inject({
    mode: 'production',
    beforeSend: (event) => ({ ...event, url: event.url.split('?')[0] ?? event.url }),
  });
}

/** A shared castle's link opens it (read-only); otherwise your own. A link followed later does too. */
function openFromLink(): void {
  const shared = decodeShare(location.hash);
  if (shared) void session.visit(shared.wallets, shared.name || undefined);
  else void session.home();
}
window.addEventListener('hashchange', openFromLink);
openFromLink();
