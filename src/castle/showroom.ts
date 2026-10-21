/**
 * The showroom (showroom.html): every model a theme has, in one scene at true
 * scale, in rows by group (castle, town, people, animals, props, landmarks by
 * size class, category buildings by category and class). Idle clips play; a
 * click plays the model's `tap`. Landmarks and category buildings carry a real
 * protocol's logo and colour; a tier picker shows the tier parts. The 2D art
 * (badges, ranks, frames, icons, effects, app icons) is a second view.
 *
 *   /showroom.html?theme=medieval-castle-v2      (the default theme otherwise)
 *   &all=1  also the models the theme borrows from the one it extends
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { el } from '../util/dom.js';
import { ASSETS, SIZE_CLASSES, assetPath, brandColor, sizeClassOf, tierColor, type AssetSpec } from './assets/manifest.js';
import { ModelLibrary, disposeTree, type Loaded } from './assets/models.js';
import { artTheme, loadCastleTheme, loadThemeImage, themeChain, themeFileUrl, themeFromUrl } from './assets/theme.js';
import { logoPath } from './world/logos.js';
import { sizeFor, standingOf } from './world/size.js';

const params = new URLSearchParams(location.search);
const theme = await loadCastleTheme(import.meta.env.BASE_URL, themeFromUrl(location.search));
const includeBorrowed = params.get('all') === '1';

/** A protocol of each category whose logo and colour a category building shows. */
const CATEGORY_PROTOCOL: Record<string, string> = {
  lending: 'morpho',
  dex: 'uniswap',
  staking: 'lido',
  nft: 'sudoswap',
  governance: 'compound',
  bridge: 'across',
  other: 'defi-saver',
};
const CREST = '#3f7fd6';
const LOGO_PLATE = '#efe3c8';
const GAP = 2;
const ROW_GAP = 6;
const LOOPING = ['idle', 'wave', 'swim', 'sail'];

interface Row {
  title: string;
  names: string[];
}
interface Shown {
  spec: AssetSpec;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  tap: THREE.AnimationAction | null;
  label: HTMLDivElement;
  top: THREE.Vector3;
  /** Its tier parts (tier.2/4/6). */
  tiers: { node: THREE.Object3D; tier: number }[];
}

// ---------- page ----------
const root = document.querySelector<HTMLDivElement>('#app')!;
const canvas = el('canvas', {});
const labels = el('div', { class: 'showroom-labels' });
const status = el('span', { class: 'status' }, 'Looking for files…');
const viewSel = el('select', { 'aria-label': 'View' }, el('option', { value: '3d' }, '3D models'), el('option', { value: '2d' }, '2D art'));
const tierSel = el('select', { 'aria-label': 'Tier' }, ...[0, 1, 2, 3, 4, 5, 6].map((t) => el('option', { value: String(t) }, `Tier ${t}`)));
const jumpSel = el('select', { 'aria-label': 'Go to row' }, el('option', { value: '' }, 'Go to…'));
const artPanel = el('div', { class: 'showroom-art', hidden: '' });
root.replaceChildren(
  el('div', { class: 'showroom' }, canvas, labels, el('div', { class: 'showroom-bar' }, el('span', { class: 'title' }, `Showroom · ${theme.name} ${theme.version}`), viewSel, tierSel, jumpSel, status), artPanel),
);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb3c9);
const pmrem = new THREE.PMREMGenerator(renderer);
const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envTarget.texture;
scene.environmentIntensity = 0.45;
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x8a6e4b, 1));
const sun = new THREE.DirectionalLight(0xffe2b8, 3);
sun.position.set(0.45, 0.82, 0.35).multiplyScalar(100);
scene.add(sun);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x6f8f55, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), groundMat);
ground.position.y = -0.03;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 4;
controls.maxDistance = 900;
controls.screenSpacePanning = false;

