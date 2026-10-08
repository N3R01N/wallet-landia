import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { trimHold } from '../src/render/three/rigged.js';

describe('mount clips', () => {
  it('a clip whose range runs past its motion is cut where the motion ends', () => {
    // legs swing for 1.33 s, then one key at 2.67 s holds the pose (the farm horse's Walk)
    const times = [0, 0.33, 0.67, 1, 1.33, 2.67];
    const swing = [0, 0.4, 0, -0.4, 0, 0];
    const clip = new THREE.AnimationClip('Walk', 2.67, [new THREE.NumberKeyframeTrack('leg.rotation[x]', times, swing), new THREE.NumberKeyframeTrack('tail.rotation[x]', [0, 2.67], [0, 0])]);
    trimHold(clip);
    expect(clip.duration).toBeCloseTo(1.33);
    expect(clip.tracks[0]!.times.at(-1)).toBeCloseTo(1.33);
  });

  it('a clip that moves to its end is left alone', () => {
    const clip = new THREE.AnimationClip('Run', 0.83, [new THREE.NumberKeyframeTrack('leg.rotation[x]', [0, 0.4, 0.83], [0, 1, 0.2])]);
    trimHold(clip);
    expect(clip.duration).toBeCloseTo(0.83);
  });
});
