/**
 * The look sandbox: one stage to judge a theme's characters, buildings and
 * surroundings side by side — idle/walk/run, day to night, quality tiers and
 * debug views, with a live performance readout. It is also the inspection
 * surface of the visual-validation skill: every control is a URL parameter
 * too, so captures are reproducible:
 *
 *   ?theme=hearth&sky=auto|day|sunset|night|overcast|none&hour=0-24
 *   &quality=low|medium|high&debug=final|nopost|ao|nograde|wireframe|normals
 *   &anim=idle|walk|run&tier=0-6&cam=overview|characters|buildings|closeup&freeze
 */

import * as THREE from 'three';
import { METRES_PER_TILE } from '../render/three/grammar/medieval.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CLASS_LABEL, type HeroClass } from '../domain/model.js';
import { TIER_NAMES, type Tier } from '../domain/tiers.js';
import { brandColor } from '../render/buildings.js';
import { crestColors, hashString, makeRng } from '../util/rng.js';
import { ImagePipeline, type DebugView, type Quality } from '../render/three/pipeline.js';
import { EnvironmentController, SKIES, skyForHour, type SkyId } from '../render/three/environment.js';
import { buildGrassWhere, buildLamps, buildPropMeshes } from '../render/three/scenery.js';
import { wind } from '../render/three/wind.js';
import { nightFactor, setHour } from '../render/overlay.js';
import type { PlacedKind } from '../world/layout.js';
import type { Prop } from '../render/ground.js';
import type { Site } from '../render/three/grammar/surroundings.js';
import { loadImportedPacks } from '../assets/packs.js';
import { assets } from '../assets/registry.js';
import { loadThemes, THEMES, type AnimState, type CharacterLook, type SandboxCharacter, type Theme } from '../render/three/themes.js';
import { setSpriteTint } from '../render/three/spriteCharacters.js';
import { el } from '../ui/dom.js';

type SkyChoice = SkyId | 'auto' | 'none';
type View = DebugView | 'wireframe' | 'normals';
type Cam = 'overview' | 'characters' | 'buildings' | 'closeup';

const ROWS: { z: number; kinds: { kind: PlacedKind; tier?: Tier; label: string; protocol?: string }[] }[] = [
  {
    z: -4,
    kinds: [
      { kind: 'bazaar', label: 'Bazaar (DEX)', protocol: 'uniswap-v3' },
      { kind: 'broker', label: "Broker's Office", protocol: '1inch' },
      { kind: 'bank', label: 'Counting House (lending)', protocol: 'aave-v3' },
      { kind: 'temple', label: 'Temple (staking)', protocol: 'lido' },
      { kind: 'barracks', label: 'Paladin Barracks', protocol: 'eigenlayer' },
      { kind: 'alchemist', label: "Alchemist's Tower", protocol: 'yearn' },
      { kind: 'auction', label: 'Auction House', protocol: 'opensea' },
      { kind: 'harbour', label: 'Harbour (bridge)', protocol: 'across' },
      { kind: 'council', label: 'Council Hall', protocol: 'governance' },
    ],
  },
  {
    z: -11,
    kinds: [
      { kind: 'names', label: 'Hall of Names', protocol: 'ens' },
      { kind: 'packing', label: 'Packing House', protocol: 'weth' },
      { kind: 'forge', label: 'Forge (mint)', protocol: 'seadrop' },
      { kind: 'herald', label: "Herald's Cart", protocol: 'airdrop' },
      { kind: 'tent', label: 'Mysterious Tent' },
      { kind: 'tower', label: 'Chronicle Tower' },
      { kind: 'guildhall', label: 'Guild Hall' },
      { kind: 'gate', label: 'Town Gate' },
    ],
  },
  {
    z: -18,
    kinds: ([0, 1, 2, 3, 4, 5, 6] as Tier[]).map((t) => ({ kind: 'home' as const, tier: t, label: `Home, ${TIER_NAMES[t]}` })),
  },
];
const SPACING = 4.6;
const CLASSES = Object.keys(CLASS_LABEL) as HeroClass[];
const TRACK = { cx: 0, cz: 6.5, rx: 11, rz: 3.2 };

