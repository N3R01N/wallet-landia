/**
 * The castle view's entry (castle.html). The guild's wallets come from the
 * same session as the town (src/data/session.ts: the demo or captured wallets,
 * or live from Zerion with the player's key), become the castle's world
 * (world/world.ts), and the Castle and Town tabs show it in 3D. New
 * transactions send couriers out at once; each block rings the bell. Tapping a
 * protocol's building opens its sheet. The Badges and Guild tabs hold
 * placeholders for now.
 */

import { el } from '../ui/dom.js';
import { Shell } from './shell.js';
import { TAB_LABEL, type SheetState, type TabId } from './shellState.js';
import { CastleView } from './scene/castleView.js';
import { assetPath } from './assets/manifest.js';
import { loadCastleTheme, themeFileUrl } from './assets/theme.js';
import { newErrands, worldFromGuild, type CastleWorld } from './world/world.js';
import { weatherFor, type Weather } from './world/sky.js';
import { priceMove } from '../domain/risk.js';
import { chronicleSheet, errandSheet, protocolSheet } from './sheets.js';
import { buildGuild } from '../domain/mappers.js';
import { Session, type Mode, type Shown } from '../data/session.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { guildTab, modeText } from './guildTab.js';
import { BADGE_SHEET, badgeSheet, badgesTab, castleBadgeSheet } from './badgesTab.js';
import { castleBadges } from './world/castleBadges.js';
import { PlayerController } from '../ui/playerController.js';
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
    view = new CastleView({
      world,
      focus: tab,
      theme,
      weather,
      ...(pinnedHour !== undefined ? { hour: pinnedHour } : {}),
      onSelect: (b) => open({ id: SHEET_PREFIX + b.protocol.id, title: b.protocol.name }),
      onSelectErrand: (e) => open({ id: ERRAND_SHEET + e.key, title: e.label || 'A transaction' }),
      onToll: (e) => sound.tollNow(Math.min(3, e.tier / 2)),
    });
    // Test hook (dev server only): the browser tests find buildings on screen through it.
    if (import.meta.env.DEV) (window as unknown as { castleView?: CastleView }).castleView = view;
    // the chronicle: every recent transaction, a tap away
    const chronicle = el('button', { class: 'btn scene-action chronicle-btn', type: 'button', 'aria-label': 'Chronicle: recent transactions' }, '📜 Chronicle');
    chronicle.addEventListener('click', () => open({ id: CHRONICLE_SHEET, title: 'Chronicle' }));
    view.element.append(chronicle);
    return el('section', { class: 'tab-page scene-tab', 'data-tab-page': tab }, view.element);
  }
  view = null;
  if (tab === 'badges') return badgesTab(player.profile, themeNow, open, world ? castleBadges(world, player.profile?.stats ?? null) : []);
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
    if (e) return errandSheet(e, e.protocolId ? (world?.protocols.find((p) => p.id === e.protocolId)?.name ?? null) : null);
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
if (!root) throw new Error('#app is missing from castle.html');

const shell = new Shell({ renderTab, renderSheet, topbar: { guild: 'Your guild', rank: 'Wanderer', level: 'Lv 1' } });
root.replaceChildren(shell.element);

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
shell.addTopbarAction(soundBtn);
// Test hook (dev server only): what the sound has played.
if (import.meta.env.DEV) (window as unknown as { castleSound?: Soundscape }).castleSound = sound;

function worldOf(shown: Shown): CastleWorld {
  return worldFromGuild(buildGuild(shown.raws, prefs.window, { names: shown.names }));
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
  const p = player.profile;
  shell.setTopbar({ guild: shown?.label ?? 'Your guild', rank: p?.rank ?? 'Wanderer', level: `Lv ${p?.level ?? 1}` });
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

void session.home();
