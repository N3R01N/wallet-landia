/**
 * A famous castle's story in the town (docs/batches/30-the-hack.md): the
 * notice board at the gate with the messages pinned so far, the building that
 * was robbed (a blast, then its ruin file laid on it with fires and smoke,
 * rubble and soot at its foot) and mended again, and the coins frozen in ice
 * by the keep. Each piece shows only when its model is in the theme.
 */

import * as THREE from 'three';
import { RUIN } from '../assets/manifest.js';
import { Figure } from './figure.js';

export interface StorySceneHost {
  load(name: string): Promise<boolean>;
  make(name: string): THREE.Object3D;
  clips(name: string): THREE.AnimationClip[];
  add(obj: THREE.Object3D): void;
  /** A building's placed root, by protocol id. */
  building(protocolId: string): THREE.Object3D | null;
  keep(): THREE.Object3D | null;
  /** Where the board stands: on the plaza, by the monuments. */
  boardSpot(): { x: number; z: number; rot: number };
}

/** The ice block is 0.32 m: shown this much bigger, so a frozen coin reads from the castle's height. */
const ICE_SCALE = 4;
/** Notes the board has room for (`note.0`–`note.7`). */
const BOARD_NOTES = 8;
const STORY_MODELS = ['prop.notice.board', 'fx.blast', 'fx.fire', 'fx.smoke.column', 'prop.rubble', 'fx.scorch', 'fx.ice', 'fx.coin'];

interface Hit {
  protocolId: string;
  objs: THREE.Object3D[];
  figures: Figure[];
}

export class StoryScene {
  readonly #host: StorySceneHost;
  readonly #has = new Map<string, boolean>();
  #board: { obj: THREE.Object3D; figure: Figure } | null = null;
  #pinned = 0;
  readonly #hits = new Map<string, Hit>();
  #ice: THREE.Object3D | null = null;
  #oneShots: { figure: Figure; until: number }[] = [];
  #time = 0;
  #disposed = false;

  constructor(host: StorySceneHost) {
    this.#host = host;
  }

