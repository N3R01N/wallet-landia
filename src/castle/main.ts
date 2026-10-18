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
import { CastleView, proxied } from './scene/castleView.js';
import { assetPath } from './assets/manifest.js';
import { artTheme, loadCastleTheme, themeChain, themeFileUrl, themeFromUrl } from './assets/theme.js';
import { newErrands, previewWorld, worldFromGuild, type CastleWorld } from './world/world.js';
import { lightAt, weatherFor, type Weather } from './world/sky.js';
import { priceMove } from '../domain/risk.js';
import { chronicleSheet, collateralSheet, errandSheet, guildSheet, personSheet, protocolSheet, walletSheet } from './sheets.js';
import { pickLine } from './world/chatter.js';
import { gondiTxs, lentLoans, type LentLoan } from '../data/gondi.js';
import { nftLook, type NftLook } from '../data/nftLook.js';
import type { Goods } from '../domain/model.js';
import { protocolFamily } from './assets/manifest.js';
import type { Person } from './scene/life.js';
import { Conditions } from './conditions.js';
import { logoPath } from './world/logos.js';
import { buildGuild, ethMarketOf } from '../domain/mappers.js';
import { Session, type Mode, type Shown } from '../data/session.js';
import { setRealmChains } from '../data/zerion/endpoints.js';
import type { BudgetSnapshot } from '../data/zerion/budget.js';
import { guildTab, historyRows, modeText, walletDisplayName } from './guildTab.js';
import type { LedgerStatus } from '../data/ledger.js';
import { decodeShare } from './share.js';
import { attachTimeline, type Timeline } from './timeline.js';
import { attachArrange, type Arrange, type ArrangeTap } from './arrange.js';
import { Tour } from './tour.js';
import { tourSteps } from './tourSteps.js';
import { LoadingScreen } from './loadingScreen.js';
import { BADGE_SHEET, badgeSheet, badgesTab, castleBadgeSheet, playerTitle, type WalletQuest } from './badgesTab.js';
import { teachingQuests } from '../domain/feats.js';
import type { Guild } from '../domain/model.js';
import { castleBadges } from './world/castleBadges.js';
import { PlayerController } from './player.js';
import type { CastleTheme } from './assets/theme.js';
import { currentRpcUrl, setRpcUrl, startHeartbeat, validRpcUrl } from '../data/rpc.js';
import { loadPrefs, savePrefs } from '../settings.js';
import { Soundscape } from '../audio/soundscape.js';
import { crestColors, setCrests } from '../util/rng.js';
import { SIEGE_PARAM, SiegeMode } from '../game/ui/siegeMode.js';

const SHEET_PREFIX = 'protocol:';
const ERRAND_SHEET = 'errand:';
const CHRONICLE_SHEET = 'chronicle';
const WALLET_SHEET = 'wallet:';
const KEEP_SHEET = 'keep';
const CONDITIONS_SHEET = 'conditions';
const PERSON_SHEET = 'person';
const COLLATERAL_SHEET = 'collateral:';
/** A loan's collateral a wallet holds: kept in its hall with its NFTs (its gallery in the wallet's sheet). */
interface Collateral {
  key: string;
  wallet: string;
  goods: Goods;
}
/** The loans' collateral the guild holds now (framed before the halls), and each loan by its NFT, for its sheet. */
let collateralNow: Collateral[] = [];
const loansNow = new Map<string, { loan: LentLoan; goods: Goods; since: number | null }>();
/** The townsperson last tapped (the person sheet's subject). */
let personNow: { who: Person; line: string | null } | null = null;

/** The theme's manifest, read once: its version keeps players' copies of the models fresh. */
// `?theme=` picks another theme (a style pilot extends the default; what it lacks comes from there)
const theme = loadCastleTheme(import.meta.env.BASE_URL, themeFromUrl(location.search));
const prefs = loadPrefs();
// Ethereum only for now (docs/REDESIGN.md §14b): the castle's town is mainnet; other chains come later.
setRealmChains(['ethereum']);
// the crests the player chose (in the town) colour their towers' flags here too
setCrests(prefs.crests);
/** The theme once its manifest is read (the badge and rank pictures need its version). */
let themeNow: CastleTheme | null = null;
/** The theme once loaded: the castle's layout depends on it, so the scene waits for it. */
let themeLoaded: CastleTheme | null = null;

