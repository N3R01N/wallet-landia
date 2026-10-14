/**
 * The asset gallery (assets.html): every asset the castle asks for, with its
 * spec, and whether the theme has the file yet. Shows the real model when it
 * exists, the standin otherwise. Built for the design handoff: drop a file
 * into public/themes/medieval-castle/ and reload.
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { el } from '../util/dom.js';
import { ASSETS, THEME_DIR, assetPath, tierColor, type AssetSpec } from './assets/manifest.js';
import { buildStandin } from './assets/standin.js';
import { Thumbnailer } from './assets/thumbnail.js';
import { loadCastleTheme, themeFileUrl } from './assets/theme.js';
import { filterAssets, groupsOf, summarize, type GalleryFilter } from './assets/filter.js';

const theme = await loadCastleTheme(import.meta.env.BASE_URL);
const themeUrl = (spec: AssetSpec): string => themeFileUrl(theme, assetPath(spec));

/** A file counts as present when the server answers with something that is not the page (the dev server falls back to index.html). */
async function fileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return false;
    return !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

interface Card {
  spec: AssetSpec;
  node: HTMLButtonElement;
  thumb: HTMLElement;
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app is missing from assets.html');

const ready = new Set<string>();
const thumbnailer = new Thumbnailer();
const loader = new GLTFLoader();
const cards = new Map<string, Card>();
/** The picture each model's card shows, so the detail view can reuse it. */
const thumbs = new Map<string, string>();

const stats = el('p', { class: 'stats' }, `Checking the theme folder (${theme.name} ${theme.version})…`);
const groupSel = el('select', { 'aria-label': 'Group' });
const filterSel = el('select', { 'aria-label': 'Show' });
const grid = el('div', { class: 'grid' });
const dialog = el('dialog', { class: 'detail' });

groupSel.append(el('option', { value: 'all' }, 'All groups'));
for (const g of groupsOf(ASSETS)) groupSel.append(el('option', { value: g }, g));
const FILTERS: [GalleryFilter, string][] = [
  ['all', 'All'],
  ['required', 'Required'],
  ['ready', 'Files ready'],
  ['standin', 'Still standins'],
];
for (const [v, label] of FILTERS) filterSel.append(el('option', { value: v }, label));

groupSel.addEventListener('change', () => refresh());
filterSel.addEventListener('change', () => refresh());

root.replaceChildren(
  el(
    'div',
    { class: 'gallery' },
    el('header', { class: 'gallery-head' }, el('h1', {}, 'Castle assets'), stats),
    el('div', { class: 'controls' }, groupSel, filterSel),
    grid,
    dialog,
  ),
);

function statusPill(isReady: boolean): HTMLElement {
  return el('span', { class: `pill ${isReady ? 'ready' : 'standin'}` }, isReady ? 'model' : 'standin');
}

function buildCard(spec: AssetSpec): Card {
  const thumb = el('div', { class: 'thumb' });
  const node = el(
    'button',
    { class: 'card', type: 'button', 'data-asset': spec.name },
    thumb,
    el('div', { class: 'card-name' }, spec.name),
    el('div', { class: 'card-meta' }, spec.required ? 'required' : 'optional', spec.tier !== undefined ? ` · ${tierName(spec.tier)}` : ''),
  );
  node.addEventListener('click', () => openDetail(spec));
  return { spec, node, thumb };
}

function tierName(tier: number): string {
  return ['t0 Dust', 't1 Common', 't2 Uncommon', 't3 Rare', 't4 Epic', 't5 Legendary', 't6 Mythic'][tier] ?? `t${tier}`;
}

/** Fills a card's picture: the real file when there is one, otherwise the standin. */
async function paint(card: Card): Promise<void> {
  const { spec, thumb } = card;
  const isReady = ready.has(spec.name);
  const pill = statusPill(isReady);
  card.node.querySelector('.pill')?.remove();
  card.node.append(pill);
  if (spec.kind === 'model') {
    const url = isReady ? themeUrl(spec) : null;
    const object = url ? (await loader.loadAsync(url)).scene : buildStandin(spec);
    const picture = thumbnailer.render(object);
    thumbs.set(spec.name, picture);
    thumb.replaceChildren(el('img', { src: picture, alt: spec.name, width: '96', height: '96' }));
  } else if (isReady) {
    thumb.replaceChildren(el('img', { src: themeUrl(spec), alt: spec.name, width: '96', height: '96' }));
  } else {
    thumb.replaceChildren(el('div', { class: 'swatch', style: `background:${spec.standin.color}` }, spec.kind === 'art' ? 'art' : 'fx'));
  }
}

function openDetail(spec: AssetSpec): void {
  const rows: [string, string][] = [
    ['File', `${THEME_DIR}/${assetPath(spec)}`],
    ['Status', ready.has(spec.name) ? 'model file present' : 'standin (no file yet)'],
    ['Required', spec.required ? 'yes' : 'no (the game uses a fallback)'],
    ['Size', spec.kind === 'model' ? `${spec.size[0]} × ${spec.size[1]} × ${spec.size[2]} m (w × d × h)` : `${spec.size[0]} × ${spec.size[1]} px`],
    ['Clips', spec.clips?.join(', ') || '—'],
    ['Attach points', spec.attach?.join(', ') || '—'],
    ['Standin', `${spec.standin.shape}, ${spec.standin.color}`],
    ['Notes', spec.note],
  ];
  if (spec.tier !== undefined) rows.push(['Tier colour', `${tierName(spec.tier)} ${tierColor(spec.tier)}`]);
  const preview = el('div', { class: 'detail-preview' });
  if (spec.kind !== 'model' && ready.has(spec.name)) {
    preview.append(el('img', { src: themeUrl(spec), alt: spec.name }));
  } else if (spec.kind === 'model') {
    const picture = thumbs.get(spec.name) ?? thumbnailer.render(buildStandin(spec));
    preview.append(el('img', { src: picture, alt: spec.name, width: '192', height: '192' }));
  }
  dialog.replaceChildren(
    el('h2', {}, spec.name),
    preview,
    el('table', {}, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v))))),
    el('button', { class: 'btn', type: 'button' }, 'Close'),
  );
  dialog.querySelector('button')?.addEventListener('click', () => dialog.close());
  dialog.showModal();
}

function refresh(): void {
  const shown = filterAssets(ASSETS, {
    group: groupSel.value,
    filter: filterSel.value as GalleryFilter,
    ready,
  });
  const shownNames = new Set(shown.map((a) => a.name));
  for (const card of cards.values()) card.node.hidden = !shownNames.has(card.spec.name);
  const s = summarize(ASSETS, ready);
  stats.textContent = `${s.total} assets · ${s.required} required (${s.requiredReady} with files) · ${s.ready} files in all · showing ${shown.length}`;
}

async function main(): Promise<void> {
  for (const spec of ASSETS) {
    const card = buildCard(spec);
    cards.set(spec.name, card);
    grid.append(card.node);
  }
  const checks = await Promise.all(ASSETS.map(async (spec) => ({ spec, ok: await fileExists(themeUrl(spec)) })));
  for (const { spec, ok } of checks) if (ok) ready.add(spec.name);
  refresh();
  for (const card of cards.values()) {
    await paint(card);
  }
  refresh();
}

void main();