function resize(): void {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

// ---------- which models ----------
async function fileExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

const chain = themeChain(theme);
const models = ASSETS.filter((a) => a.kind === 'model');
const present = await Promise.all(
  models.map(async (spec) => {
    const from = includeBorrowed ? chain : [theme];
    for (const t of from) if (await fileExists(themeFileUrl(t, assetPath(spec)))) return spec;
    return null;
  }),
);
const available = new Set(present.filter((s): s is AssetSpec => s !== null).map((s) => s.name));

/** The rows, in order: what each shows. */
function rowsOf(names: Set<string>): Row[] {
  const take = (test: (n: string) => boolean) => [...names].filter(test).sort();
  const rows: Row[] = [
    { title: 'Castle', names: take((n) => n.startsWith('castle.') || n.startsWith('bridge.')) },
    { title: 'Town', names: take((n) => n.startsWith('town.') || n.startsWith('path.') || n.startsWith('moat.')) },
    { title: 'People and cargo', names: take((n) => n.startsWith('person.') || n.startsWith('courier.')) },
    { title: 'Animals', names: take((n) => n.startsWith('animal.')) },
    { title: 'Props and scenery', names: take((n) => n.startsWith('prop.') || n.startsWith('scenery.')) },
  ];
  // landmarks by size class, biggest first
  const landmarks = take((n) => n.startsWith('building.protocol.'));
  const classOf = (n: string) => sizeClassOf(2 * sizeFor(standingOf(n.replace('building.protocol.', '')) ?? 1e6));
  for (const c of [...SIZE_CLASSES].reverse()) {
    const list = landmarks.filter((n) => classOf(n) === c.id);
    if (list.length) rows.push({ title: `Landmarks ${c.id.toUpperCase()}`, names: list });
  }
  // category buildings: one row per category, XS … XL
  for (const cat of Object.keys(CATEGORY_PROTOCOL)) {
    const list = SIZE_CLASSES.map((c) => `building.category.${cat}.${c.id}`).filter((n) => names.has(n));
    const old = take((n) => n.startsWith(`building.category.${cat}.t`));
    if (list.length || old.length) rows.push({ title: `Category: ${cat}`, names: [...list, ...old] });
  }
  rows.push({ title: 'Other', names: take((n) => !rows.some((r) => r.names.includes(n))) });
  return rows.filter((r) => r.names.length);
}

// ---------- painting, logos, tiers ----------
const painted = new Map<string, THREE.Material>();
function paint(obj: THREE.Object3D, material: 'Tint' | 'Trim', color: string): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (m.name !== material) return m;
      const key = `${m.uuid}|${color}`;
      let mine = painted.get(key);
      if (!mine) {
        mine = m.clone();
        (mine as THREE.MeshStandardMaterial).color?.set(color);
        painted.set(key, mine);
      }
      return mine;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

const logoMaterials = new Map<string, Promise<THREE.Material | null>>();
async function logoMaterial(template: THREE.Material, path: string): Promise<THREE.Material | null> {
  try {
    const img = await loadThemeImage(theme, path);
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = LOGO_PLATE;
    g.fillRect(0, 0, size, size);
    const room = size * 0.76;
    const k = room / Math.max(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (size - img.naturalWidth * k) / 2, (size - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    const m = template.clone() as THREE.MeshStandardMaterial;
    m.map = map;
    return m;
  } catch {
    return null;
  }
}
async function showLogo(obj: THREE.Object3D, protocolId: string): Promise<void> {
  const path = logoPath(protocolId);
  if (!path) return;
  const plates: THREE.Mesh[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => m.name === 'Logo')) plates.push(mesh);
  });
  if (!plates.length) return;
  const first = plates[0]!.material;
  const template = (Array.isArray(first) ? first : [first]).find((m) => m.name === 'Logo')!;
  let made = logoMaterials.get(path);
  if (!made) logoMaterials.set(path, (made = logoMaterial(template, path)));
  const material = await made;
  if (!material) return;
  for (const mesh of plates) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => (m.name === 'Logo' ? material : m)) : material;
}

function tierParts(obj: THREE.Object3D): { node: THREE.Object3D; tier: number }[] {
  const out: { node: THREE.Object3D; tier: number }[] = [];
  obj.traverse((o) => {
    const m = /^tier\.(\d)$/.exec((o.userData.name as string | undefined) ?? o.name);
    if (m) out.push({ node: o, tier: Number(m[1]) });
  });
  return out;
}

