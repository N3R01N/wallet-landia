/**
 * The siege gallery (siege-gallery.html): every model made for Siege of the
 * Ledger, one at a time on a turntable, with every clip it has. Units show in
 * either team's colour, castle pieces in each damage state, the capture ring
 * at any fill; "as in battle" draws units the way the game does (instanced,
 * animated from the baked bone texture), to check the bake against the clip.
 *
 *   /siege-gallery.html            (the default theme)
 *   /siege-gallery.html#unit.titan.bitcoin   (opens on that asset)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { el } from '../../util/dom.js';
import { findAsset, UNIT_MODELS } from '../../castle/assets/manifest.js';
import { ModelLibrary, type Loaded } from '../../castle/assets/models.js';
import { loadCastleTheme, themeFromUrl } from '../../castle/assets/theme.js';
import { showDamageParts } from '../../castle/scene/castleView.js';
import { UNIT_TYPES } from '../core/catalog.js';
import { TEAM_COLORS } from '../render/battleView.js';
import { UnitMesh } from '../render/unitMeshes.js';
import { FpsMeter } from '../render/fpsMeter.js';
import './siegeGallery.css';

interface Entry {
  name: string;
  label: string;
  kind: 'unit' | 'fx' | 'castle' | 'marker' | 'stress';
}

const ENTRIES: Entry[] = [
  { name: 'stress', label: '600 units at once (stress test)', kind: 'stress' },
  ...UNIT_MODELS.map((id): Entry => ({ name: `unit.${id}`, label: UNIT_TYPES[id]?.name ?? id, kind: 'unit' })),
  ...[
    ['fx.hit.spark', 'Hit spark'],
    ['fx.arrow', 'Arrow'],
    ['fx.bolt', 'Spell bolt'],
    ['fx.puff', 'Puff'],
    ['fx.detonation', 'Detonation'],
    ['fx.siege.impact', 'Siege impact'],
    ['fx.lightning', 'Lightning'],
  ].map(([name, label]): Entry => ({ name: name!, label: label!, kind: 'fx' })),
  ...[
    ['castle.keep', 'Keep'],
    ['castle.wall.segment', 'Wall segment'],
    ['castle.wall.corner', 'Wall corner'],
    ['castle.gatehouse', 'Gatehouse'],
  ].map(([name, label]): Entry => ({ name: name!, label: label!, kind: 'castle' })),
  { name: 'fx.capture.ring', label: 'Capture ring', kind: 'marker' },
  { name: 'prop.banner.owner', label: 'Owner banner', kind: 'marker' },
];
const GROUP: Record<Entry['kind'], string> = { stress: 'Performance', unit: 'Units', fx: 'Effects', castle: 'Castle damage states', marker: 'Battlefield markers' };
const DAMAGE = ['Whole', 'Cracked (≤ 75%)', 'Breached (≤ 50%)', 'Burning (≤ 25%)', 'Collapsed (0)'];

const theme = await loadCastleTheme(import.meta.env.BASE_URL, themeFromUrl(location.search));
const library = new ModelLibrary(theme);

// ---------- page ----------
const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = el('canvas', { class: 'sg-canvas' });
const list = el('nav', { class: 'sg-list', 'aria-label': 'Assets' });
const picker = el('select', { class: 'sg-picker', 'aria-label': 'Asset' });
const info = el('div', { class: 'sg-info' });
const controls = el('div', { class: 'sg-controls' });
app.append(el('div', { class: 'sg' }, el('aside', { class: 'sg-side' }, el('h1', {}, '⚔ Siege assets'), picker, list), el('main', { class: 'sg-stage' }, canvas, el('div', { class: 'sg-panel' }, info, controls))));

for (const kind of Object.keys(GROUP) as Entry['kind'][]) {
  const items = ENTRIES.filter((e) => e.kind === kind);
  list.append(el('h2', {}, GROUP[kind]), ...items.map((e) => {
    const b = el('button', { class: 'sg-item', type: 'button', 'data-name': e.name }, e.label);
    b.addEventListener('click', () => void show(e));
    return b;
  }));
  picker.append(el('optgroup', { label: GROUP[kind] }, ...items.map((e) => el('option', { value: e.name }, e.label))));
}
picker.addEventListener('change', () => void show(ENTRIES.find((e) => e.name === picker.value)!));

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cbfd4);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x8a6e4b, 1));
const sun = new THREE.DirectionalLight(0xffe2b8, 3);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7fae4a, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
const timer = new THREE.Timer();

interface Current {
  entry: Entry;
  loaded: Loaded;
  root: THREE.Group;
  /** The model shown one by one, or the instanced crowd. */
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  crowd: UnitMesh | null;
  tints: THREE.MeshStandardMaterial[];
  clip: string | null;
  loop: boolean;
  speed: number;
  paused: boolean;
  team: 'A' | 'B' | 'none';
  damage: number;
  fill: number;
  instanced: boolean;
  time: number;
}
let cur: Current | null = null;

