/**
 * The river east of the town and the pond it runs into, made in code rather
 * than laid from straight tiles: a meandering stream from the hills that
 * widens as it goes and flows into a pond of a natural, uneven round.
 *
 * Looks (as stylised rivers do in town-building games): deep water in the
 * middle, light shallows and a soft foam line at the edges, a strip of sand
 * and pebbles between the water and the grass, flecks of light drifting
 * downstream to show it flows. The path is pure (planned with the town, so a
 * bridge can sit on it); the meshes are built from it by RiverView.
 */

import * as THREE from 'three';

export interface RiverPlan {
  /** The stream's middle, from its source on into the pond (its last metres under the pond's water), every metre or so; and its width there (m). */
  path: { x: number; z: number; width: number }[];
  /** Where on the path its middle crosses the pond's shore (an index). */
  rim: number;
  /** The pond: its middle, its two radii, and how its shore wobbles (a few harmonics, deterministic). */
  pond: { x: number; z: number; rx: number; rz: number };
  /** Where a bridge crosses (its middle and its turn: the deck spans the stream). */
  bridge: { x: number; z: number; rot: number };
}

/** The stream's width at its source and where it meets the pond (m), and how far it swings to each side. */
const WIDTH_SOURCE = 1.3;
const WIDTH_MOUTH = 5.6;
const SWING = 8;
/** The mouth's funnel: over its last this many metres the stream widens, to this many times its width at the shore. */
const FLARE = 14;
const FLARE_WIDEN = 0.9;
/** The meander's turns: every this many metres down the valley the stream swings the other way. */
const TURN = 19;

/** How the pond's shore wobbles at angle `a` (a factor on its radii), so it isn't an ellipse. Pure. */
function wobble(a: number): number {
  return 1 + 0.08 * Math.sin(3 * a + 0.6) + 0.05 * Math.sin(5 * a + 2.1);
}

/** A point on a closed pond's shore at angle `a`. Pure. */
export function pondShore(pond: RiverPlan['pond'], a: number): { x: number; z: number } {
  const w = wobble(a);
  return { x: pond.x + Math.cos(a) * pond.rx * w, z: pond.z + Math.sin(a) * pond.rz * w };
}

/** How far a point is from the pond's middle, as a share of the way to its shore in that direction (1: on the shore). Pure. */
export function pondReach(pond: RiverPlan['pond'], p: { x: number; z: number }): number {
  const nx = (p.x - pond.x) / pond.rx;
  const nz = (p.z - pond.z) / pond.rz;
  return Math.hypot(nx, nz) / wobble(Math.atan2(nz, nx));
}

/**
 * The river from `x` (the valley's line) and `fromZ` (its source) down to a
 * pond whose middle is at `pondZ`. Meanders by fixed swings (the same every
 * time), widens towards the mouth, and ends where it meets the pond's shore.
 * `bridgeZ`: about where the bridge should cross. Pure.
 */
export function planRiver(x: number, fromZ: number, pondZ: number, bridgeZ: number): RiverPlan {
  const pond = { x: x + 3, z: pondZ, rx: 9.5, rz: 7 };
  // control points down the valley, swinging left and right (calmer near the source and the pond)
  const into = pondZ - pond.rz * 0.25; // well inside the pond: its last metres run on under the pond's water
  const stops = Math.max(3, Math.round((into - fromZ) / TURN));
  const controls: THREE.Vector3[] = [];
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const swing = i === 0 || i === stops ? 0 : (i % 2 ? 1 : -1) * SWING * (0.6 + 0.4 * Math.sin(i * 1.7));
    controls.push(new THREE.Vector3(x + swing + (pond.x - x) * t * t, 0, fromZ + (into - fromZ) * t));
  }
  const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
  const length = curve.getLength();
  const n = Math.max(8, Math.round(length));
  const path: RiverPlan['path'] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const t = i / n;
    path.push({ x: round(p.x), z: round(p.z), width: round(WIDTH_SOURCE + (WIDTH_MOUTH - WIDTH_SOURCE) * t * t) });
  }
  // where it crosses the shore, and on past it to halfway in (under the pond's water: no end shows)
  const rim = Math.max(1, path.findIndex((p) => pondReach(pond, p) < 1));
  const deep = path.findIndex((p) => pondReach(pond, p) < 0.5);
  const stream = deep > rim ? path.slice(0, deep + 1) : path;
  // the mouth opens like a funnel: over the metres before the shore the stream widens, smoothly, so its banks curve out into it
  const atRim = stream[rim]!.width;
  for (let i = 0; i < stream.length; i++) {
    const s = Math.min(1, 1 - (rim - i) / FLARE);
    if (s > 0) stream[i] = { ...stream[i]!, width: round((i < rim ? stream[i]!.width : atRim) * (1 + FLARE_WIDEN * s * s * (3 - 2 * s))) };
  }
  // the bridge: on the stream where it is nearest bridgeZ, across it
  let at = 1;
  for (let i = 1; i < stream.length - 1; i++) if (Math.abs(stream[i]!.z - bridgeZ) < Math.abs(stream[at]!.z - bridgeZ)) at = i;
  const a = stream[at - 1]!;
  const b = stream[at + 1]!;
  const bridge = { x: stream[at]!.x, z: stream[at]!.z, rot: round(Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2) };
  return { path: stream, rim, pond, bridge };
}

