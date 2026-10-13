/**
 * The house's inside in 3D, as a whole-screen view: the room from
 * `room3d.ts`, lit by a hearth-warm light, with a camera inside it that you
 * turn to look around (drag; scroll to lean in, Esc to leave). The hero whose
 * house it is stands in it, as the town draws them, and talks about the house.
 * Hover a thing to read its name; click it and the hero walks over and looks
 * at it. People who ask for less motion get the hero placed at once.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { openShell } from '../../ui/roomShell.js';
import { el } from '../../ui/dom.js';
import { isClick, keepInside } from '../../ui/roomHelpers.js';
import { safeHref } from '../../ui/dom.js';
import { walkPath, type Point } from './roomPath.js';
import type { Room } from '../../world/roomLayout.js';
import { roomRemark } from '../../world/roomTalk.js';
import { MaterialLibrary } from './grammar/materials.js';
import { METRES_PER_TILE } from './grammar/medieval.js';
import { buildRoom3d, ROOM3D } from './room3d.js';
import type { SandboxCharacter } from './themes.js';

/** A hero's height in the room, in metres. */
const HERO_HEIGHT = 1.8;
/** A hero's walk, in metres a second. */
const WALK = 1.2;
/** How far (px) a pointer may be from a thing and still be on it. */
const REACH = 70;

interface Label {
  at: THREE.Vector3;
  text: string;
  stand: THREE.Vector3;
}

