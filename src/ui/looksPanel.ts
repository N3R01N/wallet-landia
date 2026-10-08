/**
 * The Looks panel: installed asset packs, importing a pack folder, and the
 * loadout — which pack draws each slot. Anything not chosen uses the built-in
 * "Hearth & Harvest" art.
 */

import { catalog, FAMILY_LABEL, type SlotFamily } from '../assets/catalog.js';
import { importPackFolder, removeImportedPack } from '../assets/packs.js';
import { assets, DEFAULT_PACK } from '../assets/registry.js';
import { el } from './dom.js';

export interface LooksContext {
  /** The loadout changed: persist it. */
  onLoadout(loadout: Record<string, string>): void;
  refresh(): void;
  /** Theme bundles the 3D town can be drawn with. */
  themes: { id: string; name: string; description?: string }[];
  /** The one in use ('' = built in). */
  theme: string;
  onTheme(id: string): void;
}

/** The world theme for the 3D view: one choice for the whole look. */
export function themePicker(ctx: LooksContext): HTMLElement {
  const sel = el('select', { 'aria-label': 'World theme' });
  sel.append(el('option', { value: '' }, 'Built-in (Hearth & Harvest)'));
  for (const t of ctx.themes) sel.append(el('option', { value: t.id }, t.name));
  sel.value = ctx.themes.some((t) => t.id === ctx.theme) ? ctx.theme : '';
  const about = el('div', { class: 'muted small' }, ctx.themes.find((t) => t.id === sel.value)?.description ?? 'Low-poly buildings and pixel-art people.');
  sel.onchange = () => ctx.onTheme(sel.value);
  return el(
    'div',
    { class: 'theme-pick' },
    el('h4', { class: 'slot-family' }, 'World theme (3D view)'),
    sel,
    about,
    el('div', { class: 'muted small' }, 'A theme redraws the 3D town: buildings, land, light and people. Slots below restyle the built-in look.'),
  );
}

export function looksPanel(ctx: LooksContext): HTMLElement {
  const packs = [...assets.packs.values()];

  const packRows = packs.map((p) => {
    const m = p.manifest;
    const slots = Object.keys(m.slots).length;
    const inUse = Object.values(assets.loadout).filter((id) => id === m.id).length;
    const use = el('button', { class: 'btn small' }, 'Use everywhere');
    use.onclick = () => {
      assets.useEverywhere(m.id);
      ctx.onLoadout(assets.loadout);
      ctx.refresh();
    };
    const remove = p.source === 'imported' ? el('button', { class: 'btn small', title: 'Remove this pack' }, '✕') : null;
    if (remove)
      remove.onclick = async () => {
        await removeImportedPack(m.id);
        ctx.onLoadout(assets.loadout);
        ctx.refresh();
      };
    return el(
      'div',
      { class: 'pack-row' },
      el(
        'div',
        {},
        el('strong', {}, m.name),
        el('span', { class: 'muted' }, ` v${m.version} · by ${m.author}${m.license ? ` · ${m.license}` : ''}`),
        m.description ? el('div', { class: 'muted small' }, m.description) : null,
        el('div', { class: 'muted small' }, `${slots} slot${slots === 1 ? '' : 's'} · ${inUse} in use · ${p.source}`),
      ),
      el('div', { class: 'row-actions' }, use, remove),
    );
  });

  // import a folder
  const picker = el('input', { type: 'file', webkitdirectory: '', multiple: '', hidden: '', 'aria-label': 'Pack folder' });
  const importBtn = el('button', { class: 'btn' }, 'Import pack folder…');
  const importMsg = el('div', { class: 'form-msg' });
  importBtn.onclick = () => picker.click();
  picker.onchange = async () => {
    if (!picker.files || picker.files.length === 0) return;
    importMsg.textContent = 'Importing…';
    const r = await importPackFolder(picker.files);
    importMsg.textContent = r.ok ? '' : r.problems.join(' · ');
    if (r.ok) ctx.refresh();
  };

  // the loadout, only for slots some pack can fill (the full catalogue is long)
  const fillable = catalog().filter((s) => assets.providers(s.key).length > 0);
  const byFamily = new Map<SlotFamily, typeof fillable>();
  for (const s of fillable) byFamily.set(s.family, [...(byFamily.get(s.family) ?? []), s]);
  const loadout = [...byFamily.entries()].map(([family, slots]) =>
    el(
      'div',
      {},
      el('h4', { class: 'slot-family' }, FAMILY_LABEL[family]),
      ...slots.map((s) => {
        const sel = el('select', { 'aria-label': s.label });
        sel.append(el('option', { value: DEFAULT_PACK }, 'Built-in'));
        for (const p of assets.providers(s.key)) sel.append(el('option', { value: p.manifest.id }, p.manifest.name));
        sel.value = assets.loadout[s.key] ?? DEFAULT_PACK;
        sel.onchange = () => {
          assets.choose(s.key, sel.value);
          ctx.onLoadout(assets.loadout);
        };
        return el('div', { class: 'stat-row' }, el('span', {}, s.label), sel);
      }),
    ),
  );
  const reset = el('button', { class: 'btn' }, 'Reset everything to built-in');
  reset.onclick = () => {
    assets.setLoadout({});
    ctx.onLoadout({});
    ctx.refresh();
  };

  return el(
    'div',
    { class: 'panel-body' },
    el('h2', {}, '🎨 Looks'),
    el('p', { class: 'muted' }, 'Asset packs restyle the town: heroes, townsfolk, treasure, buildings, scenery, even the names of places. Packs are images, models and text only — never code.'),
    themePicker(ctx),
    el('h3', {}, `Installed packs (${packs.length})`),
    packs.length === 0 ? el('p', { class: 'muted' }, 'No packs yet. The town uses the built-in “Hearth & Harvest” art.') : null,
    ...packRows,
    el('div', { class: 'form-row' }, importBtn, picker),
    importMsg,
    el('p', { class: 'muted small' }, 'Make your own: see docs/PACKS.md for the format and the slot list.'),
    el('h3', {}, 'Loadout'),
    fillable.length === 0 ? el('p', { class: 'muted' }, 'Install a pack to choose looks per slot.') : null,
    ...loadout,
    fillable.length > 0 ? reset : null,
  );
}