let world: CastleWorld | null = null;
/** The replay timeline of the scene shown. */
let timelineNow: Timeline | null = null;
/** Build mode on the scene shown (your own castle only). */
let arrangeNow: Arrange | null = null;
let view: CastleView | null = null;
let mode: Mode | null = null;
let budget: BudgetSnapshot | null = null;
let shown: Shown | null = null;
/** The market's weather: ETH's move over the last 24 hours (null until known). */
let weather: Weather = weatherFor(null);
// `?market=boom|up|flat|down|crash` shows that weather (for looking at it), whatever ETH did
const marketParam = new URLSearchParams(location.search).get('market');
const pinnedMood = (['boom', 'up', 'flat', 'down', 'crash'] as const).find((m) => m === marketParam) ?? null;
if (pinnedMood) weather = weatherFor(pinnedMood);
let priceSettled = false;
const hourParam = Number(new URLSearchParams(location.search).get('hour'));
const pinnedHour = Number.isFinite(hourParam) && new URLSearchParams(location.search).has('hour') ? hourParam : undefined;
/** `?quality=low|high`; on the dev server also a stored pick (the browser tests render low: software WebGL is slow). */
const qualityParam = ((q) => (q === 'low' || q === 'high' ? q : 'auto'))(
  new URLSearchParams(location.search).get('quality') ?? (import.meta.env.DEV ? devStored('wallet-landia-v4/dev/quality') : null),
);

function devStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function placeholderScene(label: string): HTMLElement {
  return el('div', { class: 'scene-placeholder' }, el('p', {}, label));
}