async function show(entry: Entry): Promise<void> {
  if (location.hash.slice(1) !== entry.name) history.replaceState(null, '', `#${entry.name}`);
  if (entry.kind === 'stress') return stress(entry);
  for (const b of list.querySelectorAll<HTMLButtonElement>('.sg-item')) b.setAttribute('aria-current', String(b.dataset.name === entry.name));
  picker.value = entry.name;
  info.replaceChildren(el('p', {}, `Loading ${entry.label}…`));
  const loaded = await library.load(entry.name);
  clear();
  if (!loaded) {
    info.replaceChildren(el('h2', {}, entry.label), el('p', {}, 'No model in the theme yet.'));
    controls.replaceChildren();
    return;
  }
  const root = new THREE.Group();
  scene.add(root);
  cur = {
    entry,
    loaded,
    root,
    model: null,
    mixer: null,
    action: null,
    crowd: null,
    tints: [],
    clip: null,
    loop: true,
    speed: 1,
    paused: false,
    team: entry.kind === 'unit' ? 'A' : 'none',
    damage: 0,
    fill: 1,
    instanced: false,
    time: 0,
  };
  build();
  frame(root);
  const first = loaded.clips.find((c) => c.name === 'idle') ?? loaded.clips[0];
  // everything loops in the gallery (a one-shot effect ends invisible: it would show once, then nothing)
  if (first) play(first.name, true);
  renderPanel();
}

function clear(): void {
  if (crowd) {
    for (const m of crowd.meshes) m.mesh.dispose();
    crowd = null;
    stressRoot?.removeFromParent();
    stressRoot = null;
  }
  if (!cur) return;
  cur.mixer?.stopAllAction();
  cur.crowd?.dispose();
  for (const m of cur.tints) m.dispose();
  cur.root.removeFromParent();
  cur = null;
}