function param<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(location.search).get(name);
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Distance from a point to an axis-aligned box (0 inside). */
const boxDist = (x: number, z: number, cx: number, cz: number, hw: number, hd: number): number => Math.hypot(Math.max(Math.abs(x - cx) - hw, 0), Math.max(Math.abs(z - cz) - hd, 0));

/** The sandbox as a site for a theme's surroundings: rows of buildings, their streets and the track. */
function sandboxSite(lamps: { x: number; y: number }[]): Site {
  const roads = ROWS.map((r) => ({ cx: 0, cz: r.z + 2.6, hw: (SPACING * r.kinds.length + 4) / 2, hd: 0.7 }));
  const buildings = ROWS.flatMap((r) => r.kinds.map((k, i) => ({ x: (i - (r.kinds.length - 1) / 2) * SPACING, z: r.z, w: 3, d: 3, kind: k.kind })));
  const trackDist = (x: number, z: number): number => Math.max(0, Math.abs(Math.hypot((x - TRACK.cx) / TRACK.rx, (z - TRACK.cz) / TRACK.rz) - 1) - 0.08) * TRACK.rz * 1.6;
  const roadDist = (x: number, z: number): number => Math.min(...roads.map((r) => boxDist(x, z, r.cx, r.cz, r.hw, r.hd)));
  const buildingDist = (x: number, z: number): number => Math.min(...buildings.map((b) => boxDist(x, z, b.x, b.z, b.w / 2, b.d / 2)));
  return {
    flat: { x0: -27, x1: 27, z0: -23, z1: 13 },
    taken: (x, z) => roadDist(x, z) < 0.15 || trackDist(x, z) < 0.1 || buildingDist(x, z) < 0.2,
    wear: (x, z) => Math.max(1 - smoothstep(roadDist(x, z), 0, 0.9), 1 - smoothstep(trackDist(x, z), 0, 0.5), 0.55 * (1 - smoothstep(buildingDist(x, z), 0, 0.6))),
    lamps,
    buildings,
    seed: 5,
  };
}

