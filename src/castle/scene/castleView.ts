/**
 * The castle and town in 3D: the plan (plan.ts) turned into models, with the
 * standin where a model is missing, and the guild's transactions played out as
 * couriers' errands (courier.ts): the drawbridge lowers, a courier pays at the
 * barrier, walks to a protocol's door, and the building's person comes out to
 * take the goods (or hand them over, for what arrives). Several couriers can
 * be out at once; new transactions jump the queue; when the queue is empty the
 * recent ones play again. The bell rings for each block. Drag to pan, pinch or
 * wheel to zoom, tap a building to select it; twist two fingers (or right-drag,
 * or Q/E and R/F, or the buttons in the corner) to turn and tilt the view.
 * Renders only while on the page.
 */

import * as THREE from 'three';
import { Figure } from './figure.js';
import { Life, ROLE, type Person } from './life.js';
import { Exchange } from './exchange.js';
import type { Goods } from '../../domain/model.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SIZE_CLASSES, assetPath, brandColor, findAsset, sizeClassOf, tierColor } from '../assets/manifest.js';
import { ModelLibrary, disposeTree, type Loaded } from '../assets/models.js';
import { artTheme, loadThemeImage, themeFileUrl, type CastleTheme } from '../assets/theme.js';
import { crestColors } from '../../util/rng.js';
import { DEFAULT_TIMING, buildCourierScript, courierAt, type CourierScript, type CourierState, type NpcClip } from './courier.js';
import { planCastle, routeBetweenWallets, routeTo, type BuildingPlacement, type CastleLayout, type CastlePlan, type Placement, type WalletPlacement } from './plan.js';
import type { CastleWorld, Errand } from '../world/world.js';
import { lightAt, type Weather } from '../world/sky.js';
import { logoPath } from '../world/logos.js';
import {
  ORBIT_RADIUS,
  PITCH_DEFAULT,
  YAW_DEFAULT,
  clampPitch,
  dampAngles,
  isBehind,
  nearestYaw,
  offsetFor,
  panDelta,
  standBack,
  wrapAngle,
  SCENE_REACH,
  type CameraAngles,
} from './cameraRig.js';

export type CastleFocus = 'castle' | 'town';

export interface CastleViewOptions {
  world: CastleWorld;
  focus: CastleFocus;
  /** The theme the models come from (loadCastleTheme). */
  theme: Promise<CastleTheme> | CastleTheme;
  /** The castle's layout, as the theme has it (CastleTheme.castleLayout; 1 when absent). */
  layout?: CastleLayout;
  /** A building was tapped. */
  onSelect?: (building: BuildingPlacement) => void;
  /** A wallet's tower or hall was tapped (its index in the guild's wallets). */
  onSelectWallet?: (index: number) => void;
  /** The keep was tapped: the guild as a whole. */
  onSelectKeep?: () => void;
  /** A coin of a stream landed (its number, of how many; whether the guild receives), and an NFT set out or landed: for the sounds. */
  onCoin?: (index: number, of: number, incoming: boolean) => void;
  onNft?: (landed: boolean) => void;
  /** Something was tapped (for the sound): a building or castle piece, a person or animal, a courier. */
  onTapped?: (what: 'building' | 'person' | 'courier') => void;
  /** What a townsperson says now (the chain's chatter, world/chatter.ts); none: they keep quiet. */
  chatter?: (who: Person) => string;
  /** A townsperson tapped: who they are and what they just said. */
  onSelectPerson?: (who: Person, line: string | null) => void;
  /** A courier was tapped: its errand (the transaction). */
  onSelectErrand?: (errand: Errand) => void;
  /** A courier pays the toll at the barrier (for the coins' sound). */
  onToll?: (errand: Errand) => void;
  /** A failed transaction's courier is turned back at the barrier. */
  onRefused?: (errand: Errand) => void;
  /** The hour of the day to light the scene by (default: the player's local time, followed as it passes). */
  hour?: number;
  /** The market's weather to start with. */
  weather?: Weather;
  /**
   * Rendering quality: 'high' (sun shadows, the environment light, the full pixel ratio), 'low' (none of
   * those), or 'auto' (high, stepping down by itself if this device cannot keep up). Default 'auto'.
   */
  quality?: 'auto' | 'high' | 'low';
  /** The player's own arrangement of the town (build mode): protocol id → plot. */
  arranged?: Record<string, number>;
  /** Every model is placed: the scene is ready to look at. */
  onReady?: () => void;
  /** In build mode, a tap on a building (its protocol) or on an empty plot. */
  onArrangeTap?: (tap: { protocolId: string } | { slot: number }) => void;
}