// ---------- building the scene ----------
const library = new ModelLibrary(theme);
const shown: Shown[] = [];
const rowLabels: { label: HTMLDivElement; at: THREE.Vector3 }[] = [];

function protocolOf(name: string): string | null {
  if (name.startsWith('building.protocol.')) return name.replace('building.protocol.', '');
  const m = /^building\.category\.(\w+)\./.exec(name);
  return m ? CATEGORY_PROTOCOL[m[1]!] ?? null : null;
}

async function build(): Promise<void> {
  const rows = rowsOf(available);
  status.textContent = `Loading ${available.size} models…`;
  const loaded = new Map<string, Loaded | null>();
  await Promise.all([...available].map(async (n) => loaded.set(n, await library.load(n))));

  let z = 0;
  let widest = 0;
  for (const row of rows) {
    const objs = row.names.map((n) => {
      const spec = ASSETS.find((a) => a.name === n)!;
      const obj = library.instance(spec, loaded.get(n) ?? null);
      const protocol = protocolOf(n);
      if (protocol) {
        const brand = brandColor(protocol);
        if (brand) paint(obj, 'Tint', brand);
        void showLogo(obj, protocol);
      } else paint(obj, 'Tint', CREST);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      return { spec, obj, box };
    });
    const depth = Math.max(...objs.map((o) => o.box.max.z - o.box.min.z));
    let x = 0;
    for (const { spec, obj, box } of objs) {
      const w = box.max.x - box.min.x;
      obj.position.set(x - box.min.x, 0, z + depth / 2 - (box.max.z + box.min.z) / 2);
      x += w + GAP;
      scene.add(obj);
      const clips = loaded.get(spec.name)?.clips ?? [];
      const mixer = clips.length ? new THREE.AnimationMixer(obj) : null;
      const idleClip = clips.find((c) => LOOPING.includes(c.name));
      const tapClip = clips.find((c) => c.name === 'tap');
      const idle = idleClip && mixer ? mixer.clipAction(idleClip) : null;
      idle?.play();
      const tap = tapClip && mixer ? mixer.clipAction(tapClip) : null;
      if (tap) {
        tap.setLoop(THREE.LoopOnce, 1);
        tap.clampWhenFinished = false;
      }
      // after a tap, back to the idle
      mixer?.addEventListener('finished', () => idle?.reset().fadeIn(0.2).play());
      const label = el('div', { class: 'showroom-label' }, spec.name.replace(/^(building\.|castle\.|person\.npc\.|animal\.|prop\.|scenery\.)/, ''));
      labels.append(label);
      shown.push({ spec, root: obj, mixer, idle, tap, label, top: new THREE.Vector3(obj.position.x + (box.min.x + box.max.x) / 2 - box.min.x, box.max.y + 0.3, obj.position.z), tiers: tierParts(obj) });
    }
    widest = Math.max(widest, x);
    const label = el('div', { class: 'showroom-label group' }, row.title);
    labels.append(label);
    rowLabels.push({ label, at: new THREE.Vector3(-4, 1, z + depth / 2) });
    jumpSel.append(el('option', { value: String(z + depth / 2) }, row.title));
    z += depth + ROW_GAP;
  }
  ground.scale.set(widest + 60, 1, z + 60);
  ground.position.set(widest / 2, -0.03, z / 2);
  applyTier(0);
  // start on the first rows, from the front
  controls.target.set(Math.min(widest, 60) / 2, 0, 10);
  camera.position.set(controls.target.x + 25, 40, controls.target.z + 70);
  controls.update();
  status.textContent = `${shown.length} models · click one to play its tap · drag to orbit, right-drag to pan, wheel to zoom`;
}

function applyTier(tier: number): void {
  for (const s of shown) {
    for (const p of s.tiers) p.node.visible = tier >= p.tier;
    // the tier colour on the Trim parts (castle and category buildings)
    if (s.spec.name.startsWith('building.category.') || s.spec.name.startsWith('castle.')) paint(s.root, 'Trim', tierColor(tier));
  }
}
tierSel.addEventListener('change', () => applyTier(Number(tierSel.value)));
jumpSel.addEventListener('change', () => {
  if (!jumpSel.value) return;
  const z = Number(jumpSel.value);
  const dx = camera.position.x - controls.target.x;
  const dy = camera.position.y - controls.target.y;
  const dz = camera.position.z - controls.target.z;
  controls.target.set(controls.target.x, 0, z);
  camera.position.set(controls.target.x + dx, dy, z + dz);
  jumpSel.value = '';
});