const smoothstep = (x: number, e0: number, e1: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

class Sandbox {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.3, 400);
  readonly controls: OrbitControls;
  readonly pipeline: ImagePipeline;
  readonly env: EnvironmentController;
  readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  readonly hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 1.0);
  readonly fallbackSky = new THREE.Color('#9fd3f0');

  theme: Theme;
  sky: SkyChoice;
  hour: number;
  view: View;
  anim: AnimState;
  tier: Tier;
  frozen: boolean;

  #stage = new THREE.Group();
  #characters: { char: SandboxCharacter; offset: number; lane: number }[] = [];
  #lamps: ReturnType<typeof buildLamps> | null = null;
  #t = 0;
  #last = performance.now();
  #fps = 0;
  #frames = 0;
  #fpsSince = performance.now();
  #perfEl = el('pre', { class: 'perf' });
  #noteEl = el('div', { class: 'note' });
  #canvas: HTMLCanvasElement;

  constructor(host: HTMLElement) {
    this.#canvas = el('canvas', { class: 'stage' });
    host.append(this.#canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.#canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.theme = THEMES.find((t) => t.id === new URLSearchParams(location.search).get('theme')) ?? THEMES[0]!;
    this.sky = param<SkyChoice>('sky', ['auto', 'day', 'sunset', 'night', 'overcast', 'none'], 'auto');
    this.hour = Number(new URLSearchParams(location.search).get('hour') ?? '12');
    if (!Number.isFinite(this.hour)) this.hour = 12;
    this.view = param<View>('debug', ['final', 'nopost', 'ao', 'nograde', 'wireframe', 'normals'], 'final');
    this.anim = param<AnimState>('anim', ['idle', 'walk', 'run'], 'walk');
    this.tier = Number(param('tier', ['0', '1', '2', '3', '4', '5', '6'], '3')) as Tier;
    this.frozen = new URLSearchParams(location.search).has('freeze');
    const quality = param<Quality>('quality', ['low', 'medium', 'high'], 'medium');

    this.pipeline = new ImagePipeline(this.renderer, this.scene, this.camera, quality);
    this.env = new EnvironmentController(this.renderer, this.scene);
    this.env.onReady = () => this.#applySky();

    this.controls = new OrbitControls(this.camera, this.#canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 30;
    sc.bottom = -30;
    sc.far = 140;
    this.sun.shadow.normalBias = 0.05;
    this.sun.position.set(-26, 40, 22);
    this.sun.target.position.set(0, 0, -6);
    this.scene.add(this.sun, this.sun.target, this.hemi, this.#stage);
    this.scene.fog = new THREE.Fog(this.fallbackSky, 90, 220);

    this.#build();
    this.ready = this.theme.prepare === undefined;
    if (this.theme.prepare) void this.setTheme(this.theme.id);
    this.cameraTo(param<Cam>('cam', ['overview', 'characters', 'buildings', 'closeup'], 'overview'));
    this.#applySky();
  }

  #size = '';

  // --- stage -------------------------------------------------------------------

  #build(): void {
    for (const c of this.#characters) c.char.dispose();
    this.#characters = [];
    this.#stage.clear();
    const t = this.theme;
    // Textured ground: UVs in metres; the material repeats per its texture size.
    const surface = (geo: THREE.BufferGeometry, which: 'grass' | 'road' | 'path', color: string): THREE.Mesh => {
      const material = t.groundMaterial?.(which);
      if (material) {
        const pos = geo.getAttribute('position');
        const uv = geo.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * METRES_PER_TILE, -pos.getZ(i) * METRES_PER_TILE);
        uv.needsUpdate = true;
      }
      return new THREE.Mesh(geo, material ?? new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    };
    const flat = (w: number, d: number, which: 'grass' | 'road' | 'path', x: number, z: number, y = 0.01): THREE.Mesh => {
      const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0, z);
      const m = surface(geo, which, t.ground[which]);
      m.position.y = y;
      m.receiveShadow = true;
      this.#stage.add(m);
      return m;
    };

    // ground, streets in front of each row, the walking track
    if (!t.surroundings) flat(70, 50, 'grass', 0, -5, 0);
    for (const row of ROWS) flat(SPACING * row.kinds.length + 4, 1.4, 'road', 0, row.z + 2.6);
    const track = surface(new THREE.RingGeometry(0.92, 1.08, 64).rotateX(-Math.PI / 2).scale(TRACK.rx, 1, TRACK.rz).translate(TRACK.cx, 0, TRACK.cz), 'path', t.ground.path);
    track.position.y = 0.015;
    track.receiveShadow = true;
    this.#stage.add(track);

    // buildings
    for (const row of ROWS) {
      row.kinds.forEach((k, i) => {
        const x = (i - (row.kinds.length - 1) / 2) * SPACING;
        const built = t.building({
          kind: k.kind,
          w: 3,
          h: 3,
          tier: k.tier ?? 0,
          roof: k.protocol ? brandColor(k.protocol) : '#a0522d',
          banner: crestColors('0xsandbox')[0],
          iconUrl: null,
        });
        built.group.position.set(x, 0, row.z);
        this.#stage.add(built.group);
      });
    }

    const lamps = ROWS.flatMap((r) => [-2, -1, 0, 1, 2].map((i) => ({ x: i * SPACING * 2 + SPACING / 2, y: r.z + 3.6 })));
    if (t.surroundings) {
      // the theme dresses the site: terrain, woods, meadow, props, its own lamps
      const s = t.surroundings(sandboxSite(lamps));
      this.#stage.add(s.group);
      this.#lamps = s.lamps;
    } else this.#meadow(t, lamps);

    // characters: one hero per class at the chosen tier, and some villagers
    const looks: CharacterLook[] = [
      ...CLASSES.map((cls, i) => ({ id: `hero-${cls}`, kind: 'hero' as const, cls, tier: this.tier, crest: crestColors(`0x${cls}`)[0], seed: hashString(cls) + i })),
      ...[0, 1, 2, 3, 4].map((i) => ({ id: `villager-${i}`, kind: 'villager' as const, cls: 'adventurer' as const, tier: 0 as Tier, crest: '#888', seed: 1000 + i * 37 })),
    ];
    looks.forEach((look, i) => {
      const char = t.characters.create(look);
      char.setState(this.anim);
      this.#stage.add(char.object);
      this.#characters.push({ char, offset: (i / looks.length) * Math.PI * 2, lane: i % 2 === 0 ? 0 : 0.25 });
    });
    this.#note();
  }

  /** The baseline scenery: a wood behind the homes, a few trees on the meadow, grass, lamps. */
  #meadow(t: Theme, lamps: { x: number; y: number }[]): void {
    const rng = makeRng(5);
    const props: Prop[] = [];
    for (let i = 0; i < 60; i++) props.push({ x: -30 + rng() * 60, y: -26 + rng() * 4, kind: rng() < 0.5 ? 'pine' : 'tree' });
    for (let i = 0; i < 18; i++) props.push({ x: -30 + rng() * 60, y: 12 + rng() * 6, kind: (['tree', 'bush', 'rock', 'pine'] as const)[Math.floor(rng() * 4)]! });
    for (const o of buildPropMeshes(props, (c) => t.material(c))) this.#stage.add(o);
    const onRoad = (x: number, z: number): boolean => ROWS.some((r) => Math.abs(z - (r.z + 2.6)) < 0.9) || ROWS.some((r) => Math.abs(z - r.z) < 1.8 && Math.abs(x) < (SPACING * r.kinds.length) / 2);
    const onTrack = (x: number, z: number): boolean => Math.abs(Math.hypot((x - TRACK.cx) / TRACK.rx, (z - TRACK.cz) / TRACK.rz) - 1) < 0.12;
    this.#stage.add(buildGrassWhere({ x: -30, y: -24, w: 60, h: 44 }, (x, z) => !onRoad(x, z) && !onTrack(x, z), 4500));
    this.#lamps = buildLamps(lamps);
    this.#stage.add(this.#lamps.group);
  }

  #note(): void {
    const t = this.theme;
    this.#noteEl.replaceChildren(
      el('strong', {}, t.name),
      el('div', {}, t.description),
      el('div', { class: 'muted' }, `Characters: ${t.characters.label}`),
      ...(t.status !== 'ready'
        ? [el('div', { class: 'warn' }, t.status === 'planned' ? 'Planned — shown with the current art until its assets arrive. Needs:' : 'Partly done. Still needs:'), el('ul', {}, ...(t.needs ?? []).map((n) => el('li', {}, n)))]
        : []),
    );
  }

  // --- controls ----------------------------------------------------------------

  async setTheme(id: string): Promise<void> {
    const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
    this.theme = theme;
    if (theme.prepare) {
      this.#noteEl.replaceChildren(el('strong', {}, theme.name), el('div', { class: 'muted' }, 'Loading assets…'));
      try {
        await theme.prepare();
      } catch (error) {
        this.#noteEl.append(el('div', { class: 'warn' }, `Could not load: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (this.theme !== theme) return; // switched away meanwhile
    }
    this.#build();
    this.#applySky();
    this.ready = true;
  }

  /** True once the current theme's assets are loaded and the stage is built (tests wait on it). */
  ready = false;

  setAnim(a: AnimState): void {
    this.anim = a;
    for (const c of this.#characters) c.char.setState(a);
  }

  setTier(t: Tier): void {
    this.tier = t;
    this.#build();
  }

  setView(v: View): void {
    this.view = v;
    this.scene.overrideMaterial = v === 'wireframe' ? new THREE.MeshBasicMaterial({ color: '#2b1d14', wireframe: true }) : v === 'normals' ? new THREE.MeshNormalMaterial() : null;
    this.pipeline.debug = v === 'wireframe' || v === 'normals' ? 'nopost' : v;
  }

  setHourOf(h: number): void {
    this.hour = h;
    this.#applySky();
  }

  setSky(s: SkyChoice): void {
    this.sky = s;
    this.#applySky();
  }

  #applySky(): void {
    setHour(this.hour);
    // by the hour, a theme's daytime sky stands in for plain day (an overcast highland)
    const byHour = skyForHour(this.hour);
    const id: SkyId | null = this.sky === 'none' ? null : this.sky === 'auto' ? (byHour === 'day' ? this.theme.defaultSky : byHour) : this.sky;
    this.env.use(id, this.fallbackSky);
  }

  cameraTo(c: Cam): void {
    const at: Record<Cam, [THREE.Vector3, THREE.Vector3]> = {
      overview: [new THREE.Vector3(18, 34, 34), new THREE.Vector3(0, 0, -6)],
      characters: [new THREE.Vector3(0, 5, 17), new THREE.Vector3(0, 1, 6)],
      buildings: [new THREE.Vector3(6, 9, 8), new THREE.Vector3(0, 1.5, -5)],
      closeup: [new THREE.Vector3(3.5, 2.4, 11.5), new THREE.Vector3(0, 1.1, 8.5)],
    };
    const [pos, target] = at[c];
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  // --- frame -------------------------------------------------------------------

  /** Match the canvas size every frame (layout can change after construction). */
  #resize(): void {
    const w = this.#canvas.clientWidth;
    const h = this.#canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const key = `${w}x${h}@${dpr}`;
    if (w === 0 || h === 0 || key === this.#size) return;
    this.#size = key;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h, dpr);
  }

  frame(): void {
    this.#resize();
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;
    // frames actually drawn per second (not 1/dt, which a clamped dt distorts)
    this.#frames++;
    if (now - this.#fpsSince >= 1000) {
      this.#fps = (this.#frames * 1000) / (now - this.#fpsSince);
      this.#frames = 0;
      this.#fpsSince = now;
    }
    if (!this.frozen) this.#t += dt;

    // light by the hour
    const night = nightFactor();
    const envOn = this.env.active;
    this.sun.intensity = 2.4 * (1 - night * 0.85);
    this.sun.color.set(night > 0.5 ? '#9fb0ff' : this.hour < 8.5 || this.hour > 17 ? '#ffc890' : '#fff1d6');
    this.hemi.intensity = (envOn ? 0.25 : 1.0) * (1 - night * 0.6);
    this.theme.windowMaterial.emissiveIntensity = night * 1.7;
    this.theme.fireMaterial.emissiveIntensity = 1.4 + night * 2.2;
    this.#lamps?.setNight(night);
    this.pipeline.setNight(night);
    setSpriteTint(night);
    if (!envOn) this.fallbackSky.set('#9fd3f0').lerp(new THREE.Color('#1c2450'), night);
    wind.uTime.value = this.#t;

    // characters walk (or run) around the track; idle ones stand in a line
    const speed = this.anim === 'run' ? 3.2 : this.anim === 'walk' ? 1.4 : 0;
    const perimeter = Math.PI * (3 * (TRACK.rx + TRACK.rz) - Math.sqrt((3 * TRACK.rx + TRACK.rz) * (TRACK.rx + 3 * TRACK.rz)));
    const n = this.#characters.length;
    this.#characters.forEach((c, i) => {
      if (speed === 0) {
        c.char.object.position.set((i - (n - 1) / 2) * 1.7, 0, 9);
        c.char.update(dt, 0, 0, this.camera);
        return;
      }
      const a = c.offset + (this.#t * speed * Math.PI * 2) / perimeter;
      const rx = TRACK.rx + c.lane;
      const rz = TRACK.rz + c.lane;
      c.char.object.position.set(TRACK.cx + Math.cos(a) * rx, 0, TRACK.cz + Math.sin(a) * rz);
      const heading = Math.atan2(Math.cos(a) * rz, -Math.sin(a) * rx);
      c.char.update(this.frozen ? 0 : dt, speed, heading, this.camera);
    });

    this.controls.update();
    this.renderer.info.reset();
    this.pipeline.render();
    this.#perf();
  }

  #perf(): void {
    const i = this.renderer.info;
    this.#perfEl.textContent = [
      `${this.#fps.toFixed(1)} fps`,
      `draw calls  ${i.render.calls}`,
      `triangles   ${i.render.triangles.toLocaleString('en-US')}`,
      `geometries  ${i.memory.geometries}`,
      `textures    ${i.memory.textures}`,
      `programs    ${i.programs?.length ?? 0}`,
      `sky         ${this.env.current ?? 'none'}`,
    ].join('\n');
  }

  // --- panel -------------------------------------------------------------------

  panel(): HTMLElement {
    const select = <T extends string>(label: string, value: T, options: [T, string][], on: (v: T) => void, disabled: (v: T) => boolean = () => false): HTMLElement => {
      const s = el('select', { 'aria-label': label });
      for (const [v, text] of options) {
        const o = el('option', { value: v }, text);
        if (disabled(v)) o.disabled = true;
        s.append(o);
      }
      s.value = value;
      s.onchange = () => on(s.value as T);
      return el('label', { class: 'row' }, el('span', {}, label), s);
    };
    const hour = el('input', { type: 'range', min: '0', max: '24', step: '0.25', value: String(this.hour), 'aria-label': 'Hour' });
    const hourOut = el('span', { class: 'mono' }, `${this.hour.toFixed(2)}h`);
    hour.oninput = () => {
      this.setHourOf(Number(hour.value));
      hourOut.textContent = `${Number(hour.value).toFixed(2)}h`;
    };
    const cams = el('div', { class: 'cams' }, ...(['overview', 'characters', 'buildings', 'closeup'] as Cam[]).map((c) => {
      const b = el('button', { class: 'btn' }, c);
      b.onclick = () => this.cameraTo(c);
      return b;
    }));
    return el(
      'aside',
      { class: 'panel' },
      el('h1', {}, 'Look sandbox'),
      select('Theme', this.theme.id, THEMES.map((t) => [t.id, t.name] as [string, string]), (v) => void this.setTheme(v)),
      this.#noteEl,
      el('h2', {}, 'Characters'),
      select<AnimState>('Animation', this.anim, [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run']], (v) => this.setAnim(v)),
      select('Hero tier', String(this.tier), ([0, 1, 2, 3, 4, 5, 6] as Tier[]).map((t) => [String(t), `${t} · ${TIER_NAMES[t]}`] as [string, string]), (v) => this.setTier(Number(v) as Tier)),
      el('h2', {}, 'Light'),
      select<SkyChoice>('Sky', this.sky, [['auto', 'By the hour'], ...(Object.keys(SKIES) as SkyId[]).map((k) => [k, SKIES[k].label] as [SkyChoice, string]), ['none', 'None (flat colour)']], (v) => this.setSky(v)),
      el('label', { class: 'row' }, el('span', {}, 'Hour'), hour, hourOut),
      el('h2', {}, 'Rendering'),
      select<Quality>('Quality', this.pipeline.quality, [['low', 'Low (no post)'], ['medium', 'Medium (bloom)'], ['high', 'High (+ AO)']], (v) => {
      this.pipeline.setQuality(v);
      this.#size = ''; // the new pipeline needs its size
    }),
      select<View>('View', this.view, [['final', 'Final'], ['nopost', 'No post'], ['ao', 'AO only'], ['nograde', 'No grade'], ['wireframe', 'Wireframe'], ['normals', 'Normals']], (v) => this.setView(v)),
      el('h2', {}, 'Camera'),
      cams,
      el('h2', {}, 'Performance'),
      this.#perfEl,
    );
  }
}

const host = document.querySelector<HTMLDivElement>('#sandbox');
if (!host) throw new Error('#sandbox missing');
const world = el('main', { class: 'world' });
host.append(world);
// Theme bundles first (bundled ones, and packs imported in the game's Looks panel).
await loadImportedPacks().catch(() => undefined);
await loadThemes([...assets.packs.values()]);
const sandbox = new Sandbox(world);
// For tests and debugging in the console.
(window as unknown as { sandbox: Sandbox }).sandbox = sandbox;
host.prepend(sandbox.panel());
sandbox.setView(sandbox.view);
const loop = (): void => {
  sandbox.frame();
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
