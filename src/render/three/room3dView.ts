/**
 * The house's inside in 3D, as a whole-screen view: the room from
 * `room3d.ts`, lit by a hearth-warm light, with a camera inside it that you
 * turn to look around (drag; scroll to lean in, Esc to leave). The hero whose
 * house it is stands in it, as the town draws them, and talks about the house.
 * Hover a thing to read its name. People who ask for less motion get a still room.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { openShell } from '../../ui/roomShell.js';
import { el } from '../../ui/dom.js';
import type { Room } from '../../world/roomLayout.js';
import { roomRemark } from '../../world/roomTalk.js';
import { MaterialLibrary } from './grammar/materials.js';
import { buildRoom3d, ROOM3D } from './room3d.js';
import type { SandboxCharacter } from './themes.js';

/** A hero's height in the room, in metres. */
const HERO_HEIGHT = 1.8;

export function openRoom3d(room: Room, lib: MaterialLibrary | null, figure: SandboxCharacter | null = null): () => void {
  const canvas = el('canvas', { class: 'room3d', role: 'img', 'aria-label': room.empty ? `${room.title}: nothing here yet` : `${room.title}: the inside` });
  const talk = el('div', { class: 'room3d-talk' }, roomRemark(room));
  const tip = el('div', { class: 'room3d-tip', hidden: '' });
  const wrap = el('div', { class: 'room3d-wrap' }, canvas, talk, tip);
  const close = openShell(room.title, wrap, { hint: 'drag to look around · scroll to lean in · hover for names · Esc to leave' });

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

  // the hero, standing by the door at their own height; their words are pinned above their head
  const talker = built.talker.clone();
  if (figure !== null) {
    const body = figure.object;
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

  // screen position of a point in the room, in the view's pixels
  const screen = new THREE.Vector3();
  const place = (at: THREE.Vector3): { x: number; y: number; visible: boolean } => {
    screen.copy(at).project(camera);
    return { x: ((screen.x + 1) / 2) * canvas.clientWidth, y: ((1 - screen.y) / 2) * canvas.clientHeight, visible: screen.z <= 1 };
  };

  let last = performance.now();
  const draw = (t: number, dt: number): void => {
    built.animate(t);
    if (figure !== null) {
      // the hero turns to face whoever is looking
      const heading = Math.atan2(camera.position.z - talker.z, camera.position.x - talker.x);
      figure.update(dt, 0, heading, camera, heading);
    }
    renderer.render(scene, camera);
    // the hero's words follow them on screen, kept inside the view so they are never cut off
    const v = place(talker);
    talk.hidden = !v.visible;
    if (v.visible) {
      const half = talk.offsetWidth / 2;
      const x = Math.min(Math.max(v.x, half + 6), canvas.clientWidth - half - 6);
      talk.style.transform = `translate(${x}px, ${v.y}px) translate(-50%, -100%)`;
    }
  };

  // hover: the nearest thing under the pointer names itself
  const hover = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: { text: string; x: number; y: number; d: number } | null = null;
    for (const l of built.labels) {
      const p = place(l.at);
      const d = Math.hypot(p.x - px, p.y - py);
      if (p.visible && d < 70 && (best === null || d < best.d)) best = { text: l.text, x: p.x, y: p.y, d };
    }
    tip.hidden = best === null;
    if (best !== null) {
      tip.textContent = best.text;
      tip.style.transform = `translate(${best.x}px, ${best.y - 14}px) translate(-50%, -100%)`;
    }
  };
  canvas.addEventListener('pointermove', hover);
  canvas.addEventListener('pointerleave', () => (tip.hidden = true));

  // people who ask for less motion get a still room, redrawn when they turn it
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;
  const loop = (): void => {
    const now = performance.now();
    controls.update();
    draw(now / 1000, (now - last) / 1000);
    last = now;
    frame = requestAnimationFrame(loop);
  };
  if (still) {
    controls.addEventListener('change', () => draw(0, 0));
    draw(0, 0);
  } else {
    loop();
  }

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', fit);
    controls.dispose();
    figure?.dispose();
    built.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); // (the theme's materials are shared: kept)
    });
    renderer.dispose();
    renderer.forceContextLoss(); // (a browser allows only so many WebGL contexts: free this one now)
    close();
  };
}