// ---------- tap ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(shown.map((s) => s.root), true)[0];
  if (!hit) return;
  const s = shown.find((x) => {
    let o: THREE.Object3D | null = hit.object;
    while (o && o !== x.root) o = o.parent;
    return o === x.root;
  });
  if (!s?.tap) return;
  const skinned = s.root.getObjectByProperty('isSkinnedMesh', true) !== undefined;
  // a person's tap takes over its body; a building's plays over its idle
  if (skinned && s.idle) s.idle.fadeOut(0.15);
  s.tap.reset().fadeIn(skinned ? 0.15 : 0).play();
});

// ---------- loop ----------
const timer = new THREE.Timer();
const scratch = new THREE.Vector3();
function placeLabel(div: HTMLDivElement, at: THREE.Vector3, minPx: number, distance: number): void {
  scratch.copy(at).project(camera);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const visible = scratch.z < 1 && Math.abs(scratch.x) < 1.1 && Math.abs(scratch.y) < 1.1 && distance < minPx;
  div.hidden = !visible;
  if (!visible) return;
  div.style.left = `${((scratch.x + 1) / 2) * w}px`;
  div.style.top = `${((1 - scratch.y) / 2) * h}px`;
}
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(0.1, timer.getDelta());
  controls.update();
  for (const s of shown) s.mixer?.update(dt);
  renderer.render(scene, camera);
  if (!artPanel.hidden) return;
  for (const s of shown) placeLabel(s.label, s.top, 140, camera.position.distanceTo(s.top));
  for (const r of rowLabels) placeLabel(r.label, r.at, 600, camera.position.distanceTo(r.at));
});

// ---------- 2D art ----------
function buildArt(): void {
  const art = artTheme(theme);
  const groups: [string, (a: AssetSpec) => boolean, boolean][] = [
    ['Badges', (a) => a.name.startsWith('badge.'), false],
    ['Ranks', (a) => a.name.startsWith('rank.'), false],
    ['Tab icons (on the dark tab bar, and on cream)', (a) => a.name.startsWith('ui.icon.'), true],
    ['Tier frames', (a) => a.name.startsWith('ui.frame.'), false],
    ['Effects', (a) => a.kind === 'fx' && !a.name.startsWith('app.'), false],
    ['App icons', (a) => a.name.startsWith('app.'), false],
  ];
  artPanel.replaceChildren(el('p', {}, `2D art from ${art.name} ${art.version}`));
  for (const [title, test, dark] of groups) {
    const list = ASSETS.filter((a) => a.kind !== 'model' && test(a));
    if (!list.length) continue;
    const tiles = el('div', { class: 'tiles' });
    for (const a of list) {
      const src = themeFileUrl(art, assetPath(a));
      const name = a.name.replace(/^(badge|rank|ui|fx|app)\./, '');
      tiles.append(el('figure', {}, el('img', { src, alt: a.name, loading: 'lazy' }), name));
      if (dark) tiles.append(el('figure', { class: 'dark' }, el('img', { src, alt: a.name, loading: 'lazy' }), `${name} (tab bar)`));
    }
    artPanel.append(el('h2', {}, title), tiles);
  }
}
viewSel.addEventListener('change', () => {
  const art = viewSel.value === '2d';
  artPanel.hidden = !art;
  labels.hidden = art;
  tierSel.hidden = art;
  jumpSel.hidden = art;
  if (art && !artPanel.childElementCount) buildArt();
});

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null);
  for (const s of shown) {
    s.mixer?.stopAllAction();
    s.mixer?.uncacheRoot(s.root);
  }
  void library.dispose();
  for (const m of painted.values()) m.dispose();
  disposeTree(ground);
  envTarget.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
});

await build();
// Test hook (dev server only).
if (import.meta.env.DEV) (window as unknown as { showroom?: unknown }).showroom = { count: () => shown.length, rows: () => rowLabels.length };
