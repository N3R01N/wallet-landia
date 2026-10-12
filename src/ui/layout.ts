/**
 * The page around the town: the top bar, the quest log, the value scale, the
 * inspector's frame and the timeline. The parts that change as the town plays
 * are the app's own elements, passed in; this only builds and wires the frame.
 */

import type { HistoryWindow } from '../domain/mappers.js';
import { TIER_COLORS, TIER_FLOORS, TIER_NAMES } from '../domain/tiers.js';
import type { ViewKind } from '../render/view.js';
import { savePrefs, type Prefs } from '../settings.js';
import { el } from './dom.js';

export const SPEEDS = [0.5, 1, 2, 4, 8];

/** The app's own elements, placed in the frame. */
export interface LayoutParts {
  source: HTMLElement;
  status: HTMLElement;
  playerBtn: HTMLElement;
  realmBtn: HTMLElement;
  homeBtn: HTMLElement;
  buildBtn: HTMLElement;
  /** Build mode's drawer, over the town's left side. */
  buildDrawer: HTMLElement;
  soundBtn: HTMLElement;
  inkBtn: HTMLElement;
  tourBtn: HTMLElement;
  stage: HTMLElement;
  inspector: HTMLElement;
  inspectorBody: HTMLElement;
  log: HTMLElement;
  toasts: HTMLElement;
  veil: HTMLElement;
  tooltip: HTMLElement;
  playBtn: HTMLElement;
  scrub: HTMLInputElement;
  dateLabel: HTMLElement;
  modeLabel: HTMLElement;
  beatLabel: HTMLElement;
}

export interface LayoutActions {
  setView(v: ViewKind): void;
  setWindow(w: HistoryWindow): void;
  setQuality(q: Prefs['quality']): void;
  setSpeed(s: number): void;
  openLooks(): void;
  toggleGuild(): void;
  openGuild(): void;
  togglePlayer(): void;
  toggleRealmMap(): void;
  goHome(): void;
  closeInspector(): void;
  togglePlay(): void;
  /** Dragging the timeline (0..100), and letting go. */
  scrub(value: number): void;
  scrubEnd(): void;
}

export interface Layout {
  element: HTMLElement;
  /** The view picker (top-down, isometric, 3D). */
  viewSel: HTMLSelectElement;
  speedBtns: Map<number, HTMLButtonElement>;
  /** What the tour points at. */
  views: HTMLElement;
  guildBtn: HTMLElement;
  legend: HTMLElement;
}

