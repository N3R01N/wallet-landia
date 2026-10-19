/**
 * Ledger Wars (rts.html): the start screen (the campaign's missions, or a
 * skirmish), then the match: the World ticked
 * at a fixed rate, the view drawn every frame (units between the ticks), the
 * HUD a few times a second, and the mouse and keys turned into commands
 * (docs/rts/PLAN.md).
 *
 *   left click        select a unit or a building (shift: add units)
 *   left drag         select your units in the box
 *   double-click      all your units of that type in view
 *   right click       move there, or attack what is under the cursor;
 *                     with a building of yours selected: its rally point
 *   A then click      attack-move;  S stop;  H hold;  Esc clear
 *   Ctrl+1–9          make a group; 1–9 selects it, twice jumps to it
 *   minimap           click to look; right-click to send;  F1 help
 *
 * ?mission=N opens a campaign mission's briefing (&go=1: straight in).
 */

import { ModelLibrary } from '../castle/assets/models.js';
import { loadCastleTheme, themeFromUrl } from '../castle/assets/theme.js';
import { el } from '../util/dom.js';
import { RULES, START_KITS, TRAIN, type BuildingKind, type PlayerId, type StartKit } from './data/rules.js';
import { World, type Command } from './core/world.js';
import { newUnit, type OrderKind, type Unit } from './core/units.js';
import type { UnitTypeId } from '../game/core/types.js';
import { RtsView } from './render/view.js';
import { groundHeight } from './core/map.js';
import { RtsSounds, strikeSound } from './sounds.js';
import { ECON_COMMANDS } from './core/economy.js';
import { UnitLayer } from './render/unitLayer.js';
import { FightFx } from './render/fightFx.js';
import { Barks } from './render/barks.js';
import { Hud } from './ui/hud.js';
import { Help } from './ui/help.js';
import { Minimap } from './render/minimap.js';
import type { Difficulty } from './ai/opponent.js';
import { Run } from './campaign/run.js';
import { MISSIONS } from './campaign/missions.js';
import { markWon } from './campaign/progress.js';
import { briefing, debrief, missionList, ObjectivesPanel } from './ui/campaign.js';
import type { Mission } from './campaign/run.js';
import './rts.css';

const ME: PlayerId = 'A';
const app = document.querySelector<HTMLDivElement>('#app')!;
const theme = loadCastleTheme(import.meta.env.BASE_URL, themeFromUrl(location.search));
const library = new ModelLibrary(theme);
/** Made now: the click that starts a match lets the sound start. */
const sounds = new RtsSounds();

function startScreen(): void {
  const level = el(
    'select',
    { class: 'rts-select rts-difficulty', 'aria-label': 'Opponent' },
    ...(['easy', 'normal', 'hard'] as const).map((d) => Object.assign(el('option', { value: d }, d[0]!.toUpperCase() + d.slice(1)), { selected: d === 'normal' })),
  );
  const kits = (Object.keys(START_KITS) as StartKit[]).map((k) => {
    const b = el('button', { class: 'btn rts-kit', type: 'button', 'data-kit': k }, START_KITS[k].name);
    b.addEventListener('click', () => void skirmish(k, level.value as Difficulty));
    return b;
  });
  app.replaceChildren(
    el(
      'main',
      { class: 'rts-start' },
      el('h1', {}, '⚔ Ledger Wars'),
      el('p', {}, 'You start with your wallet hall and a little money. Build an exchange to trade, stake and pool to earn, train units with the tokens they need, and bring down the enemy’s hall.'),
      el('h2', {}, '📜 Campaign'),
      el('p', {}, 'New to Ledger Wars? Ten short missions open the game a piece at a time: each brings a few new buildings and units, and shows you how they work.'),
      missionList(showBriefing),
      el('h2', {}, '⚔ Skirmish'),
      el('p', { class: 'rts-row' }, el('strong', {}, 'The computer plays:'), level),
      el('p', {}, el('strong', {}, 'Start with:')),
      el('div', { class: 'rts-kits' }, ...kits),
      el('p', {}, el('a', { href: './' }, '← Back to the castle')),
    ),
  );
}

function showBriefing(m: Mission): void {
  app.replaceChildren(briefing(m, () => void play(new Run(m)), startScreen));
  window.scrollTo(0, 0);
}

