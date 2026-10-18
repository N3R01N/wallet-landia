/**
 * Ledger Wars (rts.html): the start screen, then the match: the World ticked
 * at a fixed rate, the view drawn every frame, the HUD a few times a second,
 * and the mouse turned into commands (docs/rts/PLAN.md).
 */

import { ModelLibrary } from '../castle/assets/models.js';
import { loadCastleTheme, themeFromUrl } from '../castle/assets/theme.js';
import { el } from '../util/dom.js';
import { RULES, START_KITS, type BuildingKind, type PlayerId, type StartKit } from './data/rules.js';
import { World, type Command } from './core/world.js';
import { RtsView } from './render/view.js';
import { Hud } from './ui/hud.js';
import './rts.css';

const ME: PlayerId = 'A';
const app = document.querySelector<HTMLDivElement>('#app')!;
const theme = loadCastleTheme(import.meta.env.BASE_URL, themeFromUrl(location.search));
const library = new ModelLibrary(theme);

function startScreen(): void {
  const kits = (Object.keys(START_KITS) as StartKit[]).map((k) => {
    const b = el('button', { class: 'btn rts-kit', type: 'button', 'data-kit': k }, START_KITS[k].name);
    b.addEventListener('click', () => void play(k));
    return b;
  });
  app.replaceChildren(
    el(
      'main',
      { class: 'rts-start' },
      el('h1', {}, '⚔ Ledger Wars'),
      el('p', {}, 'You start with your wallet hall and a little money. Build an exchange to trade, stake and pool to earn, train units with the tokens they need, and bring down the enemy’s hall.'),
      el('p', {}, el('strong', {}, 'Start with:')),
      el('div', { class: 'rts-kits' }, ...kits),
      el('p', {}, el('a', { href: './' }, '← Back to the castle')),
    ),
  );
}

async function play(kit: StartKit): Promise<void> {
  const seed = new URLSearchParams(location.search).get('seed') ?? Math.random().toString(36).slice(2, 10);
  const world = new World({ seed, kits: { A: kit, B: kit } });
  const view = new RtsView(library);
  let selected: number | null = null;
  let placing: BuildingKind | null = null;
  const send = (cmd: Command) => world.command(ME, cmd);
  const hud = new Hud({
    world,
    me: ME,
    send,
    onPlace: (kind) => {
      placing = kind;
      view.canvas.focus();
    },
    selected: () => world.buildings.find((b) => b.id === selected) ?? null,
  });
  app.replaceChildren(el('div', { class: 'rts', 'data-ready': 'false' }, view.canvas, hud.element));
  view.focus(RULES.start[ME].x, RULES.start[ME].z - 10);
  await view.build(world);
  app.querySelector('.rts')!.setAttribute('data-ready', 'true');
  view.canvas.focus();

  // the mouse: placing, or selecting
  let last: { x: number; y: number } = { x: 0, y: 0 };
  view.canvas.addEventListener('pointermove', (e) => {
    last = { x: e.clientX, y: e.clientY };
  });
  view.canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2 || (e.button === 0 && placing === null)) {
      if (e.button === 2) {
        placing = null;
        void view.ghost(null);
        return;
      }
      selected = view.buildingAt(e.clientX, e.clientY);
      view.select(world.buildings.find((b) => b.id === selected) ?? null);
      hud.render();
      return;
    }
    if (e.button !== 0 || !placing) return;
    const at = view.groundAt(e.clientX, e.clientY);
    if (!at) return;
    const r = send({ t: 'place', x: at.x, z: at.z });
    if (!r.ok) hud.say(r.reason ?? 'not there');
    else {
      placing = null;
      void view.ghost(null);
    }
  });
  view.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      placing = null;
      void view.ghost(null);
      selected = null;
      view.select(null);
    }
  });

  // time: fixed ticks, the view every frame, the HUD five times a second
  let acc = 0;
  let hudClock = 0;
  view.onFrame((dt) => {
    acc += dt;
    while (acc >= 1 / RULES.tickHz) {
      world.step();
      acc -= 1 / RULES.tickHz;
    }
    const events = world.takeEvents();
    if (events.some((e) => e.t === 'placed' || e.t === 'upgraded')) void view.sync(world);
    for (const e of events) if (e.t === 'built' && e.owner === ME) hud.say(`${e.kind === 'hall' ? 'The hall' : 'A building'} is ready: place it.`);
    if (placing) {
      const at = view.groundAt(last.x, last.y);
      if (at) {
        const s = world.snap(placing, at.x, at.z);
        void view.ghost(placing, s.x, s.z, world.cantPlace(ME, placing, s.x, s.z) === null);
      }
    }
    view.select(world.buildings.find((b) => b.id === selected) ?? null);
    hudClock += dt;
    if (hudClock > 0.2) {
      hudClock = 0;
      hud.render();
    }
  });
  hud.render();
  // test hook (dev server only)
  if (import.meta.env.DEV) Object.assign(window, { rts: { world, view, send } });
}

startScreen();