function renderTab(tab: TabId, open: (sheet: SheetState) => void): HTMLElement {
  if (tab === 'castle') {
    if (!world || !themeLoaded) {
      view = null;
      return el('section', { class: 'tab-page', 'data-tab-page': tab }, placeholderScene('Raising the castle…'));
    }
    // The castle and the town are one scene; the camera starts on the chosen part.
    // Your own castle keeps your arrangement (build mode); a visited one is shown as it comes.
    const own = !shown?.visiting;
    arrangeNow = null;
    view = new CastleView({
      ...(own ? { arranged: prefs.castleArrangement } : {}),
      onArrangeTap: (tap: ArrangeTap) => arrangeNow?.tap(tap),
      world,
      focus: tab,
      theme,
      layout: themeLoaded.castleLayout ?? 1,
      weather,
      ...(pinnedHour !== undefined ? { hour: pinnedHour } : {}),
      // `?quality=low|high` pins the rendering quality; otherwise it adapts to the device
      quality: qualityParam,
      onSelect: (b) => {
        const icon = protocolLogo(b.protocol.id);
        open({ id: SHEET_PREFIX + b.protocol.id, title: b.protocol.name, ...(icon ? { icon } : {}) });
      },
      onSelectWallet: (i) => open({ id: WALLET_SHEET + i, title: walletName(i) }),
      onSelectKeep: () => open({ id: KEEP_SHEET, title: shown?.label ?? 'Your guild' }),
      onTapped: (what) => sound.tap(what),
      chatter: (who) => pickLine({ mood: pinnedMood ?? conditions.mood, road: conditions.road, trade: who.trade }, Math.random()),
      onSelectPerson: (who, line) => {
        personNow = { who, line };
        // a fresh sheet each tap (its line changes): the same id would keep the old one
        open({ id: `${PERSON_SHEET}:${Date.now()}`, title: `${who.role} · NPC` });
      },
      onCoin: (i, n, incoming) => sound.coinTink(i, n, incoming),
      onNft: (landed) => sound.nftShimmer(landed),
      onReady: () => loading.report('welcome'),
      onSelectErrand: (e) => open({ id: ERRAND_SHEET + e.key, title: e.label || 'A transaction' }),
      onToll: (e) => sound.tollNow(Math.min(3, e.tier / 2)),
      onRefused: () => sound.refused(),
      // the siege's enemy castle and its battlefield, while the game is on (src/game)
      extend: (plan) => siege.extension(plan) ?? { placements: [] },
    });
    // Test hook (dev server only): the browser tests find buildings on screen through it.
    if (import.meta.env.DEV) (window as unknown as { castleView?: CastleView }).castleView = view;
    // the chronicle: every recent transaction, a tap away
    const chronicle = el('button', { class: 'btn scene-action chronicle-btn', type: 'button', 'aria-label': 'Chronicle: recent transactions' }, '📜 Chronicle');
    chronicle.addEventListener('click', () => open({ id: CHRONICLE_SHEET, title: 'Chronicle' }));
    view.element.append(chronicle);
    timelineNow = attachTimeline(view, world.errands, {
      range: prefs.replayRange,
      setRange: (id) => {
        prefs.replayRange = id;
        savePrefs(prefs);
      },
    });
    if (own)
      arrangeNow = attachArrange(view, {
        get: () => prefs.castleArrangement,
        set: (a) => {
          prefs.castleArrangement = a;
          savePrefs(prefs);
        },
      });
    siege.attach(view);
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
      history: historyWalk,
      onTapSound: (i) => {
        sound.tapStyle = i;
        if (!sound.on) {
          sound.setOn(true);
          prefs.sound = true;
          savePrefs(prefs);
          showSound();
        }
        // a moment for the audio to wake on the first tap
        setTimeout(() => sound.tap('building', i), sound.state === 'running' ? 0 : 150);
      },
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
        // the timeline plays from where it happened, and the camera goes with its courier
        if (timelineNow) timelineNow.startAt(e);
        else view?.sendNow(e);
        view?.follow(e);
        shell.close();
      });
  }
  if (sheet.id.startsWith(BADGE_SHEET)) {
    const id = sheet.id.slice(BADGE_SHEET.length);
    const castle = world ? castleBadges(world, player.profile?.stats ?? null).find((b) => b.id === id) : undefined;
    return castle ? castleBadgeSheet(castle, themeNow) : badgeSheet(id, player.profile, themeNow);
  }
  if (sheet.id === CONDITIONS_SHEET) return conditions.sheet();
  if (sheet.id.startsWith(COLLATERAL_SHEET)) {
    const key = sheet.id.slice(COLLATERAL_SHEET.length);
    const held = loansNow.get(key);
    if (held)
      return collateralSheet(
        { ...held, wallet: walletName(world?.walletIds.indexOf(held.loan.wallet) ?? 0) },
        collateralNow.map((c) => ({ key: c.key, name: c.goods.name ?? c.goods.symbol, current: c.key === key })),
        (k) => shell.open({ id: COLLATERAL_SHEET + k, title: '🔒 Collateral' }),
      );
  }
  if (sheet.id.startsWith(PERSON_SHEET + ':') && personNow) {
    const b = personNow.who.building ? world?.protocols.find((p) => p.name === personNow!.who.building) : undefined;
    return personSheet(personNow.who, personNow.line, b ? () => shell.open({ id: SHEET_PREFIX + b.id, title: b.name }) : undefined);
  }
  if (sheet.id.startsWith(WALLET_SHEET)) {
    const i = Number(sheet.id.slice(WALLET_SHEET.length));
    const hero = guildNow?.heroes[i];
    if (hero && world)
      return walletSheet(
        {
          hero,
          name: walletName(i),
          crest: crestColors(hero.address)[0],
          errands: world.errands.filter((e) => e.wallet === hero.address),
          protocolName: (id) => guildNow?.protocols.get(id)?.name ?? id,
          collateral: collateralNow.filter((c) => c.wallet === hero.address.toLowerCase() || c.wallet === hero.address),
          openCollateral: (key) => shell.open({ id: COLLATERAL_SHEET + key, title: '🔒 Collateral' }),
        },
        (e) => shell.open({ id: ERRAND_SHEET + e.key, title: e.label || 'A transaction' }),
        () => shell.go('guild'),
      );
  }
  if (sheet.id === KEEP_SHEET && guildNow && world) {
    const heroes = guildNow.heroes;
    const p = player.profile;
    return guildSheet(
      {
        wallets: heroes.map((h, i) => ({ name: walletName(i), crest: crestColors(h.address)[0], worth: h.netWorth, tier: h.tier, address: h.address })),
        worth: heroes.reduce((t, h) => t + h.netWorth, 0),
        tier: world.tier,
        protocols: world.protocols.length,
        errands: world.errands.length,
        level: p ? `Level ${p.level} · ${p.rank}, ${playerTitle(p, prefs.title)}` : null,
        xp: p ? `${p.xp.toLocaleString('en-US')} XP · ${Math.max(0, p.nextXp - p.xp).toLocaleString('en-US')} to level ${p.level + 1}` : null,
      },
      (i) => shell.open({ id: WALLET_SHEET + i, title: walletName(i) }),
      () => shell.go('badges'),
    );
  }
  const id = sheet.id.startsWith(SHEET_PREFIX) ? sheet.id.slice(SHEET_PREFIX.length) : null;
  const p = id ? world?.protocols.find((x) => x.id === id) : undefined;
  // your own town: the building can be moved from its sheet (build mode)
  const move = p && arrangeNow && !shown?.visiting ? () => {
    shell.close();
    arrangeNow?.start(p.id, p.name);
  } : undefined;
  return p ? protocolSheet(p, move) : el('div', { class: 'sheet-content' }, el('p', {}, 'Details arrive here.'));
}

