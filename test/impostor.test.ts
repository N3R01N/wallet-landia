import { describe, expect, it } from 'vitest';
import { sideSeen } from '../src/render/three/impostor.js';

describe('impostor sides', () => {
  // models face +z at yaw 0; the side is chosen from where the camera stands
  it('sees the front when the person faces the camera, the back when facing away', () => {
    expect(sideSeen(0, 0, 10)).toBe(0); // facing +z, camera at +z
    expect(sideSeen(Math.PI, 0, 10)).toBe(2);
  });
  it('sees a profile from either side', () => {
    expect(sideSeen(Math.PI / 2, 0, 10)).toBe(1); // facing +x, camera at +z: as baked at a quarter turn
    expect(sideSeen(-Math.PI / 2, 0, 10)).toBe(3);
    expect(sideSeen(0, 10, 0)).toBe(3); // facing +z, camera off to +x
  });
});
