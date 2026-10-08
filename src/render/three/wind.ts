/**
 * Rooted wind for trees, bushes and grass.
 *
 * Mechanism adapted from the stylized meadow grass example in
 * threejs-awesome-graphics-agent-skills (MIT, (c) 2026 Scott Sun):
 * gust fronts travel across the field along the wind direction, a faster
 * "chop" band adds variation, and the bend grows with height above the
 * ground (the root never moves). Re-written here for instanced standard
 * materials, including their shadow-depth pass so shadows sway too.
 */

import * as THREE from 'three';

export const wind = {
  uTime: { value: 0 },
  /** 0 = still, ~0.35 = breezy, 1 = storm. */
  uStrength: { value: 0.3 },
  uDir: { value: new THREE.Vector2(Math.cos(0.6), Math.sin(0.6)) },
  uSpeed: { value: 1.6 },
  uGustScale: { value: 0.22 },
};

const DECL = /* glsl */ `
  uniform float uWindTime;
  uniform float uWindStrength;
  uniform vec2 uWindDir;
  uniform float uWindSpeed;
  uniform float uWindGustScale;
  uniform float uWindRefHeight;
  float windHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // Offset (in world space) for a vertex at world position w whose plant is rooted at origin.
  vec3 windOffset(vec3 w, vec3 origin) {
    float along = dot(origin.xz, uWindDir);
    float seed = windHash(origin.xz);
    float gust = pow(sin(along * uWindGustScale - uWindTime * uWindSpeed + seed * 1.4) * 0.5 + 0.5, 1.6);
    float chop = sin(along * uWindGustScale * 2.7 - uWindTime * uWindSpeed * 2.1 + seed * 6.2831) * 0.5 + 0.5;
    float intensity = (0.25 + gust * 0.85 + chop * 0.18) * (0.7 + seed * 0.6);
    float h = clamp(w.y / uWindRefHeight, 0.0, 1.0);
    float bend = uWindStrength * intensity * pow(h, 1.5) * uWindRefHeight * 0.35;
    vec2 side = vec2(-uWindDir.y, uWindDir.x);
    float flutter = sin(uWindTime * 7.0 + seed * 18.0) * 0.04 * uWindStrength * h;
    vec2 xz = uWindDir * bend + side * flutter;
    return vec3(xz.x, -bend * bend * 0.4, xz.y);
  }
`;

const PROJECT = /* glsl */ `
  vec4 mvPosition = vec4( transformed, 1.0 );
  vec3 windOrigin = vec3(0.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    windOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  mvPosition.xyz += windOffset(mvPosition.xyz, windOrigin);
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms, refHeight: number): void {
  shader.uniforms.uWindTime = wind.uTime;
  shader.uniforms.uWindStrength = wind.uStrength;
  shader.uniforms.uWindDir = wind.uDir;
  shader.uniforms.uWindSpeed = wind.uSpeed;
  shader.uniforms.uWindGustScale = wind.uGustScale;
  shader.uniforms.uWindRefHeight = { value: refHeight };
  shader.vertexShader = shader.vertexShader.replace('void main() {', `${DECL}\nvoid main() {`).replace('#include <project_vertex>', PROJECT);
}

/**
 * Make an instanced mesh sway. The model matrix of its parent group must be
 * identity (world == group space), which holds for the town group.
 */
export function applyWind(mesh: THREE.InstancedMesh, refHeight: number): void {
  const material = (mesh.material as THREE.MeshStandardMaterial).clone();
  material.onBeforeCompile = (shader) => patch(shader, refHeight);
  material.customProgramCacheKey = () => `wind:${refHeight}`;
  mesh.material = material;
  // Cut-out foliage (leaf cards) casts the shape of its leaves, not of its quads.
  const cutout = material.alphaTest > 0 && material.map ? { map: material.map, alphaTest: material.alphaTest } : {};
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, ...cutout });
  depth.onBeforeCompile = (shader) => patch(shader, refHeight);
  depth.customProgramCacheKey = () => `wind-depth:${refHeight}:${cutout.map ? 'cut' : ''}`;
  mesh.customDepthMaterial = depth;
}
