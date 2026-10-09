/**
 * Clothes made in code, for themes without outfit models of their own
 * (modern, sci-fi): the base body is dressed by region. Each vertex knows
 * from the bones that move it whether it is skin (head, hands), top
 * (torso, upper arms), forearm, hips and thighs, shins or feet; a shader
 * paints those regions as fabric — a shirt and trousers and shoes, or a
 * jumpsuit with glowing seams and boots — and accessories hang on bones like
 * the class gear (caps, glasses, bags; visors, shoulder plates, packs).
 *
 * Colours come from the person's seed, the hero's class and crest, so a crowd
 * is varied and a hero recognisable. Our own work, no third-party files.
 */

import * as THREE from 'three';
import type { HeroClass } from '../../domain/model.js';
import type { CharacterLook } from './themes.js';
import type { GearPiece } from './gear.js';
import { glow, paint } from './grammar/vehicles.js';

export type Wardrobe = 'modern' | 'scifi';

// --- body regions ------------------------------------------------------------------

/** Which region a bone dresses: 0 top, 1 forearm, 2 hips/thighs, 3 shins, 4 feet; null = skin. */
function regionOf(bone: string): number | null {
  const b = bone.toLowerCase();
  if (/hand|thumb|index|middle|ring|pinky|head|neck|eye|jaw/.test(b)) return null;
  if (b.includes('lowerarm')) return 1;
  if (b.includes('upperarm') || b.includes('clavicle') || b.includes('spine')) return 0;
  if (b.includes('pelvis') || b.includes('thigh')) return 2;
  if (b.includes('calf')) return 3;
  if (b.includes('foot') || b.includes('ball') || b.includes('toe')) return 4;
  return 0;
}

/**
 * Give a body geometry its dress weights (once; shared by every character
 * wearing it): `dressA` = top, forearm, hips/thighs, shins; `dressB` = feet.
 * Skin is what is left.
 */
export function addDressWeights(geo: THREE.BufferGeometry, bones: readonly THREE.Bone[]): void {
  if (geo.getAttribute('dressA')) return;
  const idx = geo.getAttribute('skinIndex');
  const wts = geo.getAttribute('skinWeight');
  const n = idx.count;
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n);
  const regions = bones.map((bone) => regionOf(bone.name));
  const get = [(v: number, at: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => at.getX(v), (v: number, at: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => at.getY(v), (v: number, at: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => at.getZ(v), (v: number, at: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => at.getW(v)];
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 4; k++) {
      const w = get[k]!(v, wts);
      if (w <= 0) continue;
      const r = regions[get[k]!(v, idx)] ?? null;
      if (r === null) continue;
      if (r === 4) b[v]! += w;
      else a[v * 4 + r]! += w;
    }
  }
  geo.setAttribute('dressA', new THREE.Float32BufferAttribute(a, 4));
  geo.setAttribute('dressB', new THREE.Float32BufferAttribute(b, 1));
}

// --- the look ---------------------------------------------------------------------

export interface Dress {
  top: string;
  /** Sleeves to the wrist (else the forearm shows skin). */
  longSleeves: boolean;
  bottom: string;
  /** Trousers to the ankle (else shorts). */
  longLegs: boolean;
  shoes: string;
  /** Belt or seam colour; glowing in sci-fi. */
  trim: string;
  glow: number;
  rough: number;
  metal: number;
}

const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
};
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

/** Sci-fi jumpsuits by calling: security red, science white, trader gold… */
const SUIT: Record<HeroClass, string> = {
  paladin: '#8a2a2a',
  monk: '#d8dce4',
  merchant: '#b08a2a',
  ranger: '#3a6a3a',
  bard: '#5a3a8a',
  adventurer: '#c06a28',
  sleeper: '#5a6068',
};