/** Sound: off until the player turns it on (the same setting as the town). */
const sound = new Soundscape();
sound.setVolume(prefs.volume);
sound.tapStyle = prefs.tapSound;

/** The first load: the wallets, the castle's models, a welcome (loadingScreen.ts). */
const loading = new LoadingScreen();
document.body.append(loading.element);
loading.report('wallets');
// Test hook (dev server only): the phases the loader showed.
if (import.meta.env.DEV) (window as unknown as { castleLoading?: LoadingScreen }).castleLoading = loading;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from index.html');

/** Siege of the Ledger: the game over the castle view, a topbar switch away (src/game). */
const siege = new SiegeMode({
  on: new URLSearchParams(location.search).get(SIEGE_PARAM) === 'siege',
  // the wallets on show (yours, or a visited guild's): one is picked to import
  wallets: () => (guildNow?.heroes ?? []).map((hero, i) => ({ name: walletName(i), hero })),
  protocols: () => guildNow?.protocols ?? new Map(),
  // the castle view is built again, with or without the siege's battlefield
  onChange: () => shell.go('castle'),
});

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
    tourSteps({ go: (t) => shell.go(t), look: (w) => view?.lookAt(w), find: (sel) => shell.element.querySelector<HTMLElement>(sel), demo: mode === 'demo' || mode === 'captured' }),
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
// the market and the road at a glance; the numbers in a sheet (conditions.ts)
const conditions = new Conditions(() => shell.open({ id: CONDITIONS_SHEET, title: 'Market and road' }));
// settings: the key, the wallets, their names and crest colours live in the Guild tab
const settingsBtn = el('button', { class: 'btn topbar-icon settings-btn', type: 'button', 'aria-label': 'Settings: key, wallets, crest colours', title: 'Settings: your Zerion key, wallets, names and crest colours' }, '⚙');
settingsBtn.addEventListener('click', () => shell.go('guild'));
shell.addTopbarAction(siege.button);
// Ledger Wars, the real-time strategy mode, on its own page (src/rts)
shell.addTopbarAction(
  el('a', { class: 'btn rts-link', href: `${import.meta.env.BASE_URL}rts.html`, 'aria-label': 'Ledger Wars (real-time strategy)', title: 'Ledger Wars: build, stake and command your army in real time' }, '🗡', el('span', { class: 'siege-word' }, ' RTS')),
);
shell.addTopbarAction(conditions.chip);
shell.addTopbarAction(settingsBtn);
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
/** The guild on show (yours, or a visited one): its wallets' sheets. */
let guildNow: Guild | null = null;