  /** Loads the story's models (those the theme has). */
  async prepare(): Promise<void> {
    await Promise.all(STORY_MODELS.map(async (n) => this.#has.set(n, await this.#host.load(n))));
  }

  /** The board at the gate, with this many notes pinned (the newest shows when there are more than it holds). */
  board(pinned: number): void {
    if (this.#disposed || !this.#has.get('prop.notice.board')) return;
    if (!this.#board) {
      const obj = this.#host.make('prop.notice.board');
      const spot = this.#host.boardSpot();
      obj.position.set(spot.x, 0, spot.z);
      obj.rotation.y = spot.rot;
      const figure = new Figure(obj, this.#host.clips('prop.notice.board'), ['pin']);
      figure.play('idle');
      this.#host.add(obj);
      this.#board = { obj, figure };
    }
    const more = pinned > this.#pinned;
    this.#pinned = pinned;
    const shown = Math.min(BOARD_NOTES, pinned);
    for (let i = 0; i < BOARD_NOTES; i++) {
      const note = byName(this.#board.obj, `note.${i}`);
      if (note) note.scale.setScalar(i < shown ? 1 : 0);
    }
    if (more) this.#board.figure.react('pin', true);
  }

  /** The board, for a tap. */
  get boardObject(): THREE.Object3D | null {
    return this.#board?.obj ?? null;
  }

  /** The building is robbed: a blast, then it burns in ruins until mended. */
  async hit(protocolId: string, blast = true): Promise<void> {
    if (this.#disposed || this.#hits.has(protocolId)) return;
    const root = this.#host.building(protocolId);
    if (!root) return;
    const hit: Hit = { protocolId, objs: [], figures: [] };
    this.#hits.set(protocolId, hit);
    root.updateMatrixWorld(true);
    // the building itself (its body), not the walkway and porch about it
    const model = findModel(root);
    const box = new THREE.Box3().setFromObject((model && byName(model, 'body')) ?? root);
    const size = box.getSize(new THREE.Vector3());
    const foot = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2);
    if (blast && this.#has.get('fx.blast')) {
      const obj = this.#host.make('fx.blast');
      obj.position.copy(foot);
      obj.scale.setScalar(Math.max(1, Math.max(size.x, size.z) / 4));
      const clips = this.#host.clips('fx.blast');
      const figure = new Figure(obj, clips, ['pop']);
      figure.react('pop', false);
      this.#host.add(obj);
      this.#oneShots.push({ figure, until: this.#time + (clips.find((c) => c.name === 'pop')?.duration ?? 1.6) });
    }
    // the ruin file of the building's model, laid on it as a child (like the winter snow)
    const ruinName = model ? model.name + RUIN : null;
    if (ruinName && !this.#has.has(ruinName)) this.#has.set(ruinName, await this.#host.load(ruinName));
    if (this.#disposed || this.#hits.get(protocolId) !== hit) return;
    const fires: THREE.Object3D[] = [];
    let smoke: THREE.Object3D | null = null;
    if (model && ruinName && this.#has.get(ruinName)) {
      const ruin = this.#host.make(ruinName);
      (byName(model, 'body') ?? model).add(ruin);
      hit.objs.push(ruin);
      ruin.traverse((o) => {
        const n = (o.userData.name as string | undefined) ?? o.name;
        if (/^fire\.\d$/.test(n)) fires.push(o);
        if (n === 'smoke') smoke = o;
      });
    }
    // without a ruin file: fires along the roof's top
    if (!fires.length) {
      const top = new THREE.Group();
      top.position.set(foot.x, box.max.y - size.y * 0.3, foot.z);
      this.#host.add(top);
      hit.objs.push(top);
      for (const dx of [-0.25, 0.25]) {
        const at = new THREE.Object3D();
        at.position.set(dx * size.x, 0, 0);
        top.add(at);
        fires.push(at);
      }
      smoke = top;
    }
    for (const at of fires) this.#loop(hit, 'fx.fire', at, 1);
    if (smoke) this.#loop(hit, 'fx.smoke.column', smoke, 1);
    // rubble at two corners of its foot, soot under it
    if (this.#has.get('prop.rubble')) {
      [
        [box.min.x, box.max.z, 'rubble.m'],
        [box.max.x, box.max.z, 'rubble.s'],
      ].forEach(([x, z, node]) => {
        const obj = this.#host.make('prop.rubble');
        obj.traverse((o) => {
          const n = (o.userData.name as string | undefined) ?? o.name;
          if (/^rubble\./.test(n)) o.visible = n === node;
        });
        // at its front corners, a little in from the plot's edge (its box takes in the porch and the quay)
        obj.position.set(foot.x + ((x as number) - foot.x) * 0.45, 0, foot.z + ((z as number) - foot.z) * 0.6);
        this.#host.add(obj);
        hit.objs.push(obj);
      });
    }
    if (this.#has.get('fx.scorch')) {
      const scorch = this.#host.make('fx.scorch');
      scorch.position.copy(foot);
      scorch.scale.setScalar(Math.max(size.x, size.z) / 3 + 0.3);
      this.#host.add(scorch);
      hit.objs.push(scorch);
    }
  }

  /** The money came back: the building stands whole again. */
  mend(protocolId: string): void {
    const hit = this.#hits.get(protocolId);
    if (!hit) return;
    this.#hits.delete(protocolId);
    for (const f of hit.figures) f.dispose();
    for (const o of hit.objs) o.removeFromParent();
  }

  /** A coin frozen in a block of ice beside the keep (USDT its issuer froze), or thawed. */
  freeze(on: boolean): void {
    if (!on) {
      this.#ice?.removeFromParent();
      this.#ice = null;
      return;
    }
    if (this.#ice || !this.#has.get('fx.ice')) return;
    const keep = this.#host.keep();
    if (!keep) return;
    const box = new THREE.Box3().setFromObject(keep);
    const centre = box.getCenter(new THREE.Vector3());
    const ice = this.#host.make('fx.ice');
    if (this.#has.get('fx.coin')) {
      // upright in the pocket on the block's front, at its `coin` point
      const coin = this.#host.make('fx.coin');
      const at = byName(ice, 'coin');
      coin.rotation.x = Math.PI / 2;
      (at ?? ice).add(coin);
      if (!at) coin.position.set(0, 0.16, 0.06);
    }
    // in front of the keep, on the town's side (+z), big enough to read from above
    ice.position.set(centre.x + 0.8, 0, box.max.z + 0.9);
    ice.scale.setScalar(ICE_SCALE);
    this.#host.add(ice);
    this.#ice = ice;
  }

  /** What is shown, for tests: notes pinned, buildings hit, ice. */
  state(): { pinned: number; board: boolean; hit: string[]; ice: boolean } {
    return { pinned: this.#pinned, board: this.#board !== null, hit: [...this.#hits.keys()], ice: this.#ice !== null };
  }

  /** Back to the town before the story: no hits, no ice, an empty board. */
  reset(): void {
    for (const id of [...this.#hits.keys()]) this.mend(id);
    this.freeze(false);
    this.#pinned = 0;
    if (this.#board) this.board(0);
  }

  update(dt: number): void {
    this.#time += dt;
    this.#board?.figure.update(dt);
    for (const hit of this.#hits.values()) for (const f of hit.figures) f.update(dt);
    this.#oneShots = this.#oneShots.filter((s) => {
      s.figure.update(dt);
      if (this.#time < s.until) return true;
      s.figure.dispose();
      s.figure.object.removeFromParent();
      return false;
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.reset();
    this.#board?.figure.dispose();
    this.#board?.obj.removeFromParent();
    this.#board = null;
  }

  /** A looping effect (fire, smoke) set at a point, as its child. */
  #loop(hit: Hit, name: string, at: THREE.Object3D, scale: number): void {
    if (!this.#has.get(name)) return;
    const obj = this.#host.make(name);
    obj.scale.setScalar(scale);
    at.add(obj);
    const figure = new Figure(obj, this.#host.clips(name));
    figure.play('idle');
    hit.objs.push(obj);
    hit.figures.push(figure);
  }
}

/** The building's model under its placed root (its name is the asset's, e.g. `building.category.bridge.m`). */
function findModel(root: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && /^building\./.test(o.name) && !o.name.endsWith('.snow') && !o.name.endsWith(RUIN)) found = o;
  });
  return found;
}

/** A node by its name in the file (glTF loading drops the dots: `note.0` is `note0`, the original kept in userData.name). */
function byName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && ((o.userData.name as string | undefined) ?? o.name) === name) found = o;
  });
  return found;
}