/** Colours: deep water, shallows, the foam line, wet and dry sand, pebbles, and the grass the shore fades into. */
const DEEP = new THREE.Color('#2f6fae');
const SHALLOW = new THREE.Color('#5ea9d8');
const FOAM = new THREE.Color('#a8d4ea');
const WET_SAND = new THREE.Color('#b9a57c');
const SAND = new THREE.Color('#d6c398');
const GRASS = new THREE.Color('#6f9a45');
/** Heights: the water's surface, the shore's crest, its outer edge (just over the ground). */
const WATER_Y = 0.03;
const SHORE_Y = 0.07;
const EDGE_Y = 0.01;
/** The sand bed under the pond's rim: its height (under the shores' outer edges) and how far past the water it reaches (m). */
const BED_Y = 0.005;
const BED_OUT = 2.6;
/** The shore's strip: sand this wide beyond the water, then this much fading into the grass. */
const SAND_W = 1.1;
const FADE_W = 0.8;

/**
 * The river's and the pond's meshes, and the flecks drifting down the stream
 * (`update` each frame). Everything is its own (geometry, materials), freed
 * with `dispose`.
 */
export class RiverView {
  readonly object = new THREE.Group();
  readonly #plan: RiverPlan;
  readonly #owned: { dispose(): void }[] = [];
  readonly #flecks: THREE.InstancedMesh;
  readonly #fleckState: { s: number; across: number; speed: number }[] = [];
  readonly #length: number;
  readonly #at: { x: number; z: number; dx: number; dz: number; width: number }[] = [];
  readonly #scratch = new THREE.Object3D();
  /** Where each bank meets the pond's shore: the last row of its own shore, and the angle on the pond's round it meets it at. */
  #banks: { left: { row: number; angle: number }; right: { row: number; angle: number } } = { left: { row: 0, angle: 0 }, right: { row: 0, angle: 0 } };