/** A wallet's name: its ENS or label, else its short address. */
function walletName(i: number): string {
  const h = guildNow?.heroes[i];
  if (!h) return 'A wallet';
  if (shown?.visiting) return prefs.ens[h.address] || (h.name && !h.name.startsWith('0x') ? h.name : shortAddr(h.address));
  return walletDisplayName(prefs, h.address);
}

/** A protocol's logo picture (the bundled one, else the icon Zerion gives it), for its sheet's title. */
function protocolLogo(id: string): string | undefined {
  const path = logoPath(id);
  const t = themeLoaded;
  if (path && t) {
    const chain = themeChain(t);
    return themeFileUrl(chain[chain.length - 1]!, path);
  }
  const icon = world?.protocols.find((p) => p.id === id)?.iconUrl;
  return icon ? proxied(icon) : undefined;
}

function worldOf(town: Shown): CastleWorld {
  const guild = buildGuild(town.raws, prefs.window, { names: town.names });
  if (town.visiting === null) homeGuild = guild;
  guildNow = guild;
  const real = worldFromGuild(guild);
  // `?preview=lido,spark,lending:5e6` shows those buildings in town instead (for looking at models)
  const preview = new URLSearchParams(location.search).get('preview');
  return preview ? previewWorld(real, preview) : real;
}

/**
 * Gondi loans the guild lent, read from the chain (data/gondi.ts): the courier
 * that lent brings the collateral home (a padlocked frame), the one that
 * brought the loan's end takes it back, and those still running stand framed
 * before the lending wallet's hall.
 */
async function readCollateral(w: CastleWorld, town: Shown): Promise<void> {
  const gondi = w.errands.filter((e) => e.protocolId !== null && protocolFamily(e.protocolId) === 'gondi' && e.direction !== 'inside');
  if (!gondi.length) {
    collateralNow = [];
    return;
  }
  // Gondi's escrow contracts: the pools of the guild's Gondi positions (the loans' own events add theirs)
  const pools = new Set<string>();
  for (const r of town.raws) for (const p of r.complex) if (/gondi/i.test(p.attributes.protocol ?? '') && p.attributes.pool_address) pools.add(p.attributes.pool_address.toLowerCase());
  const txs = await gondiTxs(gondi.map((e) => e.hash), pools, currentRpcUrl());
  if (world !== w) return; // a newer town came meanwhile
  const looks = new Map<string, Promise<NftLook>>();
  const look = (c: string, id: string) => {
    const k = `${c}:${id}`;
    if (!looks.has(k)) looks.set(k, nftLook(c, id, currentRpcUrl()));
    return looks.get(k)!;
  };
  const held: Collateral[] = [];
  for (const wallet of w.walletIds) {
    const mine = gondi.filter((e) => e.wallet === wallet).sort((a, b) => a.time - b.time);
    const loans = lentLoans(wallet, mine.flatMap((e) => txs.get(e.hash.toLowerCase()) ?? []));
    for (const l of loans) void look(l.collection, l.tokenId); // all at once
    for (const loan of loans) {
      const nft = await look(loan.collection, loan.tokenId);
      if (world !== w) return;
      const goods: Goods = { symbol: nft.collection ?? 'NFT', quantity: 1, usd: null, isNft: true, name: `${nft.collection ?? 'NFT'} #${loan.tokenId}`, ...(nft.image ? { image: nft.image } : {}), collateral: true };
      const start = mine.find((e) => e.hash.toLowerCase() === loan.startedBy);
      // the courier that lent brings it home
      const last = start?.steps[start.steps.length - 1];
      if (last && !last.get.some((g) => g.collateral)) last.get.push(goods);
      if (loan.end) {
        const end = mine.find((e) => e.hash.toLowerCase() === loan.end!.by);
        if (end) end.collateralBack = goods;
        continue;
      }
      const key = `${loan.collection}:${loan.tokenId}`;
      held.push({ key, wallet, goods });
      loansNow.set(key, { loan, goods, since: start?.time ?? null });
    }
  }
  collateralNow = held;
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
  if (tab === 'castle') shell.refresh();
  const source = shell.element.querySelector('.guild-tab .source');
  if (source) source.textContent = modeText(mode);
}