export function buildLayout(prefs: Prefs, parts: LayoutParts, act: LayoutActions): Layout {
  const speedBtns = new Map<number, HTMLButtonElement>();
  // one picker for the three ways of looking at the town (t, i and 3 on the keyboard)
  const viewSel = el('select', { class: 'view-select', 'aria-label': 'View', title: 'How to look at the town (t, i, 3)' });
  for (const [v, label] of [['top', '🗺 Top-down'], ['iso', '◇ Isometric'], ['3d', '⛰ 3D']] as const) {
    const opt = el('option', { value: v }, label);
    if (prefs.view === v) opt.selected = true;
    viewSel.append(opt);
  }
  viewSel.onchange = () => act.setView(viewSel.value as ViewKind);
  const views = viewSel;
  const windowSel = el('select', { 'aria-label': 'History window' });
  for (const [value, label] of [['days:30', 'Last 30 days'], ['days:7', 'Last 7 days'], ['count:100', 'Last 100 transactions'], ['count:25', 'Last 25 transactions']] as const) {
    const opt = el('option', { value }, label);
    const cur = prefs.window.kind === 'days' ? `days:${prefs.window.days}` : `count:${prefs.window.count}`;
    if (cur === value) opt.selected = true;
    windowSel.append(opt);
  }
  windowSel.onchange = () => {
    const [kind, n] = windowSel.value.split(':');
    const num = Number(n);
    act.setWindow(kind === 'days' ? { kind: 'days', days: num } : { kind: 'count', count: num });
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
  foldable(legend, legend.querySelector<HTMLButtonElement>('.fold')!, 'the value scale', () => prefs.legendFolded, (f) => (prefs.legendFolded = f), prefs);

  const qualitySel = el('select', { 'aria-label': '3D quality', title: '3D image quality' });
  for (const [value, label] of [['low', 'Quality: low'], ['medium', 'Quality: medium'], ['high', 'Quality: high']] as const) {
    const opt = el('option', { value }, label);
    if (prefs.quality === value) opt.selected = true;
    qualitySel.append(opt);
  }
  qualitySel.onchange = () => act.setQuality(qualitySel.value as Prefs['quality']);
  const looksBtn = el('button', { class: 'btn' }, '🎨 Looks');
  looksBtn.onclick = () => act.openLooks();
  const guildBtn = el('button', { class: 'btn' }, '⚙ Guild');
  guildBtn.onclick = () => act.toggleGuild();
  parts.inkBtn.onclick = () => act.openGuild();
  parts.playerBtn.onclick = () => act.togglePlayer();
  parts.realmBtn.onclick = () => act.toggleRealmMap();
  parts.homeBtn.onclick = () => act.goHome();
  const header = el(
    'header',
    { class: 'topbar' },
    el('div', { class: 'brand' }, el('strong', {}, 'Wallet-landia'), parts.source),
    views,
    windowSel,
    qualitySel,
    parts.buildBtn,
    parts.realmBtn,
    parts.homeBtn,
    parts.status,
    el('div', { class: 'spacer' }),
    parts.soundBtn,
    parts.inkBtn,
    looksBtn,
    guildBtn,
    parts.tourBtn,
  );

  const close = el('button', { class: 'btn close', 'aria-label': 'Close' }, '✕');
  close.onclick = () => act.closeInspector();
  parts.inspector.append(close, parts.inspectorBody);

  const speeds = el('div', { class: 'seg' });
  for (const s of SPEEDS) {
    const b = el('button', { class: `btn${s === prefs.speed ? ' on' : ''}` }, `${s}×`);
    b.onclick = () => act.setSpeed(s);
    speedBtns.set(s, b);
    speeds.append(b);
  }
  parts.playBtn.onclick = () => act.togglePlay();
  parts.scrub.oninput = () => act.scrub(Number(parts.scrub.value));
  parts.scrub.onchange = () => act.scrubEnd();

  const timeline = el('footer', { class: 'timeline' }, parts.playBtn, speeds, parts.scrub, parts.dateLabel, parts.modeLabel, parts.beatLabel);
  const fold = el('button', { class: 'fold', 'aria-label': 'Collapse the quest log', 'aria-expanded': 'true' }, '▾');
  const questlog = el('section', { class: 'questlog' }, el('h4', {}, el('span', {}, 'Quest log'), fold), parts.log);
  foldable(questlog, fold, 'the quest log', () => prefs.questlogFolded, (f) => (prefs.questlogFolded = f), prefs);

  const element = el('div', { class: 'app' }, header, el('main', { class: 'world' }, parts.stage, parts.playerBtn, questlog, parts.buildDrawer, legend, parts.toasts, parts.veil, parts.inspector, parts.tooltip), timeline);
  return { element, viewSel, speedBtns, views, guildBtn, legend };
}

/** A section that folds to its title when the title is clicked (remembered in the preferences). */
function foldable(section: HTMLElement, fold: HTMLButtonElement, what: string, folded: () => boolean, setFolded: (f: boolean) => void, prefs: Prefs): void {
  const show = (f: boolean): void => {
    section.classList.toggle('collapsed', f);
    fold.textContent = f ? '▸' : '▾';
    fold.setAttribute('aria-expanded', String(!f));
    fold.setAttribute('aria-label', f ? `Expand ${what}` : `Collapse ${what}`);
  };
  show(folded());
  section.querySelector('h4')!.onclick = () => {
    setFolded(!folded());
    savePrefs(prefs);
    show(folded());
  };
}

function short(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : String(n);
}