  constructor(plan: RiverPlan) {
    this.#plan = plan;
    this.object.name = 'river';
    const water = this.#material({ vertexColors: true, roughness: 0.25, metalness: 0 });
    const shore = this.#material({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // the stream: a ribbon, five vertices across (edge, shallow, middle, shallow, edge); the shore either side
    const rows = this.#rows();
    this.#length = plan.rim;
    // each bank runs until it reaches the pond's shore (the pond's own shore takes over there)
    this.#banks = { left: this.#bankEnd(rows, 1), right: this.#bankEnd(rows, -1) };
    this.object.add(this.#mesh(this.#streamGeometry(rows), water), this.#mesh(this.#shoreGeometry(rows.slice(0, this.#banks.left.row + 1), 1), shore), this.#mesh(this.#shoreGeometry(rows.slice(0, this.#banks.right.row + 1), -1), shore));
    // the pond, and its shore round all but the stream's mouth
    this.object.add(this.#mesh(this.#pondGeometry(), water), this.#mesh(this.#pondShoreGeometry(), shore), this.#mesh(this.#sandBed(), shore));
    this.object.add(this.#pebbles(rows));
    // flecks of light drifting downstream
    const fleck = new THREE.BoxGeometry(0.55, 0.012, 0.07);
    this.#owned.push(fleck);
    this.#flecks = new THREE.InstancedMesh(fleck, this.#material({ color: 0xeaf6fb, roughness: 0.4, emissive: 0x9cc8e0, emissiveIntensity: 0.25 }), FLECKS);
    this.#flecks.frustumCulled = false;
    for (let i = 0; i < FLECKS; i++) this.#fleckState.push({ s: (i / FLECKS) * this.#length, across: ((i * 0.618) % 1) * 0.7 - 0.35, speed: 1.1 + ((i * 0.37) % 1) * 0.6 });
    this.object.add(this.#flecks);
    this.update(0);
    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
  }

  /** The flecks drift down the stream, and come back at its source. */
  update(dt: number): void {
    for (let i = 0; i < this.#fleckState.length; i++) {
      const f = this.#fleckState[i]!;
      f.s = (f.s + f.speed * dt) % this.#length;
      const k = Math.min(this.#at.length - 1, Math.floor(f.s));
      const r = this.#at[k]!;
      const off = f.across * r.width;
      this.#scratch.position.set(r.x - r.dz * off, WATER_Y + 0.008, r.z + r.dx * off);
      this.#scratch.rotation.set(0, Math.atan2(r.dx, r.dz) + Math.PI / 2, 0);
      // grow in at the source, shrink away at the mouth
      const life = Math.min(1, f.s / 4, (this.#length - f.s) / 4);
      this.#scratch.scale.setScalar(Math.max(0.001, life));
      this.#scratch.updateMatrix();
      this.#flecks.setMatrixAt(i, this.#scratch.matrix);
    }
    this.#flecks.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const o of this.#owned) o.dispose();
  }

  /** Each point down the stream with its direction (unit) and width. */
  #rows(): { x: number; z: number; dx: number; dz: number; width: number }[] {
    const p = this.#plan.path;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)]!;
      const b = p[Math.min(p.length - 1, i + 1)]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      this.#at.push({ x: p[i]!.x, z: p[i]!.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, width: p[i]!.width });
    }
    return this.#at;
  }

  #streamGeometry(rows: readonly { x: number; z: number; dx: number; dz: number; width: number }[]): THREE.BufferGeometry {
    const across = [-0.5, -0.4, 0, 0.4, 0.5];
    const tone = [FOAM, SHALLOW, DEEP, SHALLOW, FOAM];
    const pos: number[] = [];
    const col: number[] = [];
    rows.forEach((r, i) => {
      // the funnel into the pond: its edges' foam fades into the pond's shallows, and its middle lightens to meet them
      const into = Math.max(0, 1 - (rows.length - 1 - i) / FLARE);
      // the first stretch from the spring: rapids, white water fading into the stream's blue
      const rapids = Math.max(0, 1 - i / RAPIDS) * (0.55 + 0.45 * Math.sin(i * 1.9) ** 2);
      across.forEach((f, j) => {
        const off = f * r.width;
        pos.push(r.x - r.dz * off, WATER_Y, r.z + r.dx * off);
        const base = tone[j]!.clone();
        if (tone[j] === FOAM) base.lerp(SHALLOW, into);
        else if (tone[j] === DEEP) base.lerp(SHALLOW, into * 0.35);
        const c = base.lerp(FOAM, rapids);
        col.push(c.r, c.g, c.b);
      });
    });
    return this.#strip(pos, col, rows.length, across.length);
  }

  /** The shore on one side (`side` 1 left, −1 right of the flow): the foam's edge, wet sand, the crest, dry sand, fading into the grass. */
  #shoreGeometry(rows: readonly { x: number; z: number; dx: number; dz: number; width: number }[], side: 1 | -1): THREE.BufferGeometry {
    const ring = [
      { out: -0.05, y: WATER_Y + 0.004, c: WET_SAND },
      { out: 0.35, y: SHORE_Y, c: WET_SAND },
      { out: SAND_W, y: SHORE_Y - 0.01, c: SAND },
      { out: SAND_W + FADE_W, y: EDGE_Y, c: GRASS },
    ];
    const pos: number[] = [];
    const col: number[] = [];
    for (const r of rows) {
      for (const k of ring) {
        const off = side * (r.width / 2 + k.out);
        pos.push(r.x - r.dz * off, k.y, r.z + r.dx * off);
        col.push(k.c.r, k.c.g, k.c.b);
      }
    }
    return this.#strip(pos, col, rows.length, ring.length, side === -1);
  }

  /** The pond's water: a fan from its middle, deep there and shallow, then foam, at its shore. */
  #pondGeometry(): THREE.BufferGeometry {
    const pond = this.#plan.pond;
    // a hair over the stream, which runs a little way under its edge at the mouth
    const y = WATER_Y + 0.003;
    const mouth = this.#mouth();
    const pos: number[] = [pond.x, y, pond.z];
    const col: number[] = [DEEP.r, DEEP.g, DEEP.b];
    const index: number[] = [];
    // the shallows near the shore, a thin foam line at it
    const rings = [
      { f: 0.82, c: SHALLOW },
      { f: 1, c: FOAM },
    ];
    for (let i = 0; i < POND_SIDES; i++) {
      const a = (i / POND_SIDES) * Math.PI * 2;
      const edge = pondShore(pond, a);
      // no foam line across the stream's mouth: the water runs on
      const into = angleBetween(a, mouth.from);
      const atMouth = (into >= -0.08 && into <= mouth.span + 0.08) || (into + Math.PI * 2 >= -0.08 && into + Math.PI * 2 <= mouth.span + 0.08);
      for (const r of rings) {
        pos.push(pond.x + (edge.x - pond.x) * r.f, y, pond.z + (edge.z - pond.z) * r.f);
        const c = atMouth ? SHALLOW : r.c;
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < POND_SIDES; i++) {
      const j = (i + 1) % POND_SIDES;
      const a0 = 1 + i * 2;
      const b0 = 1 + j * 2;
      index.push(0, b0, a0, a0, b0, b0 + 1, a0, b0 + 1, a0 + 1);
    }
    return this.#geometry(pos, col, index);
  }

  /** The pond's shore, round all of it but where the stream comes in. */
  #pondShoreGeometry(): THREE.BufferGeometry {
    const pond = this.#plan.pond;
    const mouth = this.#mouth();
    const ring = [
      { out: -0.05, y: WATER_Y + 0.004, c: WET_SAND },
      { out: 0.35, y: SHORE_Y, c: WET_SAND },
      { out: SAND_W + 0.3, y: SHORE_Y - 0.01, c: SAND },
      { out: SAND_W + 0.3 + FADE_W, y: EDGE_Y, c: GRASS },
    ];
    const pos: number[] = [];
    const col: number[] = [];
    let rows = 0;
    for (let i = 0; i <= POND_SIDES; i++) {
      // round from the left bank the long way to the right bank (all but the mouth)
      const a = mouth.from + mouth.span + (i / POND_SIDES) * (Math.PI * 2 - mouth.span);
      const edge = pondShore(pond, a);
      const dx = edge.x - pond.x;
      const dz = edge.z - pond.z;
      const len = Math.hypot(dx, dz) || 1;
      for (const k of ring) {
        pos.push(edge.x + (dx / len) * k.out, k.y, edge.z + (dz / len) * k.out);
        col.push(k.c.r, k.c.g, k.c.b);
      }
      rows++;
    }
    return this.#strip(pos, col, rows, ring.length);
  }

  /**
   * A bed of sand under the pond's rim, a little wider than its water: it fills
   * where the stream's banks and the pond's shore meet at the mouth (under both,
   * just over the grass).
   */
  #sandBed(): THREE.BufferGeometry {
    const pond = this.#plan.pond;
    const pos: number[] = [pond.x, BED_Y, pond.z];
    const col: number[] = [SAND.r, SAND.g, SAND.b];
    const index: number[] = [];
    for (let i = 0; i < POND_SIDES; i++) {
      const a = (i / POND_SIDES) * Math.PI * 2;
      const edge = pondShore(pond, a);
      const dx = edge.x - pond.x;
      const dz = edge.z - pond.z;
      const len = Math.hypot(dx, dz) || 1;
      pos.push(edge.x + (dx / len) * BED_OUT, BED_Y, edge.z + (dz / len) * BED_OUT);
      col.push(SAND.r, SAND.g, SAND.b);
      index.push(0, 1 + ((i + 1) % POND_SIDES), 1 + i);
    }
    return this.#geometry(pos, col, index);
  }

  /** Where a bank (`side` 1 left, −1 right of the flow) meets the pond's shore: its last row outside it, and that point's angle on the pond. */
  #bankEnd(rows: readonly { x: number; z: number; dx: number; dz: number; width: number }[], side: 1 | -1): { row: number; angle: number } {
    const pond = this.#plan.pond;
    const bank = (r: (typeof rows)[number]) => ({ x: r.x - r.dz * side * (r.width / 2), z: r.z + r.dx * side * (r.width / 2) });
    let row = rows.findIndex((r) => pondReach(pond, bank(r)) < 1) - 1;
    if (row < 0) row = rows.length - 1;
    const b = bank(rows[Math.min(rows.length - 1, row + 1)]!);
    return { row, angle: Math.atan2((b.z - pond.z) / pond.rz, (b.x - pond.x) / pond.rx) };
  }