/** The model (or the instanced crowd) for the current settings. */
function build(): void {
  const c = cur!;
  c.mixer?.stopAllAction();
  c.crowd?.dispose();
  c.crowd = null;
  c.root.clear();
  for (const m of c.tints) m.dispose();
  c.tints = [];
  if (c.instanced && c.entry.kind === 'unit') {
    c.crowd = new UnitMesh(c.loaded, 16);
    c.root.add(c.crowd.mesh);
    c.model = null;
    c.mixer = null;
    c.action = null;
    return;
  }
  const spec = findAsset(c.entry.name);
  const model = spec ? library.instance(spec, c.loaded) : c.loaded.scene.clone(true);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // its own Tint, so the team colour can be set here only
    const swap = (m: THREE.Material) => {
      if (m.name !== 'Tint' || !(m instanceof THREE.MeshStandardMaterial)) return m;
      const t = m.clone();
      c.tints.push(t);
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  c.root.add(model);
  c.model = model;
  c.mixer = new THREE.AnimationMixer(model);
  applyLook();
  if (c.clip) play(c.clip, c.loop);
}

/** Team colour, damage state, ring fill. */
function applyLook(): void {
  const c = cur!;
  const color = c.team === 'none' ? (c.entry.kind === 'unit' ? '#d9d2c2' : '#3fa34d') : TEAM_COLORS[c.team];
  for (const m of c.tints) m.color.set(color);
  if (c.model && c.entry.kind === 'castle') showDamageParts(c.model, c.damage);
  if (c.model && c.entry.name === 'fx.capture.ring') {
    const segs: THREE.Object3D[] = [];
    c.model.traverse((o) => {
      if (/^seg\.?\d\d$/.test((o.userData.name as string | undefined) ?? o.name)) segs.push(o);
    });
    segs.sort((a, b) => a.name.localeCompare(b.name));
    segs.forEach((s, i) => (s.visible = i < Math.round(c.fill * segs.length)));
  }
}

function play(name: string, loop: boolean): void {
  const c = cur!;
  c.clip = name;
  c.loop = loop;
  c.time = 0;
  c.paused = false;
  if (!c.mixer || !c.model) return;
  const clip = c.loaded.clips.find((x) => x.name === name);
  if (!clip) return;
  c.mixer.stopAllAction();
  const action = c.mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = true;
  action.play();
  c.action = action;
}

/** The camera round the model, at a distance that fits it. */
function frame(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const r = Math.max(1.2, size.length() * 0.75);
  orbit.target.copy(centre);
  camera.position.set(centre.x + r * 1.3, centre.y + r * 0.9, centre.z + r * 1.6);
  orbit.update();
}

function renderPanel(): void {
  const c = cur!;
  const e = c.entry;
  let tris = 0;
  let bones = 0;
  c.loaded.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const g = mesh.geometry;
      tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    }
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) bones = Math.max(bones, (o as THREE.SkinnedMesh).skeleton.bones.length);
  });
  const u = e.kind === 'unit' ? UNIT_TYPES[e.name.slice(5)] : undefined;
  const head: (HTMLElement | null)[] = [
    el('h2', {}, e.label),
    el('p', { class: 'sg-meta' }, `${e.name} · ${Math.round(tris).toLocaleString('en-US')} tris${bones ? ` · ${bones} bones` : ''} · ${c.loaded.clips.length} clip${c.loaded.clips.length === 1 ? '' : 's'}`),
    u ? el('p', { class: 'sg-meta' }, `${u.role} · HP ${u.hp} · ATK ${u.atk} · range ${u.range} · speed ${u.speed} · siege ${u.siege}${u.ability ? ` · ${u.ability}` : ''}`) : null,
  ];
  info.replaceChildren(...head.filter((x): x is HTMLElement => x !== null));

  const rows: HTMLElement[] = [];
  if (c.loaded.clips.length > 0) {
    rows.push(
      el(
        'div',
        { class: 'sg-row' },
        ...c.loaded.clips.map((clip) => {
          const b = el('button', { class: 'btn sg-clip', type: 'button', 'aria-pressed': String(c.clip === clip.name) }, `${clip.name} · ${clip.duration.toFixed(2)} s`);
          b.addEventListener('click', () => {
            const once = ['hit', 'death', 'pop', 'tap'].includes(clip.name);
            play(clip.name, !once);
            renderPanel();
          });
          return b;
        }),
      ),
    );
    const loop = el('button', { class: 'btn', type: 'button', 'aria-pressed': String(c.loop) }, c.loop ? '🔁 Looping' : '1× Once');
    loop.addEventListener('click', () => {
      if (c.clip) play(c.clip, !c.loop);
      renderPanel();
    });
    const replay = el('button', { class: 'btn', type: 'button' }, '↺ Again');
    replay.addEventListener('click', () => c.clip && play(c.clip, c.loop));
    const pause = el('button', { class: 'btn', type: 'button' }, c.paused ? '▶ Play' : '⏸ Pause');
    pause.addEventListener('click', () => {
      c.paused = !c.paused;
      renderPanel();
    });
    const speed = el('select', { 'aria-label': 'Speed' }, ...[0.1, 0.25, 0.5, 1, 2].map((v) => {
      const o = el('option', { value: String(v) }, `${v}×`);
      o.selected = v === c.speed;
      return o;
    }));
    speed.addEventListener('change', () => (c.speed = Number(speed.value)));
    rows.push(el('div', { class: 'sg-row' }, loop, replay, pause, speed));
  }
  if (e.kind === 'unit' || e.kind === 'marker' || e.kind === 'castle') {
    const teams = (['A', 'B', 'none'] as const).map((t) => {
      const b = el('button', { class: `btn sg-team sg-team-${t}`, type: 'button', 'aria-pressed': String(c.team === t) }, t === 'A' ? 'Blue (you)' : t === 'B' ? 'Red (enemy)' : 'Neutral');
      b.addEventListener('click', () => {
        c.team = t;
        applyLook();
        renderPanel();
      });
      return b;
    });
    rows.push(el('div', { class: 'sg-row' }, el('span', {}, 'Tint: '), ...teams));
  }
  if (e.kind === 'unit') {
    const inst = el('button', { class: 'btn', type: 'button', 'aria-pressed': String(c.instanced) }, c.instanced ? '👥 As in battle (instanced, 12)' : '👤 Single model');
    inst.addEventListener('click', () => {
      c.instanced = !c.instanced;
      build();
      renderPanel();
    });
    rows.push(el('div', { class: 'sg-row' }, inst, el('small', {}, c.instanced ? 'Drawn as the game draws units: one instanced mesh, the clip from the baked bone texture.' : 'The rigged glTF with its own animation player.')));
  }
  if (e.kind === 'castle') {
    const slider = el('input', { type: 'range', min: '0', max: '4', step: '1', value: String(c.damage), 'aria-label': 'Damage state' });
    const label = el('span', { class: 'sg-state' }, DAMAGE[c.damage]!);
    slider.addEventListener('input', () => {
      c.damage = Number(slider.value);
      label.textContent = DAMAGE[c.damage]!;
      applyLook();
    });
    rows.push(el('div', { class: 'sg-row' }, el('span', {}, 'Damage: '), slider, label));
  }
  if (e.name === 'fx.capture.ring') {
    const slider = el('input', { type: 'range', min: '0', max: '1', step: '0.0417', value: String(c.fill), 'aria-label': 'Capture progress' });
    slider.addEventListener('input', () => {
      c.fill = Number(slider.value);
      applyLook();
    });
    rows.push(el('div', { class: 'sg-row' }, el('span', {}, 'Capture: '), slider));
  }
  controls.replaceChildren(...rows);
}