const FOCUS_POINT: Record<CastleFocus, [number, number]> = {
  castle: [0, -7],
  town: [0, 9],
};
/** Metres of the scene visible top to bottom at zoom 1. */
const VIEW_HEIGHT = 26;
/** At zoom 1 at least this many metres show across, so a narrow phone sees the whole castle. */
const VIEW_WIDTH_MIN = 30;
/** Far enough out to see a tall landmark whole. */
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
/** Where the camera may look: the island, the moat and the town, with a margin. */
/** How far back the camera usually stands, in orbit radii (cameraRig.ts); it stands further back when a zoomed-out view needs it. */
const CAMERA_BACK = 4;
/** Turning the view: radians per pixel of a right-drag, and per press of Q/E, R/F and the buttons. */
const TURN_PER_PIXEL = 0.008;
const TILT_PER_PIXEL = 0.006;
const TURN_STEP = Math.PI / 12;
const TILT_STEP = Math.PI / 18;
const TURN_BUTTON = Math.PI / 4;
/** Seconds the bell swings for a block. */
const BELL_RING = 1.5;
/** With no block reported for this long, the bell keeps time by itself (Ethereum's 12 s), so an offline town still rings. */
const BLOCK_SILENCE = 20;
const BLOCK_TIME = 12;
/** Couriers out at once, and seconds between two setting out. */
const MAX_COURIERS = 3;
const COURIER_GAP = 2.5;
/** With nothing new to play, the recent errands play again after this pause; this many of them. */
const REPLAY_PAUSE = 3;
const REPLAY_COUNT = 12;
/** At most this many couriers waiting while the replay timeline feeds them. */
const MAX_QUEUED = 6;
/** The bell's yoke when the tower model has no `hinge` (the delivered tower has it at 9.1 m). */
const BELL_HEIGHT = 9.1;
/** The spec leaves the barrier's height to the game (docs/ASSET_SPEC.md §3.3). */
const BARRIER_HEIGHT = 1;
/** A tap moves less than this many pixels; more is a drag. */
const TAP_SLOP = 6;
/** How far past the castle and the town the view may pan (m, at zoom 1 and below). */
const WORLD_ROAM = 40;
/** Clouds: their models (the theme's, else soft lobes), how high and how fast they drift (m/s). */
const CLOUD_MODELS = ['scenery.cloud.1', 'scenery.cloud.2', 'scenery.cloud.3'];
const CLOUD_HEIGHT = 30;
const SHINE_COLOR = new THREE.Color(0xffd08a);
const GLOOM_COLOR = new THREE.Color(0xc8d0dc);
const CLOUD_WIND = 1.6;
const CLOUD_LOBE = new THREE.IcosahedronGeometry(1, 2);
const CLOUD_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x9fb4c8, emissiveIntensity: 0.25 });
const CLOUD_STORM_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x8a909c, roughness: 1 });
/** Models placed by the hundred and never moved: drawn instanced. */
const INSTANCED = new Set(['town.ground', 'moat.water', 'path.tile.straight']);
/** The ring under what the mouse is over: gold, a little wider than the thing's footprint. */
const HOVER_RING = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
const HOVER_COLOR = 0xffd45a;
/** Following a courier (a replay): the zoom it eases to, and how quickly the view catches up (per second). */
const FOLLOW_ZOOM = 2.2;
const FOLLOW_RATE = 3;
const FOLLOW_ZOOM_TIME = 1.5;
/** How long a follow waits for its courier to set out (s). */
const FOLLOW_WAIT = 40;
/** A speech bubble stays this many seconds; someone in the street speaks up every this many (plus up to 3). */
const BUBBLE_TIME = 4.5;
/** A townsperson of a building with no brand colour wears this. */
const VILLAGER_TINT = '#5a7d9a';
/** A sparkle burst, bigger than life like the coins (×). */
const BURST_SCALE = 3;
/** A carried NFT frame, bigger than life so the picture reads (×, against the courier). */
const CARRY_FRAME_SCALE = 1.4;
const CHATTER_EVERY = 6;
/** A bubble's foot above a person's feet (m). */
const BUBBLE_HEIGHT = 2.1;
/** While following, the player may pan the courier this share of the view's height away from the middle, no further. */
const FOLLOW_SLACK = 0.3;
/** The Chronicle tower turns this see-through while someone is behind it. */
const TOWER_FADED = 0.3;
/** How far behind the tower (on the ground, away from the camera) it can hide someone, and how wide its shadow is. */
const TOWER_HIDES = { depth: 12, halfWidth: 2 };
/** A courier's tap target: a cylinder about its body, never drawn. Shared by every courier of every view, and never freed (it is tiny). */
const HIT_HEIGHT = 2;
const HIT_GEOMETRY = new THREE.CylinderGeometry(0.7, 0.7, HIT_HEIGHT, 8);
const HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
/** Colours for decorations' Tint parts: a fixed one, or the guild's crest (its first wallet's). */
const DECOR_TINT: Record<string, string> = {
  'prop.market.stall': '#8a3b32', // the palette's cloth red (docs/ASSET_SPEC.md §1.2)
  'animal.dog': 'crest',
  'animal.horse': 'crest',
};
/** Build mode's rings: on an empty plot, and under the building chosen to move. Shared by every view (tiny, never freed). */
const RING_GEOMETRY = new THREE.RingGeometry(0.85, 1.05, 32).rotateX(-Math.PI / 2);
const PLOT_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xe7c46b, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
const CHOSEN_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const SWAP_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x6fb8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
/** The tappable disc inside a build-mode ring (barely seen). */
const PAD_GEOMETRY = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const PAD_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
/** Clips a placed model plays on its own, looping (the first one it has). */
const LOOPING_CLIPS = ['idle', 'wave', 'swim'];
/** The clip a building or a person plays once when tapped (docs/STYLEGUIDE_V2.md §8.2). */
const TAP_CLIP = 'tap';
/** A logo plate's ground colour round the logo (docs/STYLEGUIDE_V2.md §8.1), the picture's size, and the margin round the logo. */
const LOGO_PLATE = '#efe3c8';
const LOGO_SIZE = 256;
const LOGO_MARGIN = 0.12;
/** A wallet tower's top, where its flag stands (docs/ASSET_SPEC.md §3.1: 3 m). */
const TOWER_TOP = 3;
/** The refusal seal over the barrier: how high, how big, and its colour when the theme has no picture. */
const REFUSAL_HEIGHT = 2.4;
const REFUSAL_SIZE = 1.1;
const REFUSAL_COLOR = 0xb0473a;
/** The grass round everything: the palette's moss (docs/ASSET_SPEC.md §1.2). */
const LAND_COLOR = 0x5b7a4a;
const LAND_SIZE = 600;
/** 'auto' quality watches this many frames, and steps down when the typical one takes longer than this (s). */
const SPEED_FRAMES = 45;
const SLOW_FRAME = 1 / 25;
/** How strongly the environment reflects (a soft sheen on bevels and roofs). */
const ENVIRONMENT_INTENSITY = 0.45;
/** The sun's direction (towards it), fixed in the world, about 55° up; how far out it stands; how far round the view its shadows reach. */
const SUN_DIRECTION = new THREE.Vector3(0.45, 0.82, 0.35).normalize();
const SUN_DISTANCE = 120;
/** The shadow map's own across and up directions (it looks down the sun's rays, upright). */
const SUN_RIGHT = new THREE.Vector3().crossVectors(SUN_DIRECTION.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
const SUN_UP = new THREE.Vector3().crossVectors(SUN_RIGHT, SUN_DIRECTION.clone().negate()).normalize();
const SHADOW_REACH = 45;
/** The far copies of big buildings: drawn when the shortest of them shows below LOD_FAR_PX, the full ones again above LOD_NEAR_PX. */
const LOD_FAR_PX = 360;
const LOD_NEAR_PX = 420;
/** The path glow: warm lamplight rather than the model's plain white. */
const GLOW_COLOR = 0xffc861;
/** The glow plate is 0.01 m high and the road 0.02 m: lift the plate just above the road. */
const GLOW_LIFT = 0.015;


/** A courier out on an errand. */
interface Run {
  errand: Errand;
  building: BuildingPlacement | null;
  script: CourierScript;
  /** View time it set out. */
  start: number;
  figure: Figure;
  cargo: THREE.Object3D;
  /** Its figure is a standin (no model): its geometry is its own to free. */
  standin: boolean;
  /** It has paid the toll, and been refused (each told once). */
  tolled?: boolean;
  refusedTold?: boolean;
  /** Its goods changed hands at the door; it brought them home. */
  handed?: boolean;
  /** An NFT it carries (a framed picture over its head), when it carries one. */
  frame?: THREE.Object3D | null;
}

export class CastleView {
  readonly element: HTMLElement;
  readonly #canvas = document.createElement('canvas');
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  readonly #focus = new THREE.Vector3();
  readonly #opts: CastleViewOptions;
  #plan: CastlePlan;
  readonly #timer = new THREE.Timer();
  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  readonly #scratch = new THREE.Vector3();
  readonly #figures: Figure[] = [];
  readonly #buildingRoots: THREE.Object3D[] = [];
  /** The castle's wallet towers or halls and the keep (they open sheets). */
  readonly #castleRoots: THREE.Object3D[] = [];
  /** Buildings with a far copy (`….lod1`): which to draw follows how tall they show on screen. */
  readonly #lods: { near: THREE.Object3D; far: THREE.Object3D; height: number }[] = [];
  /** The ring under what the mouse is over, and what that is. */
  readonly #hoverRing = new THREE.Mesh(HOVER_RING, new THREE.MeshBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.9, depthWrite: false }));
  #hovered: THREE.Object3D | null = null;
  /** The mouse's position over the canvas, to look under once a frame (null: not over it, or a touch). */
  #hoverAt: { x: number; y: number } | null = null;
  /** A replayed errand whose courier the camera follows (by key), and its courier once out. */
  #followKey: string | null = null;
  #followRun: Run | null = null;
  /** How far the player has panned away from the followed courier, and how long the follow still eases the zoom (s). */
  readonly #followOffset = new THREE.Vector3();
  #followZoomFor = 0;
  #followWait = 0;
  /** "Following the courier ✕" while it does. */
  readonly #followChip = Object.assign(document.createElement('button'), { className: 'btn follow-chip', type: 'button' });
  /** The weather, and its clouds (their shadows; a few seen at the edges), the area they drift round. */
  #weather: Weather = { rain: 0, gloom: 0, clouds: 0.45, shine: 0.2 };
  readonly #clouds: { obj: THREE.Object3D; speed: number; edge?: boolean; mats: THREE.Material[]; opacity: number }[] = [];
  readonly #cloudMaterials: THREE.Material[] = [];
  #cloudArea = { x0: -60, x1: 60, z0: -60, z1: 60 };
  /** Coins and NFTs changing hands (exchange.ts), and the labels over the scene they show. */
  #exchange: Exchange | null = null;
  readonly #exchangeLabels = el('div', 'exchange-labels');
  /** Birds, grazers, fish, strollers, the toll keeper (life.ts). */
  #life: Life | null = null;
  /** Whether the far copies are drawn now (null: not decided yet). */
  #farNow: boolean | null = null;
  readonly #resize: ResizeObserver;
  readonly #library: ModelLibrary;
  #zoom = 1;
  #bridge: THREE.Object3D | null = null;
  #barrier: THREE.Object3D | null = null;
  #bell: THREE.Object3D | null = null;
  /** Models by asset name (null: none made, the standin shows). */
  readonly #loaded = new Map<string, Loaded | null>();
  /** Errands waiting for a courier; live ones go to the front. */
  #queue: Errand[] = [];
  readonly #runs: Run[] = [];
  /** Each building's person, by protocol id. */
  readonly #npcs = new Map<string, Figure>();
  #lastSpawn = -Infinity;
  #replayAt = 0;
  #autoReplay = true;
  /** When the bell last started ringing, and when a real block last came. */
  #ringAt = -Infinity;
  #blockAt = 0;
  readonly #courierScratch: CourierState[] = [];
  // a cool sky fill with a warm bounce from the ground, and a warm sun that casts shadows (docs/research/LOOK_AND_FEEL.md §10.3)
  readonly #hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a6e4b, 1);
  readonly #sun = new THREE.DirectionalLight(0xffe2b8, 3);
  /** The soft environment reflection that keeps standard materials from looking flat. */
  #environment: THREE.Texture | null = null;
  /** The rendering quality now, and how the first frames went (for 'auto'). */
  #quality: 'high' | 'low' = 'high';
  #frameTimes: number[] = [];
  /** The models' Glow materials (windows, lanterns), brighter at night. */
  readonly #glows = new Set<THREE.MeshStandardMaterial>();
  #lightAt = 0;
  readonly #weatherEl = document.createElement('div');
  /** Painted copies of the models' Tint and Trim materials, one per source material and colour (shared by every piece painted alike). */
  readonly #painted = new Map<string, THREE.Material>();
  /** Each protocol's logo plate material (its logo on the plate), by logo file; null when its picture could not be read. */
  readonly #logos = new Map<string, Promise<THREE.Material | null>>();
  /** Each protocol building's own animation (its idle, its tap), by the building's object. */
  readonly #reactions = new Map<THREE.Object3D, Figure>();
  /** Until when (view time) the sun's shadows are drawn every frame: a building bounces. */
  #shadowsMoveUntil = 0;
  /** The couriers' tap targets. */
  #courierTargets: THREE.Mesh[] = [];
  /** The red seal over the barrier while a failed transaction's courier is turned back. */
  #refusal: THREE.Sprite | null = null;
  /** Everything the town's arrangement places (rebuilt in place by `rearrange`). */
  readonly #layout = new THREE.Group();
  /** Build mode: the rings on empty plots and under the chosen building. */
  readonly #arrangeMarks = new THREE.Group();
  #arranging = false;
  /** Buildings with a looping clip of their own (Curve's water wheel, Pendle's pendulum). */
  readonly #ambient: Figure[] = [];
  #litTiles: THREE.Object3D[] = [];
  #tower: THREE.Object3D | null = null;
  /** The tower's own copies of its materials, so it can fade alone. */
  #towerMaterials: THREE.Material[] = [];
  #towerOpacity = 1;
  #bridgeAngle = -Math.PI / 2; // raised
  /** The drawbridge model's own `lower` clip, when it has one: the bridge is posed along it. */
  #bridgeClip: { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; duration: number } | null = null;
  /** The barrier model's own `lift` clip, when it has one: the arm is posed along it. */
  #barrierClip: { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; duration: number } | null = null;
  #barrierAngle = 0; // down
  #time = 0;
  #ready = false;
  #wasConnected = false;
  #disposed = false;
  /** Pointers down on the canvas, for drag and pinch. */
  readonly #pointers = new Map<number, { x: number; y: number }>();
  /**
   * The gesture under way: how far it has moved (a tap moves less), whether it turns the view (a right-drag),
   * and for two fingers their distance, angle and midpoint the last time they moved.
   */
  #gesture: { moved: number; orbit: boolean; pinch: number; twist: number; midY: number } | null = null;
  /** The camera's angles now, and where they are heading (they follow smoothly). */
  readonly #angles: CameraAngles = { yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT };
  readonly #angleTarget: CameraAngles = { yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT };
  readonly #panScratch = { x: 0, z: 0 };
  readonly #screenScratch = new THREE.Vector3();
  readonly #bubbleScratch = new THREE.Vector3();
  /** Build mode's labels over its rings ("Move here", "Swap with …"). */
  readonly #arrangeLabels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  readonly #arrangeLabelLayer = el('div', 'arrange-labels');
  /** Speech bubbles over the townsfolk's heads. */
  readonly #bubbleLayer = el('div', 'speech-bubbles');
  #bubbles: { el: HTMLElement; obj: THREE.Object3D; until: number }[] = [];
  /** Sparkle bursts playing (`fx.sparkle.burst`'s `pop`), gone when it ends. */
  #bursts: { figure: Figure; until: number }[] = [];
  /** When someone in the street next says something unprompted. */
  #nextChatter = 4;
  readonly #controls = document.createElement('div');

  constructor(opts: CastleViewOptions) {
    this.#opts = opts;
    this.#plan = planCastle(opts.world, opts.arranged, opts.layout ?? 1);
    // the recent errands first, oldest first
    this.#queue = opts.world.errands.slice(-REPLAY_COUNT);
    this.#library = new ModelLibrary(opts.theme);
    const [fx, fz] = FOCUS_POINT[opts.focus];
    // the castle tab looks at the island's middle, a little towards the gate (layout 2's island is deeper)
    const island = this.#plan.island;
    this.#focus.set(fx, 0, opts.focus === 'castle' && this.#plan.layout === 2 ? (island.z0 + island.z1) / 2 + 1.5 : fz);

    this.element = document.createElement('div');
    this.element.className = 'castle-view';
    this.element.append(this.#canvas);
    this.#canvas.style.touchAction = 'none';

    this.#renderer = new THREE.WebGLRenderer({ canvas: this.#canvas, antialias: true });
    this.#quality = opts.quality === 'low' ? 'low' : 'high';
    this.#renderer.setPixelRatio(this.#quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setClearColor(0xbcd3e0, 1);
    // Neutral tone mapping keeps the art's saturated colours as painted (ACES washes them out)
    this.#renderer.toneMapping = THREE.NeutralToneMapping;
    this.#renderer.toneMappingExposure = 1;
    this.#renderer.shadowMap.enabled = this.#quality === 'high';
    this.#renderer.shadowMap.type = THREE.PCFShadowMap;
    // nothing that casts a shadow moves (people do not cast one): the shadows are drawn again only when the
    // camera moves (they follow the view) or the town changes, not every frame
    this.#renderer.shadowMap.autoUpdate = false;
    const pmrem = new THREE.PMREMGenerator(this.#renderer);
    this.#environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.#scene.environment = this.#quality === 'high' ? this.#environment : null;
    this.#scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    this.#hoverRing.visible = false;
    this.#hoverRing.renderOrder = 1;
    this.#scene.add(this.#hemi, this.#layout, this.#arrangeMarks, this.#hoverRing);
    // the sun shines from the same side whichever way the camera turns; its shadows follow the view (#updateCamera)
    this.#sun.castShadow = true;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.#sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    const sc = this.#sun.shadow.camera;
    sc.left = -SHADOW_REACH;
    sc.right = SHADOW_REACH;
    sc.top = SHADOW_REACH;
    sc.bottom = -SHADOW_REACH;
    sc.near = 1;
    sc.far = SUN_DISTANCE * 2;
    this.#sun.shadow.bias = -0.0005;
    this.#sun.shadow.normalBias = 0.02;
    this.#scene.add(this.#sun, this.#sun.target);
    // the weather: a grey veil and rain over the scene (DOM layers: cheap, and no draw calls)
    this.#weatherEl.className = 'weather';
    this.#weatherEl.append(el('div', 'gloom'), el('div', 'rain'));
    void Promise.resolve(opts.theme).then((t) => {
      const spec = findAsset('fx.rain');
      if (spec) this.#weatherEl.style.setProperty('--rain-image', `url("${themeFileUrl(artTheme(t), assetPath(spec))}")`);
    });
    this.#applyLight();
    // The land the island and the town stand on, out past the woods (a hair below the tiles).
    const land = new THREE.Mesh(new THREE.PlaneGeometry(LAND_SIZE, LAND_SIZE), new THREE.MeshStandardMaterial({ color: LAND_COLOR, roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.y = -0.02;
    land.receiveShadow = true;
    this.#scene.add(land);

    // Buttons to turn the view and set it back, for phones (where twisting two fingers is not obvious).
    this.#controls.className = 'camera-controls';
    this.#controls.append(
      this.#cameraButton('camera-left', '⟲', 'Turn the view left', () => this.turn(-TURN_BUTTON)),
      this.#cameraButton('camera-reset', '🧭', 'Reset the view angle', () => this.resetAngle()),
      this.#cameraButton('camera-right', '⟳', 'Turn the view right', () => this.turn(TURN_BUTTON)),
    );
    this.element.append(this.#controls);

    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(this.element);
    this.#fit();
    this.#bindInput();
    void this.#build();
    this.#renderer.setAnimationLoop(this.#tick);
  }

  get plan(): CastlePlan {
    return this.#plan;
  }

  /** True once every model has loaded and been placed. */
  get ready(): boolean {
    return this.#ready;
  }

  /** Test hook: the page coordinates of a protocol's building, to tap it. */
  screenPoint(protocolId: string): { x: number; y: number } | null {
    const b = this.#plan.buildings.find((p) => p.protocol.id === protocolId);
    if (!b) return null;
    const rect = this.#canvas.getBoundingClientRect();
    const toPage = () => ({ x: rect.left + ((this.#scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.#scratch.y) / 2) * rect.height });
    // a point on the screen where a tap meets this building first (a bigger one may stand in front of its middle)
    const root = this.#buildingRoots.find((r) => (r.userData.building as BuildingPlacement).protocol.id === protocolId);
    if (root) {
      for (const fy of [0.3, 0.6, 1.2, 2]) {
        for (const [fx, fz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]] as const) {
          this.#scratch.set(b.x + fx * b.half, fy * b.half, b.z + fz * b.half).project(this.#camera);
          if (Math.abs(this.#scratch.x) > 0.95 || Math.abs(this.#scratch.y) > 0.95) continue;
          this.#pointer.set(this.#scratch.x, this.#scratch.y);
          this.#raycaster.setFromCamera(this.#pointer, this.#camera);
          let o: THREE.Object3D | null = this.#raycaster.intersectObjects(this.#buildingRoots, true)[0]?.object ?? null;
          while (o && !o.userData.building) o = o.parent;
          if (o === root) return toPage();
        }
      }
    }
    this.#scratch.set(b.x, 1, b.z).project(this.#camera);
    return toPage();
  }

  /** Test hook: brings a townsperson out walking to the middle of the view (false: none). */
  focusPerson(): boolean {
    const one = this.#life?.someone(0);
    if (!one) return false;
    one.obj.getWorldPosition(this.#scratch);
    this.focusAt(this.#scratch.x, this.#scratch.z, 2);
    return true;
  }

  /** Test hook: the page coordinates of a townsperson out walking, chest high (null: none, or off the view). */
  personPoint(): { x: number; y: number } | null {
    const one = this.#life?.someone(0);
    if (!one) return null;
    one.obj.getWorldPosition(this.#scratch);
    this.#scratch.y += 1;
    this.#scratch.project(this.#camera);
    if (Math.abs(this.#scratch.x) > 0.9 || Math.abs(this.#scratch.y) > 0.9) return null;
    const rect = this.#canvas.getBoundingClientRect();
    return { x: rect.left + ((this.#scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.#scratch.y) / 2) * rect.height };
  }

  /** Test hook: the page coordinates of the first courier out (null: none out). */
  courierPoint(): { x: number; y: number } | null {
    const run = this.#runs[0];
    if (!run) return null;
    run.figure.object.getWorldPosition(this.#scratch);
    this.#scratch.y += 1;
    this.#scratch.project(this.#camera);
    const rect = this.#canvas.getBoundingClientRect();
    return { x: rect.left + ((this.#scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.#scratch.y) / 2) * rect.height };
  }

  /** Brings a protocol's building to the middle of the view (zoomed to fit it, when `zoom` is given). */
  focusBuilding(protocolId: string, zoom?: number): boolean {
    const b = this.#plan.buildings.find((p) => p.protocol.id === protocolId);
    if (!b) return false;
    this.focusAt(b.x, b.z, zoom);
    return true;
  }

  /** Brings a point on the ground to the middle of the view (and zooms, when `zoom` is given). */
  focusAt(x: number, z: number, zoom?: number): void {
    this.#focus.set(x, 0, z);
    if (zoom !== undefined) this.#zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    this.#updateCamera();
  }

  /** Test hook: which plot each protocol's building stands on. */
  slots(): Record<string, number> {
    return Object.fromEntries(this.#plan.buildings.map((b) => [b.protocol.id, b.slot]));
  }

  /** Test hook: the wallets on show, in their towers' order. */
  walletIds(): string[] {
    return [...this.#opts.world.walletIds];
  }

  /** Test hook: the protocols with a building, nearest the gate first. */
  buildingIds(): string[] {
    return this.#plan.buildings.map((b) => b.protocol.id);
  }

  /** Test hook: what the errands look like now. */
  state(): {
    bridgeAngle: number;
    barrierAngle: number;
    courier: { x: number; z: number } | null;
    couriers: number;
    queued: number;
    zoom: number;
    /** The camera's angles (radians): which way it faces (−π … π) and how far above the horizon it looks down. */
    yaw: number;
    pitch: number;
    ringing: boolean;
    /** The errands of the couriers out and the next one queued. */
    upcoming: string[];
    /** Big buildings with a far copy, and whether the far copies are drawn now. */
    lods: number;
    far: boolean;
  } {
    const c = this.#runs[0]?.figure.object.position;
    return {
      bridgeAngle: this.#bridgeAngle,
      barrierAngle: this.#barrierAngle,
      courier: c ? { x: c.x, z: c.z } : null,
      couriers: this.#runs.length,
      queued: this.#queue.length,
      zoom: this.#zoom,
      yaw: wrapAngle(this.#angles.yaw),
      pitch: this.#angles.pitch,
      ringing: this.#time - this.#ringAt < BELL_RING,
      upcoming: [...this.#runs.map((r) => r.errand.key), ...this.#queue.slice(0, 1).map((e) => e.key)],
      lods: this.#lods.length,
      far: this.#farNow === true,
    };
  }

  /** Turns the view about the point it looks at (radians; positive turns the scene clockwise). The camera follows smoothly. */
  turn(radians: number): void {
    this.#angleTarget.yaw += radians;
  }

  /** Tilts the view (radians; positive looks down more steeply), within the limits. */
  tilt(radians: number): void {
    this.#angleTarget.pitch = clampPitch(this.#angleTarget.pitch + radians);
  }

  /** Back to the usual angle, turning the short way. */
  resetAngle(): void {
    this.#angleTarget.yaw = nearestYaw(this.#angles.yaw, YAW_DEFAULT);
    this.#angleTarget.pitch = PITCH_DEFAULT;
  }

  /**
   * Couriers for these errands. By default they go next, ahead of the rest (new
   * transactions); `inOrder` puts them at the back, in order (the replay
   * timeline), keeping at most MAX_QUEUED waiting (the oldest waiting are
   * dropped: a fast replay must not build an endless backlog).
   */
  enqueue(errands: readonly Errand[], inOrder = false): void {
    if (!inOrder) {
      this.#queue.unshift(...errands);
      return;
    }
    this.#queue.push(...errands);
    if (this.#queue.length > MAX_QUEUED) this.#queue.splice(0, this.#queue.length - MAX_QUEUED);
  }

  /** Forget the couriers waiting to set out (those out finish their errands). */
  clearQueue(): void {
    this.#queue = [];
  }

  /** Whether the recent errands play again when nothing else is waiting (off while the replay timeline drives). */
  setAutoReplay(on: boolean): void {
    this.#autoReplay = on;
    this.#replayAt = 0;
  }

  /** A block was mined: the bell rings. */
  ringBell(): void {
    this.#ringAt = this.#time;
    this.#blockAt = this.#time;
  }

  /** Stops the loop and frees what this view made on the GPU. Runs by itself when the view leaves the page. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#renderer.setAnimationLoop(null);
    this.#resize.disconnect();
    window.removeEventListener('keydown', this.#onKey);
    for (const f of this.#figures) f.dispose();
    for (const f of this.#ambient) f.dispose();
    for (const r of this.#runs) r.figure.dispose();
    this.#life?.dispose();
    this.#exchange?.dispose();
    // Everything shown came from this view's own library (models, standins, the tower's own materials):
    // nothing is shared beyond the view, so all of it goes.
    for (const t of this.#courierTargets) t.removeFromParent(); // shared by every view: kept
    this.#arrangeMarks.clear(); // build mode's rings: shared, kept
    this.#hoverRing.removeFromParent(); // its geometry is shared: kept
    for (const c of this.#clouds) c.obj.removeFromParent(); // their lobes are shared: kept
    for (const m of this.#cloudMaterials) m.dispose();
    this.#hoverRing.material.dispose();
    disposeTree(this.#scene);
    this.#environment?.dispose();
    this.#sun.shadow.map?.dispose();
    this.#refusal?.material.map?.dispose();
    this.#refusal?.material.dispose();
    this.#scene.clear();
    void this.#library.dispose();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
  }

  async #build(): Promise<void> {
    const plan = this.#plan;
    const lib = this.#library;
    const placements = this.#placements();
    const categories = new Set(plan.buildings.map((b) => b.protocol.category));
    const names = new Set<string>([
      ...placements.flatMap((p) => [p.name, ...(p.fallbacks ?? [])]),
      plan.bridge.name,
      plan.barrier.name,
      'town.tower.bell',
      'courier.base',
      ...[0, 1, 2, 3, 4, 5, 6].map((t) => `courier.cargo.t${t}`),
      'person.npc.base',
      ...[...categories].map((c) => `person.npc.${c}`),
      ...CLOUD_MODELS,
      'scenery.cloud.rain',
      ...Life.MODELS,
      'fx.coin',
      'fx.nft.frame',
      'fx.sparkle.burst',
      // townsfolk who stroll the avenue
      ...['base', 'lending', 'dex', 'staking', 'nft', 'governance', 'bridge', 'other'].map((c) => `person.npc.${c}`),
    ]);
    await Promise.all([...names].map(async (n) => this.#loaded.set(n, await lib.load(n))));
    if (this.#disposed) return;

    this.#placeLayout();
    this.#makeLife();
    this.#exchange = new Exchange({
      model: (n) => (this.#loaded.get(n) ? this.#make(n) : null),
      add: (o) => this.#scene.add(o),
      screen: (p) => this.#toScreen(p),
      labels: this.#exchangeLabels,
      onCoin: (i, n, incoming) => this.#opts.onCoin?.(i, n, incoming),
      burst: (at) => this.#burst(at),
      onNft: (landed) => this.#opts.onNft?.(landed),
    });
    this.element.append(this.#exchangeLabels, this.#arrangeLabelLayer, this.#bubbleLayer, this.#followChip);
    this.#followChip.textContent = '👁 Following the courier ✕';
    this.#followChip.hidden = true;
    this.#followChip.addEventListener('click', () => this.stopFollowing());

    // The drawbridge swings about its hinge: lowered is flat towards the town, raised stands up.
    // A model with a `lower` clip (raised → flat, its chains following) is posed by that clip instead.
    const hinge = new THREE.Group();
    hinge.position.set(plan.bridge.x, 0, plan.bridge.z);
    const deck = this.#make(plan.bridge.name);
    hinge.add(deck);
    const lower = this.#loaded.get(plan.bridge.name)?.clips.find((c) => c.name === 'lower');
    if (lower) {
      const mixer = new THREE.AnimationMixer(deck);
      const action = mixer.clipAction(lower);
      // held at a time we set (never looping back to the start at the clip's end)
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      this.#bridgeClip = { mixer, action, duration: lower.duration };
    }
    this.#scene.add(hinge);
    this.#bridge = hinge;
    this.#poseBridge();

    // The barrier's arm swings up about its post.
    // A model with a `lift` clip (down → up) is posed along it instead; its own rest pose may be either.
    const barrier = new THREE.Group();
    barrier.position.set(plan.barrier.x, BARRIER_HEIGHT, plan.barrier.z);
    const arm = this.#make(plan.barrier.name);
    barrier.add(arm);
    const lift = this.#loaded.get(plan.barrier.name)?.clips.find((c) => c.name === 'lift');
    if (lift) {
      const mixer = new THREE.AnimationMixer(arm);
      const action = mixer.clipAction(lift);
      // held at a time we set (never looping back to the start at the clip's end)
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      this.#barrierClip = { mixer, action, duration: lift.duration };
    }
    this.#scene.add(barrier);
    this.#barrier = barrier;
    this.#poseBarrier();

    // The refusal: the theme's red seal over the road at the barrier (a red marker without it).
    const seal = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    seal.position.set(0, REFUSAL_HEIGHT, plan.barrier.z);
    seal.scale.setScalar(REFUSAL_SIZE);
    seal.visible = false;
    this.#scene.add(seal);
    this.#refusal = seal;
    void this.#loadSprite('fx.refused').then((map) => {
      if (this.#disposed) {
        map?.dispose();
        return;
      }
      if (map) seal.material.map = map;
      else seal.material.color.set(REFUSAL_COLOR);
      seal.material.needsUpdate = true;
    });

    this.#applyLight();
    this.setWeather(this.#opts.weather ?? this.#weather);
    this.#makeClouds();
    this.element.append(this.#weatherEl);
    this.#renderer.shadowMap.needsUpdate = true;
    this.#ready = true;
    this.element.dataset.ready = 'true';
    this.element.dataset.quality = this.#quality;
    this.#opts.onReady?.();
  }

  /** Places the town as the plan has it: buildings, paths, the castle's pieces, decorations, the bell, each building's person. */
  #placeLayout(): void {
    const plan = this.#plan;
    const placements = this.#placements();
    // the many plain tiles (cobbles, water, the avenue): one instanced draw per mesh of each, not one per tile
    const tiles = placements.filter((p) => INSTANCED.has(p.name) && p.key !== 'lit' && !this.#loaded.get(p.name)?.clips.length);
    this.#placeInstanced(tiles);
    const tileSet = new Set(tiles);
    for (const p of placements) {
      if (tileSet.has(p)) continue;
      // the first of the name and its fallbacks that has a model; the last one's standin otherwise
      const options = [p.name, ...(p.fallbacks ?? [])];
      if (p.optional && !options.some((n) => this.#loaded.get(n))) continue; // decoration waits for its model
      const chosen = options.find((n) => this.#loaded.get(n)) ?? options[options.length - 1]!;
      const obj = this.#make(chosen);
      // its own looping clip: a mill wheel, a pendulum, an animal at rest, a flag in the wind
      // and a building's reaction to a tap
      const clips = this.#loaded.get(chosen)?.clips ?? [];
      const loop = clips.find((c) => LOOPING_CLIPS.includes(c.name));
      const tap = clips.find((c) => c.name === TAP_CLIP);
      if (loop || tap) {
        const moving = new Figure(obj, [loop, tap].filter((c): c is THREE.AnimationClip => !!c), [TAP_CLIP]);
        if (loop) moving.play(loop.name);
        this.#ambient.push(moving);
        if (tap) {
          this.#reactions.set(obj, moving);
          obj.userData.reacts = true;
          // a skinned model (an animal) plays its tap instead of its idle, as a person does
          obj.traverse((o) => {
            if ((o as THREE.SkinnedMesh).isSkinnedMesh) obj.userData.person = true;
          });
        }
      }
      if ('protocol' in p) {
        // a protocol's building fills its plot, whatever size the model was made at (a 2 m house or a 12 m landmark)
        obj.scale.setScalar(plan.layout === 2 ? classScale(obj, (p as BuildingPlacement).half) : fitScale(obj, (p as BuildingPlacement).half));
      } else if (p.scale !== undefined) obj.scale.setScalar(p.scale);
      obj.position.set(p.x, 0, p.z);
      obj.rotation.y = p.rot ?? 0;
      // buildings, the castle, the tower and trees cast shadows; everything placed receives them
      const casts = 'protocol' in p || p.name.startsWith('castle.') || p.name.startsWith('town.tower') || p.name.startsWith('scenery.tree');
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = casts;
          o.receiveShadow = true;
        }
      });
      this.#layout.add(obj);
      if (p.key === 'flag') {
        // on top of its wallet's tower, in that wallet's crest colour
        obj.position.y = TOWER_TOP;
        const wallet = this.#opts.world.walletIds[plan.wallets.findIndex((t) => t.x === p.x && t.z === p.z)];
        if (wallet) paint(obj, 'Tint', crestColors(wallet)[0], this.#painted);
      }
      if (p.key === 'lit') {
        obj.position.y = GLOW_LIFT; // over the road's surface, not under it
        obj.visible = false;
        this.#litTiles.push(obj);
        tintGlow(obj);
      }
      // The tier shows in the Trim (docs/ASSET_SPEC.md §1.3): a building's from what the guild keeps
      // there, the castle's own pieces from the guild's worth.
      if ('protocol' in p) {
        obj.userData.building = p;
        this.#buildingRoots.push(obj);
        this.#noteLod(obj);
        this.#walkway(obj, p as BuildingPlacement);
        const brand = brandColor((p as BuildingPlacement).protocol.id);
        if (brand) paint(obj, 'Tint', brand, this.#painted);
        void this.#showLogo(obj, (p as BuildingPlacement).protocol.id, (p as BuildingPlacement).protocol.iconUrl);
        paint(obj, 'Trim', tierColor(p.tier ?? 0), this.#painted);
      } else if (p.name.startsWith('castle.')) {
        // a wallet's tower or hall at its own tier, the rest of the castle at the guild's
        paint(obj, 'Trim', tierColor(p.tier ?? plan.keep.tier ?? 0), this.#painted);
        // a hall's banners in its wallet's crest colour, the keep's and the gate's in the guild's (the first wallet's)
        const w = plan.wallets.indexOf(p as (typeof plan.wallets)[number]);
        // a wallet's tower or hall, and the keep, open their sheets when tapped
        if (w >= 0) {
          obj.userData.walletIndex = w;
          obj.userData.reacts = true;
        }
        if (p === plan.keep) {
          obj.userData.keep = true;
          obj.userData.reacts = true;
        }
        if (w >= 0 || p === plan.keep) this.#castleRoots.push(obj);
        const crest = this.#opts.world.walletIds[Math.max(0, w)];
        if (plan.layout === 2 && crest) paint(obj, 'Tint', crestColors(crest)[0], this.#painted);
      }
      // the tier's extra parts (docs/STYLEGUIDE_V2.md §7): `tier.N` shows from tier N
      showTierParts(obj, p.tier ?? ('protocol' in p ? 0 : (plan.keep.tier ?? 0)));
      // a hall's dressing by what its wallet mostly holds (`focus.tokens`, `focus.defi`, `focus.nft`)
      showFocusParts(obj, (p as WalletPlacement).focus ?? 'tokens');
      const decorTint = p.key === 'decor' ? DECOR_TINT[p.name] : undefined;
      if (decorTint) paint(obj, 'Tint', decorTint === 'crest' ? crestColors(this.#opts.world.walletIds[0] ?? '')[0] : decorTint, this.#painted);
      if (p === plan.tower) {
        this.#hangBell(obj, this.#make('town.tower.bell'));
        this.#tower = obj;
        this.#towerMaterials = ownMaterials(obj);
      }
    }

    // Each building's person waits inside, to come out when a courier calls.
    for (const b of plan.buildings) {
      const name = this.#loaded.get(`person.npc.${b.protocol.category}`) ? `person.npc.${b.protocol.category}` : 'person.npc.base';
      const npc = new Figure(this.#make(name), this.#loaded.get(name)?.clips ?? [], ['emerge', 'receive', 'return', TAP_CLIP]);
      npc.object.position.set(b.npc.x, 0, b.npc.z);
      npc.object.rotation.y = b.rot ?? 0; // faces out of its door, towards the visitor
      npc.object.visible = false;
      // the protocol's colour on its person's Tint cloth (an apron, a sash); a tap while it is out gets a reaction
      const brand = brandColor(b.protocol.id);
      if (brand) paint(npc.object, 'Tint', brand, this.#painted);
      npc.object.userData.reacts = true;
      npc.object.userData.person = true;
      npc.object.userData.who = { role: ROLE[b.protocol.category] ?? 'Villager', trade: b.protocol.category, building: b.protocol.name } satisfies Person;
      this.#reactions.set(npc.object, npc);
      this.#layout.add(npc.object);
      this.#figures.push(npc);
      this.#npcs.set(b.protocol.id, npc);
    }
    // the Glow parts of everything placed (shared materials: one entry each)
    this.#layout.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.name === 'Glow' && 'emissiveIntensity' in m) this.#glows.add(m as THREE.MeshStandardMaterial);
    });
  }

  /**
   * Build mode: the town again with the player's arrangement, in place (the
   * models are already loaded). Couriers out are called home; the queue stays.
   */
  rearrange(arranged: Record<string, number>): void {
    if (!this.#ready) return;
    for (const run of [...this.#runs]) this.#finish(run);
    for (const f of [...this.#figures, ...this.#ambient]) f.dispose();
    this.#figures.length = 0;
    this.#ambient.length = 0;
    this.#reactions.clear();
    this.#npcs.clear();
    for (const m of this.#towerMaterials) m.dispose();
    // the models' geometry and materials belong to the library and stay
    this.#layout.clear();
    this.#litTiles = [];
    this.#buildingRoots.length = 0;
    this.#castleRoots.length = 0;
    this.#hovered = null;
    this.#hoverRing.visible = false;
    this.#lods.length = 0;
    this.#farNow = null;
    this.#tower = null;
    this.#towerMaterials = [];
    this.#towerOpacity = 1;
    this.#bell = null;
    this.#plan = planCastle(this.#opts.world, arranged);
    this.#placeLayout();
    this.#makeLife();
    this.#applyLight();
    this.#renderer.shadowMap.needsUpdate = true;
    this.setArranging(this.#arranging, null);
  }

  /** Build mode on or off; `selected` is the building chosen to move (a ring under it), rings mark the empty plots. */
  setArranging(on: boolean, selected: string | null): void {
    this.#arranging = on;
    this.#arrangeMarks.clear();
    for (const l of this.#arrangeLabels) l.el.remove();
    this.#arrangeLabels.length = 0;
    this.element.dataset.arranging = String(on);
    this.#setHovered(null);
    if (!on) return;
    // every place it can go: free plots (gold, "Move here"), the other buildings (blue, "Swap"), sized to each plot
    const mark = (x: number, z: number, half: number, material: THREE.Material, text: string | null, data: Record<string, unknown>) => {
      const ring = new THREE.Mesh(RING_GEOMETRY, material);
      ring.position.set(x, 0.06, z);
      ring.scale.setScalar(Math.max(1.2, half * 1.15));
      Object.assign(ring.userData, data);
      this.#arrangeMarks.add(ring);
      // a flat disc inside, to tap anywhere on the plot
      const pad = new THREE.Mesh(PAD_GEOMETRY, PAD_MATERIAL);
      pad.position.set(x, 0.05, z);
      pad.scale.setScalar(Math.max(1.2, half * 1.15));
      Object.assign(pad.userData, data);
      this.#arrangeMarks.add(pad);
      if (text) {
        const label = el('div', `arrange-label ${material === PLOT_MATERIAL ? 'move' : 'swap'}`);
        label.textContent = text;
        this.#arrangeLabelLayer.append(label);
        this.#arrangeLabels.push({ el: label, at: new THREE.Vector3(x, 0.5, z) });
      }
    };
    for (const f of this.#plan.freeSlots) mark(f.x, f.z, f.half, PLOT_MATERIAL, 'Move here', { slot: f.slot });
    for (const b of this.#plan.buildings) {
      if (b.protocol.id === selected) mark(b.x, b.z, b.half, CHOSEN_MATERIAL, null, {});
      else mark(b.x, b.z, b.half, SWAP_MATERIAL, `Swap with ${b.protocol.name}`, { protocolId: b.protocol.id });
    }
  }

  /**
   * 'auto' quality: over the first frames after the scene is up, if they come
   * slower than about 25 a second, step down to low (no sun shadows, no
   * environment light, pixel ratio 1). Once.
   */
  #watchSpeed(dt: number): void {
    if (this.#opts.quality !== undefined && this.#opts.quality !== 'auto') return;
    if (this.#quality === 'low' || this.#frameTimes.length >= SPEED_FRAMES) return;
    if (dt > 0) this.#frameTimes.push(dt);
    if (this.#frameTimes.length < SPEED_FRAMES) return;
    const sorted = [...this.#frameTimes].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)]!;
    if (typical > SLOW_FRAME) this.#setQuality('low');
  }

  #setQuality(q: 'high' | 'low'): void {
    this.#quality = q;
    const high = q === 'high';
    this.#renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.#renderer.shadowMap.enabled = high;
    this.#scene.environment = high ? this.#environment : null;
    // shadows and the environment change the shaders: every material is built again
    this.#scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.needsUpdate = true;
    });
    this.#fit();
    this.element.dataset.quality = q;
  }

  /**
   * Puts a protocol's logo on its building's logo plates (the `Logo` material,
   * docs/STYLEGUIDE_V2.md §8.1). Models without plates, and protocols without a
   * logo, keep what they have.
   */
  async #showLogo(root: THREE.Object3D, protocolId: string, iconUrl: string | null = null): Promise<void> {
    const plates: THREE.Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => m.name === 'Logo')) plates.push(mesh);
    });
    // the bundled logo, else the icon Zerion gives the protocol (through our own picture proxy)
    const path = logoPath(protocolId) ?? (iconUrl ? proxied(iconUrl) : null);
    if (!plates.length || !path) return;
    const first = plates[0]!.material;
    const template = (Array.isArray(first) ? first : [first]).find((m) => m.name === 'Logo')!;
    let made = this.#logos.get(path);
    if (!made) {
      made = this.#logoMaterial(template, path);
      this.#logos.set(path, made);
    }
    const material = await made;
    if (!material || this.#disposed) return;
    for (const mesh of plates) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => (m.name === 'Logo' ? material : m)) : material;
    }
  }

  /** A logo plate's material: the model's own, with the logo centred on the plate's colour. */
  async #logoMaterial(template: THREE.Material, path: string): Promise<THREE.Material | null> {
    try {
      const theme = await this.#opts.theme;
      const img = path.startsWith('/api/') ? await loadImage(path) : await loadThemeImage(theme, path);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = LOGO_SIZE;
      const g = canvas.getContext('2d')!;
      g.fillStyle = LOGO_PLATE;
      g.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE);
      // the logo whole, as large as fits inside the margin
      const room = LOGO_SIZE * (1 - 2 * LOGO_MARGIN);
      const k = room / Math.max(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      g.drawImage(img, (LOGO_SIZE - w) / 2, (LOGO_SIZE - h) / 2, w, h);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false; // as glTF's own textures: the plate's UVs are upright that way
      map.anisotropy = 4;
      const material = template.clone() as THREE.MeshStandardMaterial;
      material.map = map;
      material.needsUpdate = true;
      return material;
    } catch {
      return null;
    }
  }

  /** A sprite's picture from the theme, or null when it has none. */
  async #loadSprite(name: string): Promise<THREE.Texture | null> {
    const spec = findAsset(name);
    if (!spec) return null;
    try {
      const theme = await this.#opts.theme;
      const map = await new THREE.TextureLoader().loadAsync(themeFileUrl(artTheme(theme), assetPath(spec)));
      map.colorSpace = THREE.SRGBColorSpace;
      return map;
    } catch {
      return null;
    }
  }

  /** Lights the scene for the hour: the sun, the sky, and how bright windows and lanterns glow. */
  #applyLight(): void {
    const now = new Date();
    const l = lightAt(this.#opts.hour ?? now.getHours() + now.getMinutes() / 60);
    // the weather: grey days dim and cool the sun, a rising market warms it
    const w = this.#weather;
    this.#sun.intensity = l.sun * (1 - 0.45 * w.gloom) * (1 + 0.15 * w.shine);
    this.#sun.color.setHex(0xffe2b8).lerp(SHINE_COLOR, w.shine * 0.5).lerp(GLOOM_COLOR, w.gloom);
    this.#hemi.intensity = l.ambient * (1 - 0.2 * w.gloom);
    this.#renderer.setClearColor(l.sky, 1);
    for (const m of this.#glows) m.emissiveIntensity = l.glow;
    this.element.dataset.night = l.night.toFixed(2);
  }

  /** The market's weather: rain and a grey veil (0 … 1 each). */
  setWeather(w: Weather): void {
    this.#weather = w;
    this.#weatherEl.style.setProperty('--rain', w.rain.toFixed(2));
    this.#weatherEl.style.setProperty('--gloom', w.gloom.toFixed(2));
    this.element.dataset.rain = w.rain.toFixed(2);
    this.element.dataset.clouds = w.clouds.toFixed(2);
    this.#applyLight();
    if (this.#ready) this.#makeClouds();
  }

  /**
   * The clouds for the weather: they float over the woods at the world's edges
   * (never over the town: they would hide it), more, and storm-dark, as the
   * market falls.
   */
  #makeClouds(): void {
    for (const c of this.#clouds) c.obj.removeFromParent();
    this.#clouds.length = 0;
    for (const m of this.#cloudMaterials) m.dispose();
    this.#cloudMaterials.length = 0;
    const w = this.#weather;
    const t = this.#plan.town;
    const m = this.#plan.moat;
    const area = { x0: Math.min(m.x0, t.x0) - 30, x1: Math.max(m.x1, t.x1) + 30, z0: m.z0 - 30, z1: t.z1 + 30 };
    this.#cloudArea = area;
    const storm = w.rain >= 0.9;
    const pick = (i: number) => {
      const name = storm && this.#loaded.get('scenery.cloud.rain') ? 'scenery.cloud.rain' : CLOUD_MODELS[i % CLOUD_MODELS.length]!;
      return this.#loaded.get(name) ? this.#make(name) : this.#cloudPuff(i, storm);
    };
    const rand = (i: number) => ((Math.sin(i * 91.3 + 7.1) * 43758.5453) % 1 + 1) % 1;
    // out beyond the town and the castle, over the woods (never over the town: they would hide it)
    const seen = Math.round(3 + w.clouds * 9);
    for (let i = 0; i < seen; i++) {
      const obj = pick(i + 40);
      // its own see-through materials: it fades out when it would cover a followed courier
      const mats: THREE.Material[] = [];
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const own = (mesh.material as THREE.Material).clone();
        own.transparent = true;
        mats.push(own);
        mesh.material = own;
      });
      this.#cloudMaterials.push(...mats);
      obj.scale.setScalar(0.9 + rand(i + 40) * 0.8);
      const left = rand(i + 41) < 0.5;
      const x = left ? area.x0 + rand(i + 42) * 14 : area.x1 - rand(i + 42) * 14;
      obj.position.set(x, CLOUD_HEIGHT * (0.55 + rand(i + 44) * 0.3), area.z0 + rand(i + 43) * (area.z1 - area.z0));
      this.#scene.add(obj);
      this.#clouds.push({ obj, speed: CLOUD_WIND * 0.6, edge: true, mats, opacity: 1 });
    }
  }

  /** A cloud of soft lobes, until the theme has cloud models: white above, a cooler grey below. */
  #cloudPuff(seed: number, storm: boolean): THREE.Object3D {
    const g = new THREE.Group();
    const lobes = 5 + (seed % 3);
    for (let i = 0; i < lobes; i++) {
      const mesh = new THREE.Mesh(CLOUD_LOBE, storm ? CLOUD_STORM_MATERIAL : CLOUD_MATERIAL);
      const a = (i / lobes) * Math.PI * 2;
      const r = 1.6 + ((seed * 7 + i * 3) % 5) * 0.25;
      mesh.position.set(Math.cos(a) * r * 1.4, (i % 2) * 0.6, Math.sin(a) * r * 0.6);
      mesh.scale.set(1.6 + (i % 3) * 0.35, 1.1 + (i % 2) * 0.3, 1.4);
      g.add(mesh);
    }
    const top = new THREE.Mesh(CLOUD_LOBE, storm ? CLOUD_STORM_MATERIAL : CLOUD_MATERIAL);
    top.scale.set(2.2, 1.7, 1.8);
    top.position.y = 0.9;
    g.add(top);
    return g;
  }

  /** Drifts the clouds with the wind, round the world. */
  #driftClouds(dt: number): void {
    if (!this.#clouds.length) return;
    const a = this.#cloudArea;
    // what must stay seen: a followed courier, else the middle of the view
    const keep = this.#followRun ? this.#followRun.figure.object.position : this.#focus;
    const k = this.#toScreen(keep);
    const near = Math.min(this.element.clientWidth, this.element.clientHeight) * 0.28;
    for (const c of this.#clouds) {
      c.obj.position.x += c.speed * dt;
      if (c.obj.position.x > a.x1 + 20) c.obj.position.x = a.x0 - 20;
      const p = k ? this.#toScreen(c.obj.position) : null;
      const covers = !!(p && k && Math.hypot(p.x - k.x, p.y - k.y) < near * (1 + c.obj.scale.x * 0.3));
      // gone altogether while in the way (a faint one reads as a smudge)
      const target = covers ? 0 : 1;
      if (Math.abs(target - c.opacity) > 0.01) {
        c.opacity += (target - c.opacity) * Math.min(1, dt * 4);
        if (target === 0 && c.opacity < 0.02) c.opacity = 0;
        for (const m of c.mats) m.opacity = c.opacity;
        c.obj.visible = c.opacity > 0;
      }
    }
  }

  /** A new object for an asset: its model, or its standin. */
  #makeLife(): void {
    this.#life?.dispose();
    this.#life = new Life(
      {
        has: (n) => !!this.#loaded.get(n),
        make: (n) => this.#make(n),
        clips: (n) => this.#loaded.get(n)?.clips ?? [],
        add: (o) => this.#layout.add(o),
        tint: (o, t) => {
          const color = t === 'crest' ? crestColors(this.#opts.world.walletIds[0] ?? '')[0] : t.startsWith('brand:') ? (brandColor(t.slice(6)) ?? VILLAGER_TINT) : t;
          paint(o, 'Tint', color, this.#painted);
        },
      },
      this.#plan,
    );
  }

  /** Places many copies of plain models as instanced meshes (one per mesh of a model): they never move. */
  #placeInstanced(tiles: readonly Placement[]): void {
    const byName = new Map<string, Placement[]>();
    for (const t of tiles) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
    const at = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const [name, list] of byName) {
      const model = this.#make(name);
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
        list.forEach((t, i) => {
          at.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot ?? 0), t.scale !== undefined ? new THREE.Vector3(t.scale, t.scale, t.scale) : one);
          inst.setMatrixAt(i, at.multiply(mesh.matrixWorld));
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.receiveShadow = true;
        this.#layout.add(inst);
      });
    }
  }

  #make(name: string): THREE.Object3D {
    const spec = findAsset(name);
    if (!spec) throw new Error(`no asset named ${name}`);
    return this.#library.instance(spec, this.#loaded.get(name) ?? null);
  }

  /** Sends a courier on an errand: to (or from) its protocol's building, or the town's far end. */
  #spawn(errand: Errand): void {
    const building = errand.protocolId ? (this.#plan.buildings.find((b) => b.protocol.id === errand.protocolId) ?? null) : null;
    let script: CourierScript;
    if (errand.direction === 'inside') {
      // between two wallets' towers or halls (a wallet beyond the slots has none: no errand)
      const way = routeBetweenWallets(this.#plan, errand.fromTower ?? -1, errand.toTower ?? -1);
      if (!way) return;
      script = buildCourierScript(way.route, DEFAULT_TIMING, 'inside', { height: way.height });
    } else {
      script = buildCourierScript(routeTo(this.#plan.avenue, building), DEFAULT_TIMING, errand.direction, { failed: errand.failed });
    }
    const figure = new Figure(this.#make('courier.base'), this.#loaded.get('courier.base')?.clips ?? [], [TAP_CLIP]);
    // its goods, sized by value, in its right hand (on the standin's back)
    const cargo = this.#make(`courier.cargo.t${Math.max(0, Math.min(6, errand.tier))}`);
    const hand = figure.object.getObjectByName('hand');
    if (hand) hand.add(cargo);
    else {
      cargo.position.set(0, 1, -0.3);
      figure.object.add(cargo);
    }
    // an invisible, generous target to tap (a walking figure is small on a phone)
    const target = new THREE.Mesh(HIT_GEOMETRY, HIT_MATERIAL);
    target.position.y = HIT_HEIGHT / 2;
    target.userData.errand = errand;
    figure.object.add(target);
    this.#courierTargets.push(target);
    this.#scene.add(figure.object);
    this.#runs.push({ errand, building, script, start: this.#time, figure, cargo, standin: !this.#loaded.get('courier.base') });
    this.#lastSpawn = this.#time;
  }

  /** A courier home again: it goes. Its model's geometry belongs to the library and stays; a standin's is its own. */
  /**
   * The goods change hands at the door: what the courier gives streams to the
   * building's person (or the stranger at the town's end), what it gets streams
   * back. Inside the castle, everything goes into the other wallet's hall.
   */
  #handOver(run: Run): void {
    const ex = this.#exchange;
    if (!ex) return;
    const e = run.errand;
    const at = run.figure.object.position.clone();
    const give = e.steps.flatMap((st) => st.give);
    const get = e.steps.flatMap((st) => st.get);
    if (e.direction === 'inside') {
      const hall = this.#walletAt(this.#plan.wallets[e.toTower ?? -1]);
      this.#dropFrame(run);
      ex.send(at, hall ?? at, give.length ? give : get.length ? get : this.#valueGoods(e.valueUsd), true);
      return;
    }
    // the person at the door: between the courier and the building
    const b = run.building;
    const them = b ? new THREE.Vector3(b.npc.x, 0, b.npc.z) : at.clone().add(new THREE.Vector3(0, 0, 1.5));
    let delay = 0;
    if (e.direction === 'out' && (give.length || e.valueUsd > 0)) {
      this.#dropFrame(run);
      delay = ex.send(at, them, give.length ? give : this.#valueGoods(e.valueUsd), false) * 0.6;
    }
    if (get.length) {
      const back = ex.send(them, at, get, true, delay + 0.3);
      // an NFT got: the courier carries it home over its head
      const nft = get.find((g) => g.isNft);
      if (nft) setTimeout(() => this.#carryFrame(run, nft), back * 1000);
    }
  }

  /** Goods for a value with no token named. */
  #valueGoods(usd: number): Goods[] {
    return [{ symbol: '', quantity: 0, usd, isNft: false }];
  }

  /** Where a wallet's hall (or tower) takes goods: its door. */
  #walletAt(w: WalletPlacement | undefined): THREE.Vector3 | null {
    return w ? new THREE.Vector3(w.door.x, 0, w.door.z) : null;
  }

  /** A courier carries an NFT home: the framed picture over its head. */
  #carryFrame(run: Run, g: Goods): void {
    if (!this.#exchange || !this.#runs.includes(run) || run.frame) return;
    const frame = this.#exchange.frame(g);
    // held in its hand when it has the `carry` clip (the frame's origin is the handle's grip), else over its head
    let hand: THREE.Object3D | undefined;
    run.figure.object.traverse((o) => {
      if (!hand && ((o.userData.name as string | undefined) ?? o.name) === 'hand') hand = o;
    });
    if (hand && run.figure.has('carry')) {
      const s = hand.getWorldScale(new THREE.Vector3()).x / run.figure.object.getWorldScale(new THREE.Vector3()).x;
      frame.scale.setScalar(CARRY_FRAME_SCALE / s);
      hand.add(frame);
    } else {
      frame.position.set(0, 2.6, 0);
      frame.scale.setScalar(1.6);
      run.figure.object.add(frame);
    }
    run.frame = frame;
  }

  #dropFrame(run: Run): void {
    run.frame?.removeFromParent();
    run.frame = null;
  }

  /** Stars burst where goods land. */
  #burst(at: THREE.Vector3): void {
    const loaded = this.#loaded.get('fx.sparkle.burst');
    const pop = loaded?.clips.find((c) => c.name === 'pop');
    if (!loaded || !pop) return;
    const figure = new Figure(this.#make('fx.sparkle.burst'), [pop], ['pop']);
    figure.object.position.copy(at).setY(at.y + 1.2);
    figure.object.scale.setScalar(BURST_SCALE);
    this.#scene.add(figure.object);
    figure.react('pop', false);
    this.#bursts.push({ figure, until: this.#time + pop.duration });
  }

  /** A speech bubble over someone's head (it replaces their last); the line said, or null when they keep quiet. */
  #say(obj: THREE.Object3D, who: Person): string | null {
    const line = this.#opts.chatter?.(who);
    if (!line) return null;
    this.#bubbles = this.#bubbles.filter((b) => (b.obj === obj ? (b.el.remove(), false) : true));
    const bubble = el('div', 'speech-bubble');
    bubble.textContent = line;
    this.#bubbleLayer.append(bubble);
    this.#bubbles.push({ el: bubble, obj, until: this.#time + BUBBLE_TIME });
    return line;
  }

  /** Someone in the street speaks up now and then; the bubbles follow their heads and fade. */
  #chatter(dt: number): void {
    this.#nextChatter -= dt;
    if (this.#nextChatter <= 0 && this.#bubbles.length < 2) {
      this.#nextChatter = CHATTER_EVERY + Math.random() * 3;
      const one = this.#life?.someone(Math.random());
      if (one) this.#say(one.obj, one.who);
    }
    this.#bubbles = this.#bubbles.filter((b) => {
      if (this.#time > b.until || !b.obj.parent) return b.el.remove(), false;
      const head = b.obj.getWorldPosition(this.#bubbleScratch);
      head.y += BUBBLE_HEIGHT;
      const p = this.#toScreen(head);
      b.el.hidden = !p || !b.obj.visible;
      if (p) {
        b.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        b.el.style.opacity = String(Math.min(1, (b.until - this.#time) / 0.5));
      }
      return true;
    });
  }

  /** A world point on the page, relative to the view (null: off the camera's sight). */
  #toScreen(p: THREE.Vector3): { x: number; y: number } | null {
    const v = this.#screenScratch.copy(p).project(this.#camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.element.clientWidth, y: ((1 - v.y) / 2) * this.element.clientHeight };
  }

  #finish(run: Run): void {
    // home: what it brought goes into its wallet's hall
    const e = run.errand;
    const got = e.steps.flatMap((st) => st.get);
    if (this.#exchange && e.direction !== 'inside' && !e.failed && got.length) {
      const i = this.#opts.world.walletIds.indexOf(e.wallet);
      const hall = this.#walletAt(this.#plan.wallets[i]);
      if (hall) this.#exchange.send(run.figure.object.position.clone(), hall, got, true);
    }
    this.#dropFrame(run);
    // its tap target is shared geometry: off the figure before a standin's own geometry is freed
    for (const t of this.#courierTargets) if (t.parent === run.figure.object) t.removeFromParent();
    this.#courierTargets = this.#courierTargets.filter((t) => t.parent !== null);
    this.#scene.remove(run.figure.object);
    run.figure.dispose();
    if (run.standin) disposeTree(run.figure.object);
    this.#runs.splice(this.#runs.indexOf(run), 1);
  }

  /** Hangs the bell at the tower's `hinge` point, or at the default height on a standin. */
  #hangBell(tower: THREE.Object3D, bellModel: THREE.Object3D): void {
    tower.updateMatrixWorld(true);
    const hinge = tower.getObjectByName('hinge');
    const pivot = new THREE.Group();
    if (hinge) hinge.getWorldPosition(pivot.position);
    else pivot.position.set(tower.position.x, BELL_HEIGHT, tower.position.z);
    pivot.add(bellModel);
    this.#layout.add(pivot);
    this.#bell = pivot;
  }

  /** Poses the drawbridge at its angle: by its own clip (0 s raised … the end flat), or by turning it about the hinge. */
  #poseBridge(): void {
    if (!this.#bridge) return;
    const raised = Math.max(0, Math.min(1, -this.#bridgeAngle / (Math.PI / 2)));
    if (this.#bridgeClip) {
      const { mixer, action, duration } = this.#bridgeClip;
      action.time = Math.min(duration - 1e-4, (1 - raised) * duration);
      mixer.update(0);
    } else this.#bridge.rotation.x = this.#bridgeAngle;
  }

  /** Poses the barrier at its angle: by its own clip (0 s down … the end up), or by turning it about its post. */
  #poseBarrier(): void {
    if (!this.#barrier) return;
    if (this.#barrierClip) {
      const { mixer, action, duration } = this.#barrierClip;
      action.time = Math.min(duration - 1e-4, Math.max(0, Math.min(1, this.#barrierAngle / (Math.PI / 2))) * duration);
      mixer.update(0);
    } else this.#barrier.rotation.z = this.#barrierAngle;
  }

  #placements(): Placement[] {
    const p = this.#plan;
    return [...p.water, ...p.ground, ...p.walls, ...p.wallets, ...p.wings, p.keep, p.gatehouse, ...(p.storehouse ? [p.storehouse] : []), p.tollbooth, p.tower, ...p.road, ...p.lit, ...p.buildings, ...p.scenery, ...p.decor];
  }

  #fit(): void {
    const w = this.element.clientWidth || 1;
    const h = this.element.clientHeight || 1;
    this.#renderer.setSize(w, h, false);
    this.#updateCamera();
  }

  #updateCamera(): void {
    const w = this.element.clientWidth || 1;
    const h = this.element.clientHeight || 1;
    const aspect = w / h;
    const half = this.#viewHeight() / 2;
    this.#camera.left = -half * aspect;
    this.#camera.right = half * aspect;
    this.#camera.top = half;
    this.#camera.bottom = -half;
    // It stands back along its angles, far enough that everything in view is in front of it, and sees as far past.
    const back = standBack(half, this.#angles.pitch, ORBIT_RADIUS * CAMERA_BACK);
    offsetFor(this.#angles.yaw, this.#angles.pitch, back, this.#camera.position);
    this.#camera.position.add(this.#focus);
    this.#camera.far = back + SCENE_REACH;
    this.#camera.lookAt(this.#focus);
    this.#camera.updateProjectionMatrix();
    this.#camera.updateMatrixWorld();
    // the sun's shadows cover what the camera looks at, moved in whole shadow-map texels so their edges
    // stay put while the view pans (and are only drawn again when they move)
    const texel = (2 * SHADOW_REACH) / this.#sun.shadow.mapSize.x;
    const along = (axis: THREE.Vector3) => Math.round(this.#focus.dot(axis) / texel) * texel;
    const at = new THREE.Vector3()
      .addScaledVector(SUN_RIGHT, along(SUN_RIGHT))
      .addScaledVector(SUN_UP, along(SUN_UP))
      .addScaledVector(SUN_DIRECTION, this.#focus.dot(SUN_DIRECTION));
    const moved = !at.equals(this.#sun.target.position);
    this.#sun.target.position.copy(at);
    this.#sun.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE).add(at);
    this.#sun.target.updateMatrixWorld();
    if (moved) this.#renderer.shadowMap.needsUpdate = true;
    this.#pickLods();
  }

  /**
   * A path from the avenue to a building's door: path tiles along the line from the avenue's
   * edge to the model's own `door` point (where its door is: not always the plot's middle).
   */
  #walkway(root: THREE.Object3D, b: BuildingPlacement): void {
    root.updateMatrixWorld(true);
    let door: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (((o.userData.name as string | undefined) ?? o.name) === 'door') door = o;
    });
    if (!door) return;
    const at = new THREE.Vector3();
    (door as THREE.Object3D).getWorldPosition(at);
    const side = Math.sign(b.door.x);
    const z = Math.round(at.z * 2) / 2;
    // from the tile beside the avenue up to the door (its point stands a metre in front of it), a tile a
    // metre; the plan's own step tile kept
    const end = Math.abs(at.x) + 0.5;
    for (let x = 1; x <= end + 0.01; x += 1) {
      if (x === 1 && Math.abs(z - b.door.z) < 0.5) continue;
      const tile = this.#make('path.tile.straight');
      tile.position.set(side * x, 0, z);
      tile.rotation.y = Math.PI / 2;
      tile.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
      });
      this.#layout.add(tile);
    }
  }

  /** A building's near and far copies (`….lod0`, `….lod1`, docs/STYLEGUIDE_V2.md §8), when it has both. */
  #noteLod(root: THREE.Object3D): void {
    let near: THREE.Object3D | null = null;
    let far: THREE.Object3D | null = null;
    root.traverse((o) => {
      const name = (o.userData.name as string | undefined) ?? o.name;
      if (/\.lod0$/.test(name)) near = o;
      else if (/\.lod1$/.test(name)) far = o;
    });
    if (!near || !far) return;
    root.updateMatrixWorld(true);
    const height = new THREE.Box3().setFromObject(near).getSize(new THREE.Vector3()).y;
    this.#lods.push({ near, far, height });
    this.#farNow = null;
  }

  /**
   * Near or far copies, by how tall a building shows: below LOD_FAR_PX on screen the far copy
   * (about half the triangles) is drawn; above LOD_NEAR_PX the full one (the gap keeps them from
   * flickering at the edge). One switch for all: the camera is orthographic, so it is the zoom.
   */
  #pickLods(): void {
    if (!this.#lods.length) return;
    const pxPerMetre = (this.element.clientHeight || 1) / this.#viewHeight();
    const shortest = Math.min(...this.#lods.map((l) => l.height));
    const px = shortest * pxPerMetre;
    const far = this.#farNow === null ? px < LOD_FAR_PX : this.#farNow ? px < LOD_NEAR_PX : px < LOD_FAR_PX;
    if (far === this.#farNow) return;
    this.#farNow = far;
    for (const l of this.#lods) {
      l.near.visible = !far;
      l.far.visible = far;
    }
    this.#renderer.shadowMap.needsUpdate = true;
  }

  /** Metres of the scene shown top to bottom now: tall enough for the minimum width, divided by the zoom. */
  #viewHeight(): number {
    const aspect = (this.element.clientWidth || 1) / (this.element.clientHeight || 1);
    return Math.max(VIEW_HEIGHT, VIEW_WIDTH_MIN / aspect) / this.#zoom;
  }

  #bindInput(): void {
    const c = this.#canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.#pointers.size === 1 || !this.#gesture) {
        // a right-drag, or a drag with Ctrl or Alt held, turns the view instead of panning it
        this.#gesture = { moved: 0, orbit: this.#pointers.size === 1 && (e.button === 2 || e.ctrlKey || e.altKey), pinch: 0, twist: 0, midY: 0 };
      } else {
        this.#gesture.orbit = false;
      }
      this.#twoFingers();
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.#pointers.get(e.pointerId);
      const g = this.#gesture;
      if (!prev || !g) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      g.moved += Math.hypot(dx, dy);
      if (this.#pointers.size >= 2) {
        // two fingers: spread to zoom, twist to turn, move up or down together to tilt
        const { pinch, twist, midY } = g;
        this.#twoFingers();
        if (pinch > 0 && g.pinch > 0) this.#setZoom(this.#zoom * (g.pinch / pinch));
        this.turn(wrapAngle(g.twist - twist));
        this.tilt((g.midY - midY) * TILT_PER_PIXEL);
      } else if (g.orbit) {
        this.turn(-dx * TURN_PER_PIXEL);
        this.tilt(dy * TILT_PER_PIXEL);
      } else {
        this.#pan(dx, dy);
      }
    });
    const end = (e: PointerEvent) => {
      const g = this.#gesture;
      this.#pointers.delete(e.pointerId);
      if (this.#pointers.size === 0) {
        if (g && g.moved < TAP_SLOP && !g.orbit) this.#tap(e.clientX, e.clientY);
        this.#gesture = null;
      } else {
        this.#twoFingers();
      }
    };
    c.addEventListener('pointerup', end);
    // the mouse over the scene: the ring under what it points at (looked up once a frame)
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && e.buttons === 0) this.#hoverAt = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointerleave', () => {
      this.#hoverAt = null;
      this.#setHovered(null);
      c.style.cursor = '';
    });
    c.addEventListener('pointercancel', (e) => {
      this.#pointers.delete(e.pointerId);
      if (this.#pointers.size === 0) this.#gesture = null;
    });
    // the right button turns the view: no menu
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.#setZoom(this.#zoom * Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    window.addEventListener('keydown', this.#onKey);
  }

  /** Q/E turn the view, R/F tilt it (not while typing, nor with Ctrl, Alt or Cmd held, nor when the view is not on show). */
  readonly #onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey || !this.element.isConnected || this.element.offsetParent === null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    switch (e.key.toLowerCase()) {
      case 'q':
        this.turn(-TURN_STEP);
        break;
      case 'e':
        this.turn(TURN_STEP);
        break;
      case 'r':
        this.tilt(TILT_STEP);
        break;
      case 'f':
        this.tilt(-TILT_STEP);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /** Records the two fingers' distance, angle and midpoint height (all zero with fewer than two down). */
  #twoFingers(): void {
    const g = this.#gesture;
    if (!g) return;
    let a: { x: number; y: number } | undefined;
    let b: { x: number; y: number } | undefined;
    for (const p of this.#pointers.values()) {
      if (!a) a = p;
      else if (!b) b = p;
    }
    if (!a || !b) {
      g.pinch = 0;
      return;
    }
    g.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    g.twist = Math.atan2(b.y - a.y, b.x - a.x);
    g.midY = (a.y + b.y) / 2;
  }

  #cameraButton(name: string, label: string, title: string, act: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn camera-btn ${name}`;
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', act);
    return b;
  }

  #setZoom(zoom: number): void {
    this.#followZoomFor = 0; // the player zooms: the follow leaves the zoom alone
    this.#zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    this.#updateCamera();
  }

  /** Moves the view so the ground under the pointer follows it (at the camera's angle now). */
  #pan(dx: number, dy: number): void {
    const h = this.element.clientHeight || 1;
    const d = panDelta(dx, dy, this.#viewHeight() / h, this.#angles, this.#panScratch);
    // following a courier: the pan moves the view about it, never so far that it leaves the view
    if (this.#followKey) {
      const o = this.#followOffset;
      o.x += d.x;
      o.z += d.z;
      const max = this.#viewHeight() * FOLLOW_SLACK;
      const len = Math.hypot(o.x, o.z);
      if (len > max) o.multiplyScalar(max / len);
      return;
    }
    // as far as the castle and the town reach (the town grows with its protocols)
    const t = this.#plan.town;
    const moat = this.#plan.moat;
    // out into the world round them too (the farms, the river, the hills): more when zoomed out
    const roam = WORLD_ROAM / Math.max(1, this.#zoom);
    this.#focus.x = Math.max(Math.min(moat.x0, t.x0) - roam, Math.min(Math.max(moat.x1, t.x1) + roam, this.#focus.x + d.x));
    this.#focus.z = Math.max(moat.z0 - 8 - roam, Math.min(t.z1 + roam, this.#focus.z + d.z));
    this.#updateCamera();
  }

  #tap(clientX: number, clientY: number): void {
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    // build mode: a marked plot (free, or another building's to swap with), or the building itself (no sheets)
    if (this.#arranging) {
      const mark = this.#raycaster.intersectObjects(this.#arrangeMarks.children, false).find((h) => h.object.userData.slot !== undefined || h.object.userData.protocolId !== undefined);
      if (mark) {
        const d = mark.object.userData;
        this.#opts.onArrangeTap?.(d.slot !== undefined ? { slot: d.slot as number } : { protocolId: d.protocolId as string });
        return;
      }
      let b: THREE.Object3D | null = this.#raycaster.intersectObjects(this.#buildingRoots, true)[0]?.object ?? null;
      while (b && !b.userData.building) b = b.parent;
      if (b) this.#opts.onArrangeTap?.({ protocolId: (b.userData.building as BuildingPlacement).protocol.id });
      return;
    }
    // couriers first: they walk in front of the buildings
    const courier = this.#raycaster.intersectObjects(this.#courierTargets, false)[0];
    const errand = courier?.object.userData.errand as Errand | undefined;
    if (errand) {
      this.#runs.find((r) => r.errand === errand)?.figure.react(TAP_CLIP, false);
      this.#opts.onTapped?.('courier');
      this.#opts.onSelectErrand?.(errand);
      return;
    }
    // a grazer, a stroller or the toll keeper
    const lifeHit = this.#life ? this.#raycaster.intersectObjects(this.#life.tappable, true)[0] : undefined;
    if (lifeHit) {
      let l: THREE.Object3D | null = lifeHit.object;
      while (l && !this.#life!.figureOf(l)) l = l.parent;
      if (l) {
        this.#life!.figureOf(l)!.react(TAP_CLIP, false);
        this.#opts.onTapped?.('person');
        const who = this.#life!.personOf(l);
        if (who) this.#opts.onSelectPerson?.(who, this.#say(l, who));
        return;
      }
    }
    const o = this.#pick();
    if (!o) return;
    if (!o.userData.building) {
      // a person's tap takes over its whole body (and back); a castle piece's plays over its idle
      if (this.#reactions.get(o)?.react(TAP_CLIP, !o.userData.person) && !o.userData.person) this.#shadowsMoveUntil = this.#time + 2;
      this.#opts.onTapped?.(o.userData.person ? 'person' : 'building');
      const who = o.userData.who as Person | undefined;
      if (who) this.#opts.onSelectPerson?.(who, this.#say(o, who));
      if (o.userData.walletIndex !== undefined) this.#opts.onSelectWallet?.(o.userData.walletIndex as number);
      else if (o.userData.keep) this.#opts.onSelectKeep?.();
      return;
    }
    // it bounces (docs/STYLEGUIDE_V2.md §8.2), its shadow with it
    if (this.#reactions.get(o)?.react(TAP_CLIP, true)) this.#shadowsMoveUntil = this.#time + 2;
    this.#opts.onTapped?.('building');
    this.#opts.onSelect?.(o.userData.building as BuildingPlacement);
  }

  /** What is under the pointer (set on the raycaster): the nearest building, castle piece, person or animal that reacts. */
  #pick(): THREE.Object3D | null {
    const targets = [...this.#buildingRoots, ...this.#castleRoots, ...[...this.#reactions.keys()].filter((r) => !r.userData.building && r.visible)];
    const hit = this.#raycaster.intersectObjects(targets, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.building && !o.userData.reacts) o = o.parent;
    return o;
  }

  /** The ring under what the mouse is over (once a frame, only when the mouse moved). */
  #updateHover(): void {
    // a drag or build mode: no ring; the mouse still: the ring stays where it is
    if (this.#gesture || this.#arranging) {
      if (this.#hovered) this.#setHovered(null);
      return;
    }
    const at = this.#hoverAt;
    if (!at) return;
    this.#hoverAt = null;
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.set(((at.x - rect.left) / rect.width) * 2 - 1, -((at.y - rect.top) / rect.height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const courier = this.#raycaster.intersectObjects(this.#courierTargets, false)[0];
    this.#setHovered(courier ? null : this.#pick());
    this.#canvas.style.cursor = courier || this.#hovered ? 'pointer' : '';
  }

  #setHovered(o: THREE.Object3D | null): void {
    if (o === this.#hovered) return;
    this.#hovered = o;
    if (!o) {
      this.#hoverRing.visible = false;
      return;
    }
    // sized to its footprint once (people and buildings alike), round its middle
    let r = o.userData.hoverRadius as number | undefined;
    let cx = o.userData.hoverX as number | undefined;
    let cz = o.userData.hoverZ as number | undefined;
    if (r === undefined || cx === undefined || cz === undefined) {
      const box = new THREE.Box3().setFromObject(o);
      r = Math.max(0.5, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * 0.82;
      cx = (box.min.x + box.max.x) / 2;
      cz = (box.min.z + box.max.z) / 2;
      Object.assign(o.userData, { hoverRadius: r, hoverX: cx, hoverZ: cz });
    }
    this.#hoverRing.scale.setScalar(r);
    this.#hoverRing.position.set(cx, 0.06, cz);
    this.#hoverRing.visible = true;
  }

  /** The camera follows this errand's courier (a replay) once it sets out, until it is home or the player moves the view. */
  follow(errand: Errand): void {
    this.#followKey = errand.key;
    this.#followRun = null;
    this.#followWait = 0;
    this.#followOffset.set(0, 0, 0);
    this.#followZoomFor = FOLLOW_ZOOM_TIME;
  }

  #updateFollow(dt: number): void {
    this.#followChip.hidden = !this.#followRun;
    if (!this.#followKey) return;
    if (!this.#followRun) {
      this.#followRun = this.#runs.find((r) => r.errand.key === this.#followKey) ?? null;
      this.#followWait += dt;
      // a courier that never sets out (no tower for it): stop waiting
      if (!this.#followRun && this.#followWait > FOLLOW_WAIT) this.stopFollowing();
      if (!this.#followRun) return;
    }
    if (!this.#runs.includes(this.#followRun)) {
      this.stopFollowing();
      return;
    }
    // the courier, plus however far the player has panned (kept small enough that it stays in view)
    const at = this.#followRun.figure.object.position;
    const k = Math.min(1, dt * FOLLOW_RATE);
    this.#focus.x += (at.x + this.#followOffset.x - this.#focus.x) * k;
    this.#focus.z += (at.z + this.#followOffset.z - this.#focus.z) * k;
    // zoomed in at the start; after that the zoom is the player's
    if (this.#followZoomFor > 0) {
      this.#followZoomFor -= dt;
      this.#zoom += (FOLLOW_ZOOM - this.#zoom) * k;
    }
    this.#updateCamera();
  }

  /** The camera goes back to the player. */
  stopFollowing(): void {
    this.#followKey = null;
    this.#followRun = null;
    this.#followOffset.set(0, 0, 0);
    this.#followChip.hidden = true;
  }

  /** What the hover ring is under (its name; null: nothing), for tests. */
  get hovering(): string | null {
    return this.#hoverRing.visible ? (this.#hovered?.name ?? '') : null;
  }

  /** Whether the camera follows a courier now (test hook). */
  get following(): boolean {
    return this.#followRun !== null;
  }

  readonly #tick = (now: number): void => {
    if (this.element.isConnected) this.#wasConnected = true;
    else if (this.#wasConnected) {
      this.dispose();
      return;
    }
    this.#timer.update(now);
    const dt = Math.min(0.1, this.#timer.getDelta());
    this.#time += dt;
    // the camera turns and tilts towards where it was sent
    if (dampAngles(this.#angles, this.#angleTarget, dt)) this.#updateCamera();
    if (this.#ready) {
      this.#updateHover();
      this.#updateFollow(dt);
      this.#driftClouds(dt);
      this.#animate(dt);
      this.#watchSpeed(dt);
      if (this.#time < this.#shadowsMoveUntil) this.#renderer.shadowMap.needsUpdate = true;
    }
    this.#renderer.render(this.#scene, this.#camera);
  };

  #animate(dt: number): void {
    const now = this.#time;
    this.#life?.update(dt);
    this.#exchange?.update(dt);
    this.#chatter(dt);
    this.#bursts = this.#bursts.filter((b) => {
      b.figure.update(dt);
      if (this.#time < b.until) return true;
      b.figure.object.removeFromParent();
      return false;
    });
    for (const l of this.#arrangeLabels) {
      const p = this.#toScreen(l.at);
      l.el.hidden = !p;
      if (p) l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    // the light follows the clock (once a minute is plenty)
    if (now - this.#lightAt > 60) {
      this.#lightAt = now;
      this.#applyLight();
    }
    // Couriers: the next errand sets out when there is room; with nothing waiting, the recent ones play again.
    if (this.#autoReplay && this.#queue.length === 0 && this.#runs.length === 0) {
      if (this.#replayAt === 0) this.#replayAt = now + REPLAY_PAUSE;
      else if (now >= this.#replayAt) {
        this.#queue = this.#opts.world.errands.slice(-REPLAY_COUNT);
        this.#replayAt = 0;
      }
    }
    if (this.#queue.length > 0 && this.#runs.length < MAX_COURIERS && now - this.#lastSpawn >= COURIER_GAP) this.#spawn(this.#queue.shift()!);

    const states = this.#courierScratch;
    states.length = 0;
    let bridgeDown = false;
    let barrierUp = false;
    let refused = false;
    const npcState = new Map<string, NpcClip>();
    for (const run of [...this.#runs]) {
      const t = now - run.start;
      if (t >= run.script.duration) {
        this.#finish(run);
        continue;
      }
      const s = courierAt(run.script, t, this.#plan.barrier.z);
      if (s.clip === 'toll' && !run.tolled) {
        run.tolled = true;
        this.#opts.onToll?.(run.errand);
        this.#life?.toll(false);
        // the toll: a few coins to the toll keeper (or the booth)
        const keeper = this.#life?.keeperAt ?? new THREE.Vector3(this.#plan.tollbooth.x, 0, this.#plan.tollbooth.z);
        this.#exchange?.send(run.figure.object.position, keeper, [{ symbol: '', name: 'toll', quantity: 0, usd: run.errand.feeUsd ?? 0.5, isNft: false }], false);
      }
      if (s.clip === 'hand-over' && !run.handed) {
        run.handed = true;
        this.#handOver(run);
      }
      states.push(s);
      run.figure.object.position.set(s.x, run.script.height, s.z);
      refused ||= s.refused;
      if (s.refused && !run.refusedTold) {
        run.refusedTold = true;
        this.#opts.onRefused?.(run.errand);
        this.#life?.toll(true);
      }
      run.figure.object.rotation.y = s.heading;
      // a courier with a picture walks holding it up (`carry`)
      run.figure.play(run.frame && s.clip === 'walk' && run.figure.has('carry') ? 'carry' : s.clip);
      run.cargo.visible = s.carrying;
      run.figure.update(dt);
      bridgeDown ||= s.bridgeDown;
      barrierUp ||= s.barrierUp;
      if (run.building && s.npc !== 'hidden' && !npcState.has(run.building.protocol.id)) npcState.set(run.building.protocol.id, s.npc);
    }
    for (const f of this.#ambient) f.update(dt);
    for (const [id, npc] of this.#npcs) {
      const clip = npcState.get(id);
      if (clip) {
        npc.object.visible = true;
        npc.play(npcClipFor(clip));
      } else if (npc.object.visible) {
        npc.object.visible = false;
        npc.rest();
      }
      if (npc.object.visible) npc.update(dt);
    }

    if (this.#refusal) this.#refusal.visible = refused;
    const bridgeTarget = bridgeDown ? 0 : -Math.PI / 2;
    this.#bridgeAngle += (bridgeTarget - this.#bridgeAngle) * Math.min(1, dt * 4);
    this.#poseBridge();
    const barrierTarget = barrierUp ? Math.PI / 2 : 0;
    this.#barrierAngle += (barrierTarget - this.#barrierAngle) * Math.min(1, dt * 6);
    this.#poseBarrier();

    // The bell rings for each block (keeping Ethereum's time by itself while no block is reported);
    // the paths flash with it, and otherwise glow under the couriers.
    if (now - this.#blockAt > BLOCK_SILENCE && now - this.#ringAt >= BLOCK_TIME) this.#ringAt = now;
    const phase = now - this.#ringAt;
    const ringing = phase >= 0 && phase < BELL_RING;
    if (this.#bell) this.#bell.rotation.z = ringing ? Math.sin((phase / BELL_RING) * Math.PI * 4) * 0.35 : 0;
    for (const tile of this.#litTiles) {
      let lit = ringing && phase < 0.6;
      for (const s of states) if (!lit && Math.hypot(tile.position.x - s.x, tile.position.z - s.z) < 1.2) lit = true;
      tile.visible = lit;
    }

    // The tower fades while a courier or a person at a door is behind it.
    let hidden = states.some((s) => this.#behindTower(s.x, s.z));
    for (const npc of this.#npcs.values()) if (!hidden && npc.object.visible) hidden = this.#behindTower(npc.object.position.x, npc.object.position.z);
    const target = hidden ? TOWER_FADED : 1;
    if (Math.abs(target - this.#towerOpacity) > 0.001) {
      this.#towerOpacity += (target - this.#towerOpacity) * Math.min(1, dt * 6);
      const faded = this.#towerOpacity < 0.999;
      for (const m of this.#towerMaterials) {
        m.transparent = faded;
        m.opacity = this.#towerOpacity;
        m.depthWrite = !faded;
      }
    }
  }

  /** Whether a spot on the ground is in the tower's shadow line: behind it, away from the camera (as it faces now). */
  #behindTower(x: number, z: number): boolean {
    if (!this.#tower) return false;
    return isBehind(x - this.#tower.position.x, z - this.#tower.position.z, this.#angles.yaw, TOWER_HIDES.depth, TOWER_HIDES.halfWidth);
  }
}

/** Gives an object its own copies of its materials (so changing them touches nothing else) and returns them. */
function ownMaterials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const copies = mats.map((m) => m.clone());
    mesh.material = Array.isArray(mesh.material) ? copies : copies[0]!;
    out.push(...copies);
  });
  return out;
}

/**
 * The scale that makes a model fill a plot of this half width: its own half
 * width is measured from its shape at rest (overhangs included), so a model
 * made at any size fits.
 */
/**
 * A v2 building's scale for its plot: made at its size class's true size (docs/STYLEGUIDE_V2.md §3), it
 * grows or shrinks only by the plot's share of that class (about ±25%), so steps, jetties and crates
 * in front never shrink the building. A model far smaller than its class (a first-themes 2 m house
 * standing in) is fitted by its bounds instead.
 */
function classScale(model: THREE.Object3D, half: number): number {
  const footprint = SIZE_CLASSES.find((c) => c.id === sizeClassOf(2 * half))!.footprint;
  const box = new THREE.Box3().setFromObject(model);
  const own = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  return own < 0.35 * footprint ? fitScale(model, half) : (2 * half) / footprint;
}

function fitScale(model: THREE.Object3D, half: number): number {
  const box = new THREE.Box3().setFromObject(model);
  const own = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  return own > 0.01 ? Math.min(20, Math.max(0.05, half / own)) : 1;
}

/**
 * Paints an object's parts of one of the spec's recoloured materials
 * (docs/ASSET_SPEC.md §1.6: `Tint` for the brand, `Trim` for the tier). Its own
 * copies of those materials (the model's are shared by every copy placed), one
 * per source material and colour, kept in `cache`.
 */
function paint(root: THREE.Object3D, material: 'Tint' | 'Trim', color: string, cache: Map<string, THREE.Material>): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (m.name !== material) return m;
      const key = `${m.uuid}|${color}`;
      let own = cache.get(key);
      if (!own) {
        own = m.clone();
        (own as THREE.MeshStandardMaterial).color?.set(color);
        cache.set(key, own);
      }
      return own;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/** A picture from elsewhere through our own proxy (api/image.ts): a WebGL texture may then read it. */
export function proxied(url: string): string {
  return `/api/image?u=${encodeURIComponent(url)}`;
}

/** A picture, decoded (rejects when it cannot be read). */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Shows a model's tier parts up to its tier (`tier.2`, `tier.4`, `tier.6`; the loader strips the dot, userData keeps it). */
function showTierParts(root: THREE.Object3D, tier: number): void {
  root.traverse((o) => {
    const m = /^tier\.(\d)$/.exec((o.userData.name as string | undefined) ?? o.name);
    if (m) o.visible = tier >= Number(m[1]);
  });
}

/** Shows only the dressing for this focus (`focus.<name>` parts; a model without them is untouched). */
function showFocusParts(root: THREE.Object3D, focus: string): void {
  root.traverse((o) => {
    const m = /^focus\.(\w+)$/.exec((o.userData.name as string | undefined) ?? o.name);
    if (m) o.visible = m[1] === focus;
  });
}

/** Turns a path glow overlay warm. Its materials are shared by every overlay in this view, so this runs once per material. */
function tintGlow(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m.userData.glowTinted) continue;
      m.userData.glowTinted = true;
      const std = m as THREE.MeshStandardMaterial;
      std.color?.setHex(GLOW_COLOR);
      std.emissive?.setHex(GLOW_COLOR);
    }
  });
}

/** A div with a class (the weather's layers). */
function el(tag: 'div', className: string): HTMLDivElement {
  const d = document.createElement(tag);
  d.className = className;
  return d;
}

function npcClipFor(clip: NpcClip): string {
  return clip === 'hidden' ? 'idle' : clip;
}
