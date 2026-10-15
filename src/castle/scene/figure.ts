/**
 * One animated figure: its object and, when its model has clips, a mixer that
 * cross-fades between them (a courier, a building's person, an animal, a
 * building playing its idle and its tap).
 */

import * as THREE from 'three';

/** Cross-fade between clips (s). */
const FADE = 0.25;

export class Figure {
  readonly object: THREE.Object3D;
  readonly #mixer: THREE.AnimationMixer | null;
  readonly #actions = new Map<string, THREE.AnimationAction>();
  #current: string | null = null;
  /** A one-shot reaction playing (`react`), whether over the clip playing or instead of it, and the clip asked for meanwhile. */
  #reaction: THREE.AnimationAction | null = null;
  #over = false;
  #wanted: string | null = null;

  constructor(object: THREE.Object3D, clips: readonly THREE.AnimationClip[], once: readonly string[] = []) {
    this.object = object;
    // skinned figures: their bounds do not follow the animation
    object.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
    this.#mixer = clips.length ? new THREE.AnimationMixer(object) : null;
    for (const clip of clips) {
      const action = this.#mixer!.clipAction(clip);
      if (once.includes(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.#actions.set(clip.name, action);
    }
    this.#mixer?.addEventListener('finished', (e) => {
      if (e.action === this.#reaction) this.#endReaction();
    });
  }

  /** Whether the model has this clip. */
  has(name: string): boolean {
    return this.#actions.has(name);
  }

  /** Whether a reaction is playing. */
  get reacting(): boolean {
    return this.#reaction !== null;
  }

  /**
   * Plays a one-shot clip (a tap's reaction): over the clip playing (`over`: a
   * building's tap moves other parts than its idle), or instead of it, going
   * back to it after. False when the model has no such clip.
   */
  react(name: string, over: boolean): boolean {
    const action = this.#actions.get(name);
    if (!action) return false;
    if (this.#reaction) return true;
    this.#reaction = action;
    this.#over = over;
    if (!over) {
      if (this.#current) this.#actions.get(this.#current)?.fadeOut(FADE);
      this.#wanted = this.#current;
      this.#current = null;
    }
    action.reset().fadeIn(over ? 0 : FADE).play();
    return true;
  }

  #endReaction(): void {
    const action = this.#reaction!;
    this.#reaction = null;
    if (this.#over) {
      action.stop(); // it ends at rest: its parts stay there
      return;
    }
    const wanted = this.#wanted;
    this.#wanted = null;
    if (wanted) this.play(wanted);
    action.fadeOut(FADE);
  }

  /** Forgets the clip playing, so the next `play` starts afresh (a person going back inside, to come out again later). */
  rest(): void {
    this.#mixer?.stopAllAction();
    this.#current = null;
    this.#reaction = null;
    this.#wanted = null;
  }

  /** Plays a clip, cross-fading from the one before. Unknown clips leave the figure as it is. */
  play(name: string): void {
    if (this.#reaction && !this.#over) {
      this.#wanted = name; // after the reaction
      return;
    }
    if (name === this.#current) return;
    const next = this.#actions.get(name);
    if (!next) return;
    const prev = this.#current ? this.#actions.get(this.#current) : undefined;
    next.reset().fadeIn(FADE).play();
    prev?.fadeOut(FADE);
    this.#current = name;
  }

  update(dt: number): void {
    this.#mixer?.update(dt);
  }

  dispose(): void {
    this.#mixer?.stopAllAction();
    this.#mixer?.uncacheRoot(this.object);
  }
}