// ---------- the stress test ----------

/** 600 units, every type, as a battle draws them (instanced, baked clips), with the frame rate. */
const meter = new FpsMeter();
let crowd: { meshes: { mesh: UnitMesh; count: number; clip: string }[]; time: number } | null = null;

async function stress(entry: Entry): Promise<void> {
  for (const b of list.querySelectorAll<HTMLButtonElement>('.sg-item')) b.setAttribute('aria-current', String(b.dataset.name === entry.name));
  picker.value = entry.name;
  clear();
  info.replaceChildren(el('h2', {}, entry.label), el('p', {}, 'Loading every unit…'));
  controls.replaceChildren();
  const root = new THREE.Group();
  scene.add(root);
  const total = 600;
  const per = Math.ceil(total / UNIT_MODELS.length);
  const meshes: { mesh: UnitMesh; count: number; clip: string }[] = [];
  const clips = ['walk', 'attack', 'idle', 'cheer'];
  for (const [k, id] of UNIT_MODELS.entries()) {
    const loaded = await library.load(`unit.${id}`);
    if (!loaded) continue;
    const mesh = new UnitMesh(loaded, per);
    root.add(mesh.mesh);
    meshes.push({ mesh, count: Math.min(per, total - k * per), clip: clips[k % clips.length]! });
  }
  crowd = { meshes, time: 0 };
  // a block of 30 × 20, two armies facing each other
  const cols = 30;
  let i = 0;
  for (const m of meshes) {
    for (let j = 0; j < m.count; j++, i++) {
      const x = (i % cols) * 1.2 - cols * 0.6;
      const z = Math.floor(i / cols) * 1.4 - 14;
      m.mesh.set(j, x, z, z < 0 ? 0 : Math.PI, m.clip, j * 0.1, true, z < 0 ? team.A : team.B);
    }
    m.mesh.commit(m.count);
  }
  orbit.target.set(0, 0, 0);
  camera.position.set(22, 26, 34);
  cur = null;
  info.replaceChildren(el('h2', {}, entry.label), el('p', { class: 'sg-meta' }, `${i} units of ${meshes.length} types, ${meshes.length * 2} instanced draws (each type's body and team cloth). Orbit and zoom while it runs; the meter reads the frames per second.`), meter.element);
  stressRoot = root;
}
let stressRoot: THREE.Group | null = null;

// ---------- loop ----------
const team = { A: new THREE.Color(TEAM_COLORS.A), B: new THREE.Color(TEAM_COLORS.B), none: new THREE.Color('#d9d2c2') };
renderer.setAnimationLoop((now: number) => {
  timer.update(now);
  const dt = Math.min(0.1, timer.getDelta());
  if (crowd) {
    crowd.time += dt;
    let i = 0;
    for (const m of crowd.meshes) {
      for (let j = 0; j < m.count; j++, i++) {
        const x = (i % 30) * 1.2 - 18;
        const z = Math.floor(i / 30) * 1.4 - 14;
        m.mesh.set(j, x, z, z < 0 ? 0 : Math.PI, m.clip, crowd.time + j * 0.1, true, z < 0 ? team.A : team.B);
      }
      m.mesh.commit(m.count);
    }
    meter.tick(dt, `${i} units`);
  }
  const c = cur;
  if (c && !c.paused) {
    c.time += dt * c.speed;
    c.mixer?.update(dt * c.speed);
    if (c.crowd && c.clip) {
      // twelve in a loose block, every other one the other team when neutral is off
      for (let i = 0; i < 12; i++) {
        const x = ((i % 4) - 1.5) * 1.4;
        const z = (Math.floor(i / 4) - 1) * 1.4;
        const t = c.team === 'none' ? team.none : i % 2 === 0 ? team[c.team] : team[c.team === 'A' ? 'B' : 'A'];
        c.crowd.set(i, x, z, 0, c.clip, c.time + i * 0.13, c.loop, t);
      }
      c.crowd.commit(12);
    }
  }
  orbit.update();
  renderer.render(scene, camera);
});

function fit(): void {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(fit).observe(canvas);
fit();

void show(ENTRIES.find((e) => e.name === location.hash.slice(1)) ?? ENTRIES[0]!);
// a link to another asset (#unit.…) opens it
window.addEventListener('hashchange', () => {
  const e = ENTRIES.find((x) => x.name === location.hash.slice(1));
  if (e && e.name !== cur?.entry.name) void show(e);
});
