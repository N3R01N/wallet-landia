/**
 * Buildings from a style's recipes (medieval, modern, sci-fi): a recipe builds
 * in metres with the Mason; this turns the result into a BuiltBuilding in
 * tiles, with a hanging sign for the protocol's logo and the Chronicle bell's
 * pivot, exactly like BuildingFactory's.
 */

import * as THREE from 'three';
import type { BuildingStyle, Style } from '../../../assets/theme.js';
import { hashString } from '../../../util/rng.js';
import { styleFor } from '../../buildings.js';
import type { BuildingFactory, BuildingSpec, BuiltBuilding } from '../buildingFactory.js';
import type { MaterialLibrary } from './materials.js';
import { Mason, MEDIEVAL, METRES_PER_TILE, roofTint, WASHES, type Ctx, type RecipeSet } from './medieval.js';
import { MODERN } from './modern.js';
import { SCIFI } from './scifi.js';

const SETS: Record<Style, RecipeSet> = { medieval: MEDIEVAL, modern: MODERN, scifi: SCIFI };

export class GrammarBuilder {
  readonly lib: MaterialLibrary;
  readonly #factory: BuildingFactory;
  readonly #emblems = new Map<string, THREE.Material>();
  readonly #style: BuildingStyle;
  /** Triangles in the last building built (the sandbox's perf panel). */
  lastTriangles = 0;

  constructor(lib: MaterialLibrary, factory: BuildingFactory, style: BuildingStyle = { style: 'medieval' }) {
    this.lib = lib;
    this.#factory = factory;
    this.#style = style;
  }

  build(spec: BuildingSpec): BuiltBuilding {
    const set = SETS[this.#style.style];
    const seed = hashString(`${spec.kind}|${spec.tier}|${spec.roof ?? ''}`);
    const washes = this.#style.washes ?? WASHES;
    const m = new Mason(seed);
    const ctx: Ctx = {
      m,
      roof: roofTint(spec.roof ?? '#a0522d', this.#style.brandRoofs ?? 1),
      bannerRoof: roofTint(spec.banner ?? '#b03030', this.#style.brandRoofs ?? 1),
      banner: spec.banner ?? '#b03030',
      tier: spec.tier,
      wash: washes[seed % washes.length]!,
      W: (spec.w - 0.5) * METRES_PER_TILE,
      D: (spec.h - 0.5) * METRES_PER_TILE,
    };
    const recipe = spec.kind === 'home' ? set.home : set.recipes[spec.kind];
    const made = recipe ? recipe(ctx) : set.recipes.names!(ctx);
    this.lastTriangles = m.w.triangles;

    const inner = m.w.build(this.lib);
    inner.scale.setScalar(1 / METRES_PER_TILE);
    if (made.bell) inner.add(made.bell);
    const group = new THREE.Group();
    group.add(inner);

    const out: BuiltBuilding = { group, top: made.top / METRES_PER_TILE };
    if (made.bell) out.bell = made.bell;
    if (m.smoke.length > 0) out.smoke = m.smoke.map((e) => ({ x: e.at[0] / METRES_PER_TILE, y: e.at[1] / METRES_PER_TILE, z: e.at[2] / METRES_PER_TILE, color: e.color }));
    if (made.sign && spec.kind !== 'home' && spec.kind !== 'tower') {
      // a hanging sign on a bracket, the emblem painted on both sides
      const [sx, sy, sz] = made.sign;
      const board = new THREE.Group();
      board.position.set(sx / METRES_PER_TILE, sy / METRES_PER_TILE, sz / METRES_PER_TILE);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), this.lib.get('iron'));
      arm.position.set(0, 0.27, -0.2);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.42), this.lib.get('timber'));
      plank.castShadow = true;
      board.add(arm, plank);
      const emblem = this.#emblem(spec);
      for (const side of [-1, 1]) {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), emblem);
        face.position.x = side * 0.022;
        face.rotation.y = (side * Math.PI) / 2;
        board.add(face);
      }
      group.add(board);
      if (spec.iconUrl) out.sign = { x: board.position.x, y: board.position.y, z: board.position.z + 0.25, url: spec.iconUrl };
    }
    return out;
  }

  #emblem(spec: BuildingSpec): THREE.Material {
    const st = styleFor(spec.kind, spec.tier);
    let mat = this.#emblems.get(st.emblem);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ map: this.#factory.emblemTexture(st), roughness: 0.8 });
      this.#emblems.set(st.emblem, mat);
    }
    return mat;
  }
}