export function openRoom3d(room: Room, lib: MaterialLibrary | null, figure: SandboxCharacter | null = null): () => void {
  const canvas = el('canvas', { class: 'room3d', role: 'img', 'aria-label': room.empty ? `${room.title}: nothing here yet` : `${room.title}: the inside` });
  const talk = el('div', { class: 'room3d-talk', role: 'status' }, roomRemark(room));
  const tip = el('div', { class: 'room3d-tip', hidden: '' });
  const wrap = el('div', { class: 'room3d-wrap' }, canvas, talk, tip);
  const close = openShell(room.title, wrap, { hint: 'drag to look around · scroll to lean in · click a thing to go and look at it · Esc to leave' });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b120a');
  scene.add(new THREE.HemisphereLight('#fff1d6', '#3a2a1a', 1.1));
  // candlelight: one by the table, one by the counter
  for (const [x, y, z] of [
    [-1.2, 2.6, 0.2],
    [1.8, 2.4, -1.2],
  ] as const) {
    const light = new THREE.PointLight('#ffc870', 7, 9, 1.4);
    light.position.set(x, y, z);
    scene.add(light);
  }
  const built = buildRoom3d(room, lib ?? new MaterialLibrary({}));
  scene.add(built.group);
  const labels: Label[] = built.labels;

  // the hero, standing by the table at their own height; their words are pinned above their head
  // a token's logo over its heap of coins, so it is at once clear what the coins are
  const logos = built.labels
    .map((l) => ({ l, src: l.image === undefined ? null : safeHref(l.image) }))
    .filter((x): x is { l: (typeof built.labels)[number]; src: string } => x.src !== null)
    .map((x) => ({ at: x.l.at.clone().add(new THREE.Vector3(0, 0.08, 0)), img: el('img', { class: 'room3d-logo', alt: '', referrerpolicy: 'no-referrer', src: x.src }) }));
  for (const { img } of logos) wrap.append(img);

  // the NFT pictures: an <img> over each frame (WebGL textures would need CORS, which the picture hosts do not send)
  const pictures = built.frames
    .map((f) => ({ f, src: f.image === undefined ? null : safeHref(f.image) }))
    .filter((p): p is { f: (typeof built.frames)[number]; src: string } => p.src !== null)
    .map((p) => ({ f: p.f, img: el('img', { class: 'room3d-pic', alt: '', referrerpolicy: 'no-referrer', src: p.src }) }));
  for (const { img } of pictures) wrap.append(img);

  // the NFT pictures as textures, on the frames: through our own picture proxy (same origin, so WebGL may read them);
  // until one loads, or where there is no proxy (the dev server), the image above stays
  const textured = new Set<(typeof built.frames)[number]>();
  const textures: THREE.Texture[] = [];
  const meshes: THREE.Mesh[] = [];
  let closed = false;
  const loader = new THREE.TextureLoader();
  for (const f of built.frames) {
    const src = f.image === undefined ? null : safeHref(f.image);
    if (src === null) continue;
    loader.load(
      `/api/image?u=${encodeURIComponent(src)}`,
      (tex) => {
        if (closed) return tex.dispose(); // (the room was left before the picture came)
        tex.colorSpace = THREE.SRGBColorSpace;
        textures.push(tex);
        // the picture is fitted whole into the frame's inside, centred
        const aspect = tex.image.width / tex.image.height;
        const frameAspect = f.w / f.h;
        const pw = aspect > frameAspect ? f.w : f.h * aspect;
        const ph = aspect > frameAspect ? f.w / aspect : f.h;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
        // just in front of the frame, facing into the room
        mesh.position.copy(f.center).add(f.across === 'x' ? new THREE.Vector3(0, 0, 0.02) : new THREE.Vector3(0.02, 0, 0));
        if (f.across === 'z') mesh.rotation.y = Math.PI / 2;
        scene.add(mesh);
        meshes.push(mesh);
        textured.add(f);
      },
      undefined,
      () => undefined, // no texture: the image over the frame stays
    );
  }

  const talker = built.talker.clone();
  const body = figure?.object ?? null;
  if (figure !== null && body !== null) {
    scene.add(body);
    body.position.set(talker.x, 0, talker.z);
    body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    const k = HERO_HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    body.scale.setScalar(k);
    body.position.set(talker.x, -box.min.y * k, talker.z);
    body.updateMatrixWorld(true);
    talker.set(talker.x, HERO_HEIGHT + 0.12, talker.z);
    figure.setState('idle');
  }

  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 40);
  camera.position.set(0, 1.7, ROOM3D.d / 2 - 0.3);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0.2); // looking a little down, so the floor by the door is in view
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 2.0;
  controls.minPolarAngle = 0.6;
  controls.maxPolarAngle = 2.1;
  controls.update();

  const fit = (): void => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', fit);
  fit();

  // people who ask for less motion get the hero placed at once, not walking
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // screen position of a point in the room, in the view's pixels
  const screen = new THREE.Vector3();
  const place = (at: THREE.Vector3): { x: number; y: number; visible: boolean } => {
    screen.copy(at).project(camera);
    return { x: ((screen.x + 1) / 2) * canvas.clientWidth, y: ((1 - screen.y) / 2) * canvas.clientHeight, visible: screen.z <= 1 };
  };

  /** The nearest thing under a point on the canvas (its screen place, and what it is). */
  const under = (px: number, py: number): { label: Label; x: number; y: number } | null => {
    let best: { label: Label; x: number; y: number; d: number } | null = null;
    for (const label of labels) {
      const p = place(label.at);
      const d = Math.hypot(p.x - px, p.y - py);
      if (p.visible && d < REACH && (best === null || d < best.d)) best = { label, x: p.x, y: p.y, d };
    }
    return best === null ? null : { label: best.label, x: best.x, y: best.y };
  };

  // where the hero is going to, and what they look at when they get there
  let goal: { stand: THREE.Vector3; look: THREE.Vector3 } | null = null;
  // the way round the furniture to the goal (its last point is the goal)
  let path: Point[] = [];
  let walking = false;

  const draw = (t: number, dt: number): void => {
    built.animate(t);
    if (figure !== null && body !== null) {
      if (goal !== null) {
        // the next point on the way round the furniture
        const next = path[0] ?? goal.stand;
        const dx = next.x - body.position.x;
        const dz = next.z - body.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.04) {
          // walk: the way they go, and the face they show
          const step = still ? d : Math.min(d, WALK * dt);
          body.position.x += (dx / d) * step;
          body.position.z += (dz / d) * step;
          const heading = Math.atan2(dz, dx);
          if (!walking) figure.setState('walk');
          walking = true;
          figure.update(dt, WALK / METRES_PER_TILE, heading, camera);
        } else if (path.length > 1) {
          path.shift();
        } else {
          // arrived: stand, and look at the thing
          if (walking) figure.setState('idle');
          walking = false;
          const look = Math.atan2(goal.look.z - body.position.z, goal.look.x - body.position.x);
          figure.update(dt, 0, look, camera, look);
        }
      } else {
        // standing: towards whoever is looking
        const heading = Math.atan2(camera.position.z - body.position.z, camera.position.x - body.position.x);
        figure.update(dt, 0, heading, camera, heading);
      }
      talker.set(body.position.x, HERO_HEIGHT + 0.12, body.position.z);
    }
    renderer.render(scene, camera);
    for (const { at, img } of logos) {
      const p = place(at);
      img.hidden = !p.visible;
      img.style.left = `${p.x}px`;
      img.style.top = `${p.y}px`;
    }
    // each picture is laid over its frame, the size the frame has on screen
    for (const { f, img } of pictures) {
      const c = place(f.center);
      const side = new THREE.Vector3(f.across === 'x' ? f.w / 2 : 0, 0, f.across === 'z' ? f.w / 2 : 0);
      const up = new THREE.Vector3(0, f.h / 2, 0);
      const pw = Math.abs(place(f.center.clone().add(side)).x - place(f.center.clone().sub(side)).x);
      const ph = Math.abs(place(f.center.clone().add(up)).y - place(f.center.clone().sub(up)).y);
      img.hidden = !c.visible || textured.has(f);
      img.style.left = `${c.x}px`;
      img.style.top = `${c.y}px`;
      img.style.width = `${pw * 0.82}px`;
      img.style.height = `${ph * 0.82}px`;
    }
    // the hero's words follow them on screen, kept inside the view so they are never cut off
    const v = place(talker);
    talk.hidden = !v.visible;
    if (v.visible) {
      const x = keepInside(v.x, talk.offsetWidth, canvas.clientWidth);
      talk.style.transform = `translate(${x}px, ${v.y}px) translate(-50%, -100%)`;
    }
  };

  // hover: the nearest thing under the pointer names itself
  const hover = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    const hit = under(e.clientX - r.left, e.clientY - r.top);
    tip.hidden = hit === null;
    if (hit !== null) {
      tip.textContent = hit.label.text;
      tip.style.transform = `translate(${hit.x}px, ${hit.y - 14}px) translate(-50%, -100%)`;
    }
  };
  canvas.addEventListener('pointermove', hover);
  canvas.addEventListener('pointerleave', () => (tip.hidden = true));

  // click (not a drag) on a thing: the hero goes to it and looks at it
  let press: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => (press = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    const click = isClick(press, { x: e.clientX, y: e.clientY });
    press = null;
    if (!click || body === null) return;
    const r = canvas.getBoundingClientRect();
    const hit = under(e.clientX - r.left, e.clientY - r.top);
    if (hit === null) return;
    const stand = hit.label.stand.clone();
    goal = { stand, look: hit.label.at.clone() };
    path = walkPath({ x: body.position.x, z: body.position.z }, stand, built.solids, built.floor);
  });

  let last = performance.now();
  const tick = (): void => {
    const now = performance.now();
    controls.update();
    draw(now / 1000, (now - last) / 1000);
    last = now;
  };
  if (still) {
    controls.addEventListener('change', () => draw(0, 0));
    draw(0, 0);
  } else {
    renderer.setAnimationLoop(tick);
  }

  return () => {
    closed = true;
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', fit);
    controls.dispose();
    figure?.dispose();
    built.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); // (the theme's materials are shared: kept)
    });
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const t of textures) t.dispose();
    renderer.dispose();
    renderer.forceContextLoss(); // (a browser allows only so many WebGL contexts: free this one now)
    close();
  };
}
