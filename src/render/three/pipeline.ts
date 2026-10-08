/**
 * The 3D image pipeline. Signal order follows the image-pipeline / bloom /
 * exposure-color-grading skills (threejs-awesome-graphics-agent-skills, MIT):
 *
 *   scene (HDR, half-float) → GTAO (high tier) → bloom (in HDR, before tone
 *   mapping) → OutputPass (the single tone-map + sRGB owner) → cozy grade
 *   (display domain, after tone mapping)
 *
 * Rules kept from the skills:
 * - tone-map exactly once (materials render into a target, so they do not);
 * - bloom only adds to emissive things (windows, lamps, fire) that already
 *   read without it; the "nopost" debug view proves the town still reads;
 * - quality tiers change the mechanism, not just a label;
 * - the 2D overlay (labels, markers) is a separate canvas, so post never
 *   touches UI.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export type Quality = 'low' | 'medium' | 'high';
/** Debug views for validation: final frame, no post at all, AO only, no grade. */
export type DebugView = 'final' | 'nopost' | 'ao' | 'nograde';

/** Bloom calibrated in HDR: lit surfaces stay below ~1.1, emissives exceed it. */
export const BLOOM = { threshold: 1.3, strength: 0.38, radius: 0.22 } as const;

/** A gentle display-domain grade: warm lift in the shadows, a touch of vibrance. */
const CozyGrade = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uIntensity: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float shadow = 1.0 - smoothstep(0.12, 0.54, luma);
      float highlight = smoothstep(0.48, 0.92, luma);
      vec3 graded = c;
      graded += shadow * vec3(0.022, 0.010, -0.004);      // warm the shadows
      graded *= mix(vec3(1.0), vec3(1.02, 1.0, 0.97), highlight); // golden highlights
      float sat = max(max(graded.r, graded.g), graded.b) - min(min(graded.r, graded.g), graded.b);
      graded = mix(vec3(luma), graded, 1.0 + 0.12 * (1.0 - sat)); // vibrance
      gl_FragColor = vec4(mix(c, clamp(graded, 0.0, 1.0), uIntensity), src.a);
    }
  `,
};

export class ImagePipeline {
  readonly renderer: THREE.WebGLRenderer;
  quality: Quality;
  debug: DebugView = 'final';

  #scene: THREE.Scene;
  #camera: THREE.Camera;
  #composer: EffectComposer | null = null;
  #gtao: GTAOPass | null = null;
  #bloom: UnrealBloomPass | null = null;
  #grade: ShaderPass | null = null;
  #size = new THREE.Vector2();
  /** Objects the AO pass must not see (billboards would occlude as solid quads). */
  aoExclusions: () => THREE.Object3D[] = () => [];

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality) {
    this.renderer = renderer;
    this.#scene = scene;
    this.#camera = camera;
    this.quality = quality;
    renderer.toneMapping = THREE.NeutralToneMapping; // keeps the stylized palette's hues
    renderer.toneMappingExposure = 1.0;
    this.#build();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.#build();
  }

  /** Bloom stays proportionate to the moment: more at night, more in a storm. */
  setNight(night: number): void {
    if (this.#bloom) this.#bloom.strength = BLOOM.strength * (0.35 + 0.65 * night);
  }

  #build(): void {
    this.#composer?.dispose();
    this.#gtao?.dispose();
    this.#bloom?.dispose();
    this.#composer = null;
    this.#gtao = null;
    this.#bloom = null;
    this.#grade = null;
    if (this.quality === 'low') return;

    this.renderer.getSize(this.#size);
    const target = new THREE.WebGLRenderTarget(this.#size.x || 1, this.#size.y || 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.#scene, this.#camera));
    if (this.quality === 'high') {
      const gtao = new GTAOPass(this.#scene, this.#camera, this.#size.x || 1, this.#size.y || 1);
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0 });
      // GTAO renders its own depth/normal pass with an override material, which
      // ignores sprite alpha. Hide excluded objects for that pass only, and
      // always restore them (the bloom skill's substitution transaction rule).
      const render = gtao.render.bind(gtao);
      gtao.render = (...args: Parameters<GTAOPass['render']>) => {
        const hidden: THREE.Object3D[] = [];
        try {
          for (const o of this.aoExclusions()) {
            if (o.visible) {
              o.visible = false;
              hidden.push(o);
            }
          }
          render(...args);
        } finally {
          for (const o of hidden) o.visible = true;
        }
      };
      composer.addPass(gtao);
      this.#gtao = gtao;
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(this.#size.x || 1, this.#size.y || 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloom);
    this.#bloom = bloom;
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(CozyGrade);
    composer.addPass(grade);
    this.#grade = grade;
    this.#composer = composer;
  }

  setSize(w: number, h: number, dpr: number): void {
    const pixelRatio = this.quality === 'low' ? 1 : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.#composer?.setPixelRatio(pixelRatio);
    this.#composer?.setSize(w, h);
  }

  render(): void {
    const composer = this.#composer;
    if (composer === null || this.debug === 'nopost') {
      // Rendering straight to the screen: the renderer tone-maps here, once.
      this.renderer.render(this.#scene, this.#camera);
      return;
    }
    if (this.#gtao) this.#gtao.output = this.debug === 'ao' ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Default;
    if (this.#grade) this.#grade.uniforms.uIntensity!.value = this.debug === 'nograde' ? 0 : 1;
    if (this.#bloom) this.#bloom.enabled = this.debug !== 'ao';
    composer.render();
  }
}
