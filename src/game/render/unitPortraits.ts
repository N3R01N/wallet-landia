/**
 * Unit portraits for the guide: each unit's model in its idle pose, in the
 * player's colour, from a three-quarter angle, as a PNG data URL. One small
 * offscreen renderer draws them all, then goes; each portrait is made once.
 */

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Loaded } from '../../castle/assets/models.js';
import { TEAM_COLORS } from './battleView.js';

const SIZE = 160;
const made = new Map<string, Promise<string | null>>();

/** Portraits of these units (by unit type id); a unit whose model can't be had gets null. */
export function unitPortraits(ids: readonly string[], load: (name: string) => Promise<Loaded | null>): Map<string, Promise<string | null>> {
  const todo = ids.filter((id) => !made.has(id));
  if (todo.length > 0) {
    const batch = drawAll(todo, load);
    todo.forEach((id) => made.set(id, batch.then((r) => r.get(id) ?? null)));
  }
  return new Map(ids.map((id) => [id, made.get(id)!]));
}

async function drawAll(ids: readonly string[], load: (name: string) => Promise<Loaded | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const models = await Promise.all(ids.map(async (id) => [id, await load(`unit.${id}`).catch(() => null)] as const));
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out; // no WebGL: the guide shows the role's icon instead
  }
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a3a, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 5, 4);
  scene.add(sun);
  const tint = new THREE.Color(TEAM_COLORS.A);
  for (const [id, loaded] of models) {
    if (!loaded) continue;
    const root = cloneSkinned(loaded.scene);
    const mine: THREE.Material[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const recolor = (m: THREE.Material) => {
        if (m.name !== 'Tint' || !('color' in m)) return m;
        const c = (m as THREE.MeshStandardMaterial).clone();
        c.color.copy(tint);
        mine.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
    });
    // a moment into its idle (the rest pose is a T-pose for some)
    const idle = loaded.clips.find((c) => c.name === 'idle') ?? loaded.clips[0];
    const mixer = new THREE.AnimationMixer(root);
    if (idle) {
      mixer.clipAction(idle).play();
      mixer.update(Math.min(0.4, idle.duration / 2));
    }
    root.updateMatrixWorld(true);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const dist = (Math.max(size.y, size.x, size.z) / 2 / Math.tan(THREE.MathUtils.degToRad(14))) * 1.15;
    camera.position.set(centre.x + dist * 0.55, centre.y + dist * 0.25, centre.z + dist * 0.8);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    out.set(id, renderer.domElement.toDataURL('image/png'));
    scene.remove(root);
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const m of mine) m.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