export function dressFor(look: CharacterLook, wardrobe: Wardrobe): Dress {
  const r = rng(look.seed * 2654435761 + (wardrobe === 'scifi' ? 7 : 3));
  const hero = look.kind === 'hero';
  if (wardrobe === 'scifi') {
    const suit = hero ? SUIT[look.cls] : pick(r, ['#4a5058', '#6a7078', '#3a4a5a', '#5a5048', '#40505a']);
    return {
      top: suit,
      longSleeves: true,
      bottom: suit,
      longLegs: true,
      shoes: '#2a2c30',
      trim: hero ? look.crest : pick(r, ['#40e0ff', '#7affc8', '#ffb040']),
      glow: hero ? 1.6 : 0.9,
      rough: 0.45,
      metal: 0.25,
    };
  }
  const shirts = ['#f2f0ea', '#2a3a5a', '#8a8f96', '#a83a32', '#3a6a4a', '#c8a040', '#222428', '#6a8ac0', '#d88a70'];
  return {
    top: hero ? look.crest : pick(r, shirts),
    longSleeves: r() < 0.5,
    bottom: pick(r, ['#2f4a72', '#3a5a8a', '#c8b48a', '#2a2a2e', '#5a5a60', '#6a5038']),
    longLegs: r() > 0.18,
    shoes: pick(r, ['#3a2a1e', '#1e1e22', '#7a5a3a', '#5a5a64', '#8a2a2a']),
    trim: '#3a2a1e',
    glow: 0,
    rough: 0.85,
    metal: 0,
  };
}

// --- the fabric shader --------------------------------------------------------------

/**
 * The body's own material, its skin kept where there are no clothes, the
 * rest painted as fabric (a faint weave; seams, belt and cuffs at the region
 * borders, glowing in sci-fi).
 */