/**
 * ETH's price and how it moved over the last day (the sky follows it): read
 * live from Zerion, else from the wallets' own ETH, once per load and only at home.
 */
async function settlePrice(w: CastleWorld, town: Shown): Promise<void> {
  if (priceSettled || town.visiting) return;
  priceSettled = true;
  const market = (town.mode === 'live' ? await session.ethMarket() : null) ?? ethMarketOf(town.raws);
  const move = market === null ? null : priceMove(market.usd, market.pct1d);
  const usd = market?.usd ?? w.ethUsd;
  if (usd !== null) conditions.price(usd, move);
  weather = weatherFor(pinnedMood ?? move?.mood ?? null);
  view?.setWeather(weather);
}

function showTopbar(): void {
  homeBtn.hidden = !shown?.visiting;
  const p = player.profile;
  shell.setTopbar({ guild: shown?.label ?? 'Your guild', rank: p?.rank ?? 'Wanderer', level: `Lv ${p?.level ?? 1}` });
  shell.setRankTitle(p ? `${p.rank}, ${playerTitle(p, prefs.title)}` : '');
}

/** How far back each wallet's history is gathered (the Guild tab shows it; null: the walk back is not running). */
let historyWalk: { statuses: LedgerStatus[]; paused: string | null } | null = null;
let historyDrawn = 0;

const session = new Session(prefs, {
  onHistory: (statuses, paused) => {
    historyWalk = paused === 'stopped' && statuses.length === 0 ? null : { statuses, paused: paused ?? null };
    // the Guild tab's rows in place, at most every 2 s (typing elsewhere on the tab is left alone)
    const now = Date.now();
    if (now - historyDrawn < 2000) return;
    historyDrawn = now;
    const rows = shell.element.querySelector('.guild-tab .history-rows');
    if (rows) rows.replaceWith(historyRows({ history: historyWalk, prefs }));
  },
  onTown: (town) => {
    shown = town;
    // the wallets are in: next the castle's models (or, on a tab with no scene, straight to the welcome)
    const tab = shell.state.tab;
    loading.report(tab === 'castle' ? 'castle' : 'welcome');
    world = worldOf(town);
    mode = town.mode;
    void settlePrice(world, town);
    void readCollateral(world, town);
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
    void readCollateral(next, town);
    if (rebuild) redrawForData();
    else view?.enqueue(fresh);
  },
  onStatus: (text, kind) => {
    shell.setStatus(text, kind);
    if (kind === 'busy') loading.status(text);
    else if (kind === 'error' && !world) loading.fail(text);
  },
  onBudget: (snap) => {
    budget = snap;
  },
});

// the player's own node, if they chose one (the same setting as the town)
if (prefs.rpcUrl !== '' && validRpcUrl(prefs.rpcUrl)) setRpcUrl(prefs.rpcUrl);
startHeartbeat((beat) => {
  conditions.block(beat);
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
  themeLoaded = t;
  if (shell.state.tab === 'castle') shell.refresh();
  // the 2D art (icons, badges) from the theme that has it
  themeNow = artTheme(t);
  shell.setTabIcons((tab) => themeFileUrl(artTheme(t), assetPath({ name: `ui.icon.${tab}`, kind: 'art' })));
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