function skirmish(kit: StartKit, difficulty: Difficulty): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ?? Math.random().toString(36).slice(2, 10);
  // ?ai=0: no opponent (a sandbox; the tests use it)
  return play(new World({ seed, kits: { A: kit, B: kit }, ai: params.get('ai') === '0' ? [] : ['B'], difficulty }));
}

/** A match: a skirmish's World, or a campaign mission's Run (its World and objectives). */
async function play(match: World | Run): Promise<void> {
  const run = match instanceof Run ? match : null;
  const world = run ? run.world : (match as World);
  const view = new RtsView(library);
  const layer = new UnitLayer(view, (x, z) => groundHeight(world.map, x, z));
  const fx = new FightFx(view, world);
  const barks = new Barks(world, view, ME);
  layer.preload(TRAIN.filter((t) => t.level === 1 && t.at === 'hall').map((t) => t.unit));
  const selection = new Set<number>();
  let building: number | null = null;
  let placing: BuildingKind | null = null;
  let armed = false;
  const send = (cmd: Command) => {
    const r = world.command(ME, cmd);
    // what the player did, heard: a refusal, coins for the money, a tick for an order
    if (!r.ok) sounds.play('refused');
    else if (ECON_COMMANDS.has(cmd.t)) sounds.play('coins');
    else if (cmd.t === 'order' || cmd.t === 'train' || cmd.t === 'build' || cmd.t === 'rally' || cmd.t === 'upgrade') sounds.play('order');
    return r;
  };
  const selectedUnits = () => world.units.filter((u) => selection.has(u.id) && u.died < 0);
  const order = (kind: OrderKind | 'armAttack') => {
    const units = selectedUnits();
    if (units.length === 0) return;
    if (kind === 'armAttack') {
      armed = true;
      view.canvas.style.cursor = 'crosshair';
      return;
    }
    send({ t: 'order', units: units.map((u) => u.id), kind });
  };
  const hud = new Hud({
    world,
    me: ME,
    send,
    onPlace: (kind) => {
      placing = kind;
      view.canvas.focus();
    },
    selection: () => ({ units: selectedUnits(), building: world.buildings.find((b) => b.id === building) ?? null }),
    order,
  });
  const box = el('div', { class: 'rts-box' });
  box.hidden = true;
  const help = new Help(world, ME);
  const helpBtn = el('button', { class: 'btn rts-help-btn', type: 'button', 'aria-label': 'Help', title: 'Help (F1)' }, '? Help');
  helpBtn.addEventListener('click', () => help.show());
  const soundBtn = el('button', { class: 'btn rts-sound-btn', type: 'button', 'aria-label': 'Sound' });
  const showSound = () => {
    soundBtn.textContent = sounds.on ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', String(sounds.on));
    soundBtn.title = sounds.on ? 'Sound on' : 'Sound off';
  };
  soundBtn.addEventListener('click', () => {
    sounds.setOn(!sounds.on);
    showSound();
    view.canvas.focus();
  });
  showSound();
  const minimap = new Minimap(world, {
    onLook: (x, z) => view.lookAt(x, z),
    onSend: (x, z) => {
      const units = selectedUnits();
      if (units.length > 0) send({ t: 'order', units: units.map((u) => u.id), kind: 'move', x, z });
    },
  });
  const missionUrl = (n: number) => `rts.html?mission=${n}&go=1`;
  const panel = run ? new ObjectivesPanel(run, () => location.assign(missionUrl(run.mission.n))) : null;
  if (panel) hud.element.append(panel.element);
  app.replaceChildren(el('div', { class: 'rts', 'data-ready': 'false' }, view.canvas, box, barks.element, view.edges, hud.element, minimap.element, helpBtn, soundBtn));
  view.focus(RULES.start[ME].x, RULES.start[ME].z - 10);
  await view.build(world);
  app.querySelector('.rts')!.setAttribute('data-ready', 'true');
  view.canvas.focus();

  const clearSelection = () => {
    selection.clear();
    building = null;
  };
  /** The unit nearest a point of the page, within reach of the pointer (yours first if both). */
  const unitAt = (x: number, y: number): Unit | null => {
    let best: Unit | null = null;
    let bestD = 22;
    for (const u of world.units) {
      if (u.died >= 0) continue;
      const p = view.toScreen(u.x, 1, u.z);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y) - (u.owner === ME ? 4 : 0);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  };
  const enemyBuildingAt = (x: number, y: number) => {
    const id = view.buildingAt(x, y);
    const b = world.buildings.find((x2) => x2.id === id);
    return b && b.owner !== ME ? b : null;
  };

  // the mouse
  let last = { x: 0, y: 0 };
  let drag: { x: number; y: number } | null = null;
  let lastClick = { t: 0, unit: -1 };
  view.canvas.addEventListener('pointermove', (e) => {
    last = { x: e.clientX, y: e.clientY };
    if (!drag) return;
    const r = app.getBoundingClientRect();
    const x0 = Math.min(drag.x, e.clientX);
    const y0 = Math.min(drag.y, e.clientY);
    const w = Math.abs(e.clientX - drag.x);
    const h = Math.abs(e.clientY - drag.y);
    box.hidden = w < 6 && h < 6;
    Object.assign(box.style, { left: `${x0 - r.left}px`, top: `${y0 - r.top}px`, width: `${w}px`, height: `${h}px` });
  });
  view.canvas.addEventListener('pointerdown', (e) => {
    view.canvas.focus();
    if (e.button === 2) {
      if (placing || armed) {
        placing = null;
        armed = false;
        view.canvas.style.cursor = '';
        void view.ghost(null);
        return;
      }
      const units = selectedUnits();
      if (units.length > 0) {
        const foe = unitAt(e.clientX, e.clientY);
        const target = foe && foe.owner !== ME ? foe.id : (enemyBuildingAt(e.clientX, e.clientY)?.id ?? null);
        if (target !== null) send({ t: 'order', units: units.map((u) => u.id), kind: 'attack', target });
        else {
          const at = view.groundAt(e.clientX, e.clientY);
          if (at) {
            send({ t: 'order', units: units.map((u) => u.id), kind: 'move', x: at.x, z: at.z });
            view.marker(at.x, at.z, 0x7cf07c);
          }
        }
        return;
      }
      const b = world.buildings.find((x) => x.id === building);
      const at = view.groundAt(e.clientX, e.clientY);
      if (b && b.owner === ME && at && TRAIN.some((t) => t.at === b.kind)) {
        send({ t: 'rally', id: b.id, x: at.x, z: at.z });
        view.marker(at.x, at.z, 0xffe08a);
      }
      return;
    }
    if (e.button !== 0) return;
    if (armed) {
      armed = false;
      view.canvas.style.cursor = '';
      const units = selectedUnits();
      const at = view.groundAt(e.clientX, e.clientY);
      if (units.length > 0 && at) {
        send({ t: 'order', units: units.map((u) => u.id), kind: 'attackMove', x: at.x, z: at.z });
        view.marker(at.x, at.z, 0xff6b5a);
      }
      return;
    }
    if (placing) {
      const at = view.groundAt(e.clientX, e.clientY);
      if (!at) return;
      const r = send({ t: 'place', x: at.x, z: at.z });
      if (!r.ok) hud.say(r.reason ?? 'not there');
      else {
        placing = null;
        void view.ghost(null);
      }
      return;
    }
    drag = { x: e.clientX, y: e.clientY };
    view.canvas.setPointerCapture(e.pointerId);
  });
  view.canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag) return;
    const start = drag;
    drag = null;
    box.hidden = true;
    const boxed = Math.abs(e.clientX - start.x) > 6 || Math.abs(e.clientY - start.y) > 6;
    if (!e.shiftKey) clearSelection();
    if (boxed) {
      const x0 = Math.min(start.x, e.clientX);
      const x1 = Math.max(start.x, e.clientX);
      const y0 = Math.min(start.y, e.clientY);
      const y1 = Math.max(start.y, e.clientY);
      for (const u of world.units) {
        if (u.owner !== ME || u.died >= 0) continue;
        const p = view.toScreen(u.x, 0.8, u.z);
        if (p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) selection.add(u.id);
      }
      building = null;
    } else {
      const u = unitAt(e.clientX, e.clientY);
      if (u && u.owner === ME) {
        const now = performance.now();
        if (now - lastClick.t < 350 && lastClick.unit === u.id) {
          // all of that type in view
          for (const v of world.units) {
            if (v.owner !== ME || v.type !== u.type || v.died >= 0) continue;
            const p = view.toScreen(v.x, 0.8, v.z);
            const r = view.canvas.getBoundingClientRect();
            if (p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) selection.add(v.id);
          }
        } else selection.add(u.id);
        lastClick = { t: now, unit: u.id };
        building = null;
      } else if (selection.size === 0) building = view.buildingAt(e.clientX, e.clientY);
    }
    hud.render();
  });
  view.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  view.canvas.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      placing = null;
      armed = false;
      view.canvas.style.cursor = '';
      void view.ghost(null);
      clearSelection();
    } else if (k === 'a') order('armAttack');
    else if (k === 's') order('stop');
    else if (k === 'h') order('hold');
    else if (k === 'f1') {
      e.preventDefault();
      help.show();
    } else if (/^[1-9]$/.test(k)) {
      // control groups
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        groups.set(k, [...selection]);
        hud.say(`Group ${k}: ${selection.size} unit${selection.size === 1 ? '' : 's'}`);
        return;
      }
      const ids = (groups.get(k) ?? []).filter((id) => world.units.some((u) => u.id === id && u.died < 0));
      if (ids.length === 0) return;
      const now = performance.now();
      if (lastGroup.key === k && now - lastGroup.t < 400) {
        const us = world.units.filter((u) => ids.includes(u.id));
        view.lookAt(us.reduce((t, u) => t + u.x, 0) / us.length, us.reduce((t, u) => t + u.z, 0) / us.length);
      }
      lastGroup = { key: k, t: now };
      selection.clear();
      for (const id of ids) selection.add(id);
      building = null;
      hud.render();
    }
  });
  const groups = new Map<string, number[]>();
  let lastGroup = { key: '', t: 0 };
  let warned = -99;
  let beaconClock = 0;
  let ambienceClock = 0;
  /** What the world did, heard (fights out of view quieter). */
  const hear = (e: ReturnType<typeof world.takeEvents>[number]) => {
    // where on the screen: in view or not (quieter), and left or right
    const at = (x: number, z: number) => {
      const p = view.toScreen(x, 0, z);
      const r = view.canvas.getBoundingClientRect();
      return { loud: view.inView(x, z) ? 1 : 0.2, pan: p ? ((p.x - r.left) / r.width) * 2 - 1 : 0 };
    };
    const mine = (id: number) => world.units.find((u) => u.id === id)?.owner === ME || world.buildings.find((b) => b.id === id)?.owner === ME;
    switch (e.t) {
      case 'strike': {
        const from = world.units.find((u) => u.id === e.from);
        const onBuilding = world.buildings.some((b) => b.id === e.target);
        sounds.play(strikeSound(from?.type ?? null, e.ranged, onBuilding), { ...at(e.toX, e.toZ), crit: e.crit });
        break;
      }
      case 'hallShot': {
        const hall = world.buildings.find((b) => b.id === e.from);
        if (hall) sounds.play('hallShot', at(hall.x, hall.z));
        break;
      }
      case 'death': {
        const u = world.units.find((x) => x.id === e.id);
        if (u) sounds.play('fall', { ...at(u.x, u.z), unit: u.type });
        break;
      }
      case 'ability': {
        const u = world.units.find((x) => x.id === e.id);
        if (u) sounds.play(e.ability === 'charge' ? 'charge' : e.ability === 'death-burst' ? 'burst' : 'magic', at(u.x, u.z));
        break;
      }
      case 'destroyed':
        sounds.play('collapse', { loud: e.owner === ME ? 1 : 0.8 });
        break;
      case 'trained':
        if (mine(e.id)) sounds.play('trained');
        break;
      case 'placed':
        if (mine(e.id) && world.time > 0) sounds.play('placed');
        break;
      case 'built':
        if (e.owner === ME) sounds.play('ready');
        break;
      case 'upgraded':
        if (mine(e.id)) sounds.play('upgraded');
        break;
      case 'won':
        sounds.play(e.winner === ME ? 'victory' : 'defeat');
        break;
    }
  };
  /** What the campaign's objectives read from the page. */
  const ui = () => {
    const b = world.buildings.find((x) => x.id === building);
    return { selectedUnits: selectedUnits().length, building: selection.size === 0 && b?.owner === ME ? b.kind : null, camera: view.cameraState, groups: [...groups.values()].filter((g) => g.length > 0).length };
  };

  // time: fixed ticks, the view every frame, the HUD five times a second
  let acc = 0;
  let hudClock = 0;
  const tick = 1 / RULES.tickHz;
  view.onFrame((dt) => {
    acc += dt;
    while (acc >= tick) {
      world.step();
      acc -= tick;
    }
    if (run) {
      run.tick(ui());
      for (const text of run.takeSaid()) {
        hud.say(text);
        sounds.play('objective');
      }
      // the objective's place on the map, a ring every so often
      beaconClock -= dt;
      const at = run.state === 'playing' && run.started ? run.step?.beacon?.(run) : null;
      if (at && beaconClock <= 0) {
        beaconClock = 0.8;
        view.marker(at.x, at.z, 0xffd34d, 3.5);
      }
    }
    const events = world.takeEvents();
    if (events.some((e) => e.t === 'placed' || e.t === 'upgraded' || e.t === 'destroyed')) void view.sync(world);
    fx.handle(events);
    barks.handle(events);
    for (const e of events) {
      hear(e);
      // under attack: a flash on the minimap, and a word now and then
      if (e.t === 'strike') {
        const hit = world.units.find((u) => u.id === e.target) ?? world.buildings.find((b) => b.id === e.target);
        if (hit && hit.owner === ME) {
          minimap.ping(e.toX, e.toZ);
          if (world.time - warned > 12 && !view.inView(e.toX, e.toZ)) {
            warned = world.time;
            hud.say('⚔ You are under attack!');
            sounds.play('alarm');
          }
        }
      }
      if (e.t === 'destroyed' && e.owner === ME) hud.say(`Your ${e.kind === 'hall' ? 'wallet hall' : 'building'} was destroyed!`);
      if (e.t === 'won') gameOver(e.winner === ME);
      if (e.t === 'built' && e.owner === ME) hud.say('A building is ready: place it.');
      if (e.t === 'liquidated' && e.owner === ME) {
        hud.say('⚠ A loan was liquidated!');
        sounds.play('alarm');
      }
    }
    if (placing) {
      const at = view.groundAt(last.x, last.y);
      if (at) {
        const s = world.snap(placing, at.x, at.z);
        void view.ghost(placing, s.x, s.z, world.cantPlace(ME, placing, s.x, s.z) === null);
      }
    }
    for (const id of selection) if (!world.units.some((u) => u.id === id && u.died < 0)) selection.delete(id);
    const b = world.buildings.find((x) => x.id === building) ?? null;
    view.select(selection.size === 0 ? b : null);
    view.rally(selection.size === 0 && b?.owner === ME ? b.rally : null);
    layer.draw(world.units, acc / tick, dt, selection, ME, world.buildings);
    minimap.draw(ME, view.outline(), dt);
    barks.update(dt);
    ambienceClock -= dt;
    if (ambienceClock <= 0) {
      ambienceClock = 1;
      sounds.ambience();
    }
    hudClock += dt;
    if (hudClock > 0.2) {
      hudClock = 0;
      hud.render();
      panel?.render();
    }
  });
  hud.render();
  panel?.render();

  function gameOver(won: boolean): void {
    if (run) {
      const m = run.mission;
      if (won) markWon(m.n);
      const next = MISSIONS.find((x) => x.n === m.n + 1);
      app.querySelector('.rts')!.append(
        debrief(m, won, Math.floor(world.time / 60), {
          next: next ? () => location.assign(`rts.html?mission=${next.n}`) : null,
          retry: () => location.assign(missionUrl(m.n)),
        }),
      );
      return;
    }
    const again = el('button', { class: 'btn', type: 'button' }, 'Play again');
    again.addEventListener('click', () => location.reload());
    const minutes = Math.floor(world.time / 60);
    app.querySelector('.rts')!.append(
      el(
        'div',
        { class: `rts-over ${won ? 'won' : 'lost'}`, role: 'dialog', 'aria-label': won ? 'Victory' : 'Defeat' },
        el('h2', {}, won ? '🏆 Victory' : '💀 Defeat'),
        el('p', {}, won ? `The enemy’s wallet hall has fallen, after ${minutes} min.` : `Your wallet hall has fallen, after ${minutes} min.`),
        el('div', { class: 'rts-row' }, again, el('a', { class: 'btn', href: './' }, 'Back to the castle')),
      ),
    );
  }
  // test hook (dev server only)
  let spawned = 1_000_000;
  if (import.meta.env.DEV)
    Object.assign(window, {
      rts: { world, run, view, send, selection, sounds, barks, spawn: (owner: PlayerId, type: UnitTypeId, x: number, z: number) => world.units.push(newUnit(spawned++, type, owner, x, z)) },
    });
}

const asked = MISSIONS.find((m) => String(m.n) === new URLSearchParams(location.search).get('mission'));
if (!asked) startScreen();
else if (new URLSearchParams(location.search).get('go')) void play(new Run(asked));
else showBriefing(asked);