export function dressedMaterial(skin: THREE.MeshStandardMaterial, d: Dress, wardrobe: Wardrobe): THREE.MeshStandardMaterial {
  const m = skin.clone();
  m.name = `${skin.name}|dress`;
  const u = {
    uTop: { value: new THREE.Color(d.top) },
    uBottom: { value: new THREE.Color(d.bottom) },
    uShoes: { value: new THREE.Color(d.shoes) },
    uTrim: { value: new THREE.Color(d.trim) },
    uSleeves: { value: d.longSleeves ? 1 : 0 },
    uLegs: { value: d.longLegs ? 1 : 0 },
    uGlow: { value: d.glow },
    uRough: { value: d.rough },
    uMetal: { value: d.metal },
    uSuit: { value: wardrobe === 'scifi' ? 1 : 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec4 dressA;\nattribute float dressB;\nvarying vec4 vDressA;\nvarying float vDressB;\nvarying vec3 vBind;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDressA = dressA;\nvDressB = dressB;\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec4 vDressA;
varying float vDressB;
varying vec3 vBind;
uniform vec3 uTop, uBottom, uShoes, uTrim;
uniform float uSleeves, uLegs, uGlow, uRough, uMetal, uSuit;
float clothMask;
float trimMask;
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float top = vDressA.x;
  float forearm = vDressA.y * uSleeves;
  float hips = vDressA.z;
  float shin = vDressA.w * uLegs;
  float feet = vDressB;
  float cover = top + forearm + hips + shin + feet;
  clothMask = smoothstep(0.42, 0.58, cover);
  // which garment: the upper or lower body, whichever moves this point more, with a crisp line between
  float upper = top + forearm;
  float lower = hips + shin;
  vec3 cloth = mix(uTop, uBottom, smoothstep(-0.06, 0.06, lower - upper));
  cloth = mix(cloth, uShoes, smoothstep(0.4, 0.6, feet / max(cover, 1e-3)));
  // a faint weave, and knit shading so it does not look painted on
  float weave = 0.94 + 0.06 * sin(vBind.y * 900.0) * sin(vBind.x * 900.0 + vBind.z * 600.0);
  cloth *= weave;
  // belt at the waist (top meets hips), cuffs at the wrists and ankles, knee bands in a suit
  float waist = (1.0 - smoothstep(0.0, 0.14, abs(lower - upper))) * step(0.35, upper + lower);
  float cuffs = (1.0 - smoothstep(0.0, 0.15, abs(cover - 0.5))) * step(0.5, forearm + shin + feet + 0.001);
  float knees = uSuit * (1.0 - smoothstep(0.0, 0.16, abs(hips - shin))) * step(0.35, hips + shin);
  trimMask = clamp(waist + cuffs * 0.8 + knees, 0.0, 1.0) * clothMask;
  cloth = mix(cloth, uTrim, trimMask * (uSuit > 0.5 ? 0.85 : 0.9));
  diffuseColor.rgb = mix(diffuseColor.rgb, cloth, clothMask);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uRough, clothMask);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, uMetal, clothMask);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += uTrim * uGlow * trimMask * uSuit;`,
      );
  };
  m.customProgramCacheKey = () => `dress-${wardrobe}`;
  return m;
}

// --- accessories ------------------------------------------------------------------

type V3 = [number, number, number];

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rot: V3 = [0, 0, 0]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

const group = (...parts: THREE.Object3D[]): THREE.Group => {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
};

/** Pieces are built along +Y (up the bone) facing +Z (forward), in metres. */
function cap(color: string): THREE.Group {
  return group(mesh(new THREE.SphereGeometry(0.105, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.05), paint(color, 0, 0.8)), mesh(new THREE.BoxGeometry(0.15, 0.012, 0.09), paint(color, 0, 0.8), 0, 0, 0.12));
}

function glasses(): THREE.Group {
  const frame = paint('#18181c', 0.3, 0.4);
  const lens = new THREE.MeshStandardMaterial({ color: '#304050', roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.7 });
  return group(
    mesh(new THREE.BoxGeometry(0.05, 0.03, 0.006), lens, -0.032, 0, 0),
    mesh(new THREE.BoxGeometry(0.05, 0.03, 0.006), lens, 0.032, 0, 0),
    mesh(new THREE.BoxGeometry(0.14, 0.006, 0.008), frame, 0, 0.014, 0),
  );
}

function backpack(color: string): THREE.Group {
  return group(mesh(new THREE.BoxGeometry(0.3, 0.38, 0.14), paint(color, 0, 0.85)), mesh(new THREE.BoxGeometry(0.26, 0.14, 0.04), paint(color, 0, 0.8), 0, -0.08, 0.08));
}

function briefcase(): THREE.Group {
  return group(mesh(new THREE.BoxGeometry(0.36, 0.26, 0.08), paint('#3a2414', 0.1, 0.5)), mesh(new THREE.TorusGeometry(0.04, 0.008, 4, 10, Math.PI), paint('#1a1a1a', 0.5, 0.4), 0, 0.14, 0));
}

function headphones(color: string): THREE.Group {
  const m = paint(color, 0.2, 0.4);
  return group(mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16, Math.PI), m), mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), m, -0.1, 0, 0, [0, 0, Math.PI / 2]), mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), m, 0.1, 0, 0, [0, 0, Math.PI / 2]));
}

function visor(light: string): THREE.Group {
  return group(mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 20, Math.PI * 1.1).rotateX(Math.PI / 2), paint('#c8ccd4', 0.8, 0.3), 0, 0, 0), mesh(new THREE.BoxGeometry(0.13, 0.025, 0.01), glow(light), 0, 0, 0.1));
}

function shoulderPad(color: string): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1.1), paint(color, 0.6, 0.35));
}

function airPack(light: string): THREE.Group {
  const shell = paint('#b8bcc4', 0.7, 0.35);
  return group(
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 12), shell, -0.08, 0, 0),
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 12), shell, 0.08, 0, 0),
    mesh(new THREE.BoxGeometry(0.06, 0.2, 0.02), glow(light), 0, 0.02, 0.07),
  );
}

function wristPad(light: string): THREE.Group {
  return group(mesh(new THREE.BoxGeometry(0.07, 0.1, 0.03), paint('#2a2c30', 0.5, 0.4)), mesh(new THREE.BoxGeometry(0.05, 0.07, 0.005), glow(light), 0, 0, 0.017));
}

function guitar(): THREE.Group {
  const wood = paint('#8a4a20', 0, 0.5);
  return group(mesh(new THREE.SphereGeometry(0.16, 14, 10).scale(1, 1.15, 0.35), wood), mesh(new THREE.BoxGeometry(0.05, 0.46, 0.03), paint('#2a1a10', 0, 0.6), 0, 0.36, 0));
}

/**
 * Accessories for a dressed body: a few for anyone (by seed), and the class's
 * signature piece for heroes. Directions in the bind pose: +z forward, +y up,
 * +x the character's left.
 */
export function wardrobeGear(look: CharacterLook, wardrobe: Wardrobe): GearPiece[] {
  const r = rng(look.seed * 40503 + 11);
  const head: Pick<GearPiece, 'bone' | 'anchor'> = { bone: 'Head', anchor: 'bone' }; // the universal skeleton capitalises this one
  const back: Pick<GearPiece, 'bone' | 'anchor'> = { bone: 'spine_03', anchor: 'bone' };
  const out: GearPiece[] = [];
  const hero = look.kind === 'hero';
  if (wardrobe === 'modern') {
    const roll = r();
    if (roll < 0.3) out.push({ ...head, offset: [0, 0.13, 0.0], axis: [0, 1, 0], face: [0, 0, 1], object: cap(pick(r, ['#1e2a4a', '#a83a32', '#2a2a2a', '#e8e4da'])) });
    else if (roll < 0.45) out.push({ ...head, offset: [0, 0.1, 0], axis: [0, 1, 0], face: [0, 0, 1], object: headphones(pick(r, ['#1a1a1a', '#e8e8e8', '#c83a3a'])) });
    if (r() < 0.3) out.push({ ...head, offset: [0, 0.07, 0.1], axis: [0, 1, 0], face: [0, 0, 1], object: glasses() });
    if (hero) {
      if (look.cls === 'merchant') out.push({ bone: 'hand_r', anchor: 'palm', offset: [0, -0.16, 0], axis: [0, 1, 0], face: [1, 0, 0], object: briefcase() });
      else if (look.cls === 'bard') out.push({ ...back, offset: [0, -0.05, -0.18], axis: [-0.5, 1, 0], face: [0, 0, -1], object: guitar() });
      else if (look.cls === 'adventurer' || look.cls === 'ranger') out.push({ ...back, offset: [0, 0, -0.16], axis: [0, 1, 0], face: [0, 0, -1], object: backpack(look.cls === 'ranger' ? '#3a5a3a' : '#c06a28') });
    } else if (r() < 0.25) out.push({ ...back, offset: [0, 0, -0.16], axis: [0, 1, 0], face: [0, 0, -1], object: backpack(pick(r, ['#2a2a2e', '#3a4a6a', '#6a3a2a'])) });
    return out;
  }
  // sci-fi
  const light = hero ? look.crest : pick(r, ['#40e0ff', '#7affc8', '#ffb040']);
  out.push({ ...head, offset: [0, 0.095, 0.01], axis: [0, 1, 0], face: [0, 0, 1], object: visor(light) });
  if (hero || r() < 0.4) out.push({ bone: 'lowerarm_l', anchor: 'mid', offset: [0, 0.03, 0], axis: [1, 0, 0], face: [0, 1, 0], object: wristPad(light) });
  if (hero && (look.cls === 'paladin' || look.cls === 'adventurer' || look.cls === 'ranger')) {
    for (const side of ['l', 'r'] as const) out.push({ bone: `upperarm_${side}`, anchor: 'bone', offset: [0, 0.04, 0], axis: [0, 1, 0], face: [side === 'l' ? 1 : -1, 0, 0], object: shoulderPad(SUIT[look.cls]) });
  }
  if (hero && (look.cls === 'adventurer' || look.cls === 'ranger' || look.cls === 'monk')) out.push({ ...back, offset: [0, 0, -0.15], axis: [0, 1, 0], face: [0, 0, -1], object: airPack(light) });
  else if (!hero && r() < 0.3) out.push({ ...back, offset: [0, 0, -0.15], axis: [0, 1, 0], face: [0, 0, -1], object: airPack(light) });
  if (hero && look.cls === 'bard') out.push({ ...back, offset: [0, -0.05, -0.18], axis: [-0.5, 1, 0], face: [0, 0, -1], object: guitar() });
  if (hero && look.cls === 'merchant') out.push({ bone: 'hand_r', anchor: 'palm', offset: [0, -0.16, 0], axis: [0, 1, 0], face: [1, 0, 0], object: briefcase() });
  return out;
}