  /** The mouth on the pond's round: from the right bank's angle to the left's, the short way (through where the stream comes in). */
  #mouth(): { from: number; span: number } {
    const a = this.#banks.right.angle;
    const b = this.#banks.left.angle;
    const span = angleBetween(b, a);
    return span >= 0 ? { from: a, span } : { from: b, span: -span };
  }

  /** Pebbles along the stream's shores and round the pond: small grey stones, one draw. */
  #pebbles(rows: readonly { x: number; z: number; dx: number; dz: number; width: number }[]): THREE.InstancedMesh {
    const stone = new THREE.IcosahedronGeometry(0.16, 0);
    this.#owned.push(stone);
    const spots: THREE.Matrix4[] = [];
    const m = new THREE.Object3D();
    for (let i = 3; i < rows.length; i += 3) {
      const r = rows[i]!;
      for (const side of [1, -1]) {
        // only along its own bank, not under the pond's water
        if (i > (side > 0 ? this.#banks.left.row : this.#banks.right.row)) continue;
        const k = (i * 7 + (side > 0 ? 3 : 0)) % 11;
        if (k > 6) continue;
        const off = side * (r.width / 2 + 0.25 + (k / 6) * 0.7);
        m.position.set(r.x - r.dz * off, SHORE_Y - 0.02, r.z + r.dx * off);
        m.rotation.set(k, k * 1.3, 0);
        m.scale.set(1 + (k % 3) * 0.4, 0.45, 0.9 + (k % 2) * 0.3);
        m.updateMatrix();
        spots.push(m.matrix.clone());
      }
    }
    const mesh = new THREE.InstancedMesh(stone, this.#material({ color: 0x9d9486, roughness: 0.9, flatShading: true }), spots.length);
    spots.forEach((s, i) => mesh.setMatrixAt(i, s));
    mesh.castShadow = true;
    return mesh;
  }

  /** A strip of quads, `rows` × `cols` vertices (row by row); `flip` turns its faces up the other way round. */
  #strip(pos: number[], col: number[], rows: number, cols: number, flip = false): THREE.BufferGeometry {
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + cols;
        if (flip) index.push(a, a + 1, b, a + 1, b + 1, b);
        else index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    return this.#geometry(pos, col, index);
  }

  #geometry(pos: number[], col: number[], index: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    this.#owned.push(g);
    return g;
  }

  #mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
    return new THREE.Mesh(g, m);
  }

  #material(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...p });
    this.#owned.push(m);
    return m;
  }
}

/** The rapids below the spring: white water over the first this many metres. */
const RAPIDS = 24;
/** How many flecks drift down the stream, and how many sides the pond's round has. */
const FLECKS = 46;
const POND_SIDES = 48;

/** The signed angle from b to a, in (−π, π]. */
function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
