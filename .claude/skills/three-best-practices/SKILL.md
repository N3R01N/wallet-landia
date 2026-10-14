---
name: three-best-practices
description: Three.js rules for wallet-landia's WebGL code (the castle view, src/castle/scene/** and src/castle/assets/**): freeing GPU memory, the render loop, pixel ratio, draw calls, instancing, shadows, animation mixers, textures and loading. Use when writing, reviewing or changing any WebGL view or three.js object.
---

# Three.js best practices (wallet-landia)

Target: plain WebGL with `WebGLRenderer` and `three/addons`, on the current three.js release. We do not use WebGPU or TSL. Our own helpers come first: `ModelLibrary` (one load per asset name, instances via `SkeletonUtils.clone`, standin fallback) and `disposeTree` in `src/castle/assets/models.ts`; the `Figure` class (one mixer per animated model, cross-faded clips) and `paint` (per-colour copies of the `Tint`/`Trim` materials) in `src/castle/scene/castleView.ts`.

## 1. Memory: free what you create, keep what you share

- A geometry, material or texture you **create** is disposed when its owner goes. Remove the mesh from the scene first, then dispose its geometry and material.
- A resource **shared** with other objects (theme materials, the material library, cached sprites, pooled geometry) is kept, not disposed. Check who else holds it before disposing. Our `keep()` marks shared resources.
- Textures: dispose a texture when no material uses it. A texture loaded after its view closed is disposed on arrival.
- Render targets: `renderTarget.dispose()` already frees its attached textures. Do not dispose those textures again.
- Renderers: when a `WebGLRenderer` is discarded, call `renderer.dispose()`, then `renderer.forceContextLoss()`. Browsers allow only a few WebGL contexts, so opening and closing views would otherwise exhaust them.
- Animated objects: before dropping one with an `AnimationMixer`, call `mixer.stopAllAction()` and `mixer.uncacheRoot(root)`. The mixer keeps references otherwise.
- Reuse: one geometry and one material shared by many meshes is cheap. Create them once, outside the frame loop.

## 2. Render loop

- Use `renderer.setAnimationLoop(fn)` for a WebGL view. Stop it with `setAnimationLoop(null)` when the view closes. This is the one loop per renderer.
- Keep one loop per renderer. Do not start a second `requestAnimationFrame` chain for the same view.
- Do not allocate in the loop: no `new Vector3`, `new Color` or materials per frame. Keep scratch objects on the class.
- Time motion with a delta (`clock.getDelta()`, or the `dt` passed in), not frame counts.
- On-demand rendering (draw only when something changed) is fine for static views, but it stops `enableDamping` from settling. If a view uses damping, keep the loop running while the controls are moving.

## 3. Pixel ratio, size and aspect

- Cap the pixel ratio: `renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))`.
- On resize: set the renderer size from the canvas's client size, then update `camera.aspect` and call `camera.updateProjectionMatrix()`.
- Shadow map sizes: 1024 on low quality, 2048 on medium and high for a small shadow area (our sun does this). Only enlarge it when the area it covers is large.

## 4. Draw calls and objects

- Merge static meshes that share a material (`mergeGeometries` after cloning and transforming each part; every input needs the same attributes).
- Use `InstancedMesh` for many copies of one thing (rows of identical props). Set `instanceMatrix.needsUpdate = true` after `setMatrixAt`.
- Hide with `visible = false` only for things you will show again soon. Remove and dispose things you will not show again.
- `frustumCulled = false` only for skinned meshes and anything whose bounds do not follow its animation (our rigged figures and fades do this).
- `matrixAutoUpdate = false` only for objects that never move. Children added later still need `updateMatrixWorld()`.
- Use `Group` to organise a hierarchy. `add()` changes a child's transform to its new parent's; `attach()` keeps its world transform.
- Use the cheapest material that looks right: `MeshBasicMaterial` for flat things, `MeshStandardMaterial` for lit surfaces, `MeshPhysicalMaterial` only where its extra lobes are visible.
- Enable `castShadow` and `receiveShadow` only on objects that show shadows.

## 5. Geometry

- Use `BufferGeometry`. `THREE.Geometry` was removed in r125.
- Indexed geometry (`setIndex`) with the smallest index type that fits. WebGL index buffers take 16- or 32-bit indices only.
- Low segment counts for flat or distant things. Use `THREE.LOD` when a close and a far version both exist.

## 6. Materials and textures

- Colour maps (`map`, `emissiveMap`) use `texture.colorSpace = THREE.SRGBColorSpace`. Data maps (normal, roughness, metalness) stay linear.
- Anisotropic filtering for ground and wall textures: `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()`.
- Mipmaps and non-power-of-two textures are fine on WebGL 2. Do not size textures to powers of two for their own sake.
- Transparency: prefer `alphaTest` for cut-outs and sorted transparency only where needed. Note that `alphaTest` compiles to a discard in the shader.
- If a shader needs patching, use `onBeforeCompile`: chain onto a material's existing hook rather than replacing it, and give patched materials a distinct `customProgramCacheKey`. (The castle has none today: runtime colours go through material copies, see `paint`.)
- Clone a material only when one object needs a different value; a clone is a new program and new state.

## 7. Loading and assets

- Prefer glTF/GLB for models. FBX is fine for animated characters we already import; convert once, do not load FBX at runtime when a GLB exists.
- Load asynchronously and use `Promise.all` for independent files. Show progress where the wait is long.
- Load optional assets after the critical ones, and only when the view needs them (the castle skips decorations whose model is missing instead of showing standins).
- A view owns its `ModelLibrary`: closing the view disposes the scene and the library together (`CastleView.dispose`).
- Compressed textures (KTX2) and Draco are worth it only for large assets that ship over the network; check the size first.

## 8. Animation

- Each animated character has one `AnimationMixer` and one update per frame. Call `mixer.update(dt)` once.
- Crossfade between clips with `fadeIn`/`fadeOut` (0.2–0.4 s), not by hard switching.
- Skinned meshes: keep the skeleton with the mesh when cloning (`SkeletonUtils.clone`), not `Object3D.clone`.

## 9. Lights

- Few lights, and only the ones that show. Count the shadow-casting lights first: shadows cost most.
- A hemisphere light plus one sun is the castle's whole setup (their intensities follow the hour).

## 10. Camera and controls

- Near and far planes as tight as the scene allows, since depth precision depends on the near/far ratio. The castle's orthographic camera uses 1 to 400, standing back along its view direction so a tall phone view's near ground is never clipped.
- Clamp orbit controls: `minDistance`, `maxDistance`, `minPolarAngle`, `maxPolarAngle`. Stop the camera going below the floor or into walls.

## 11. Debugging

- Use `renderer.info` while measuring; reset it with `autoReset = false` and `info.reset()` once per frame only if you need per-frame counts.
- Use `AxesHelper`, `GridHelper`, `CameraHelper` and `BoxHelper` while building; take them out before committing.
- Test hooks: read-only accessors (`castleView.state()`, `screenPoint()`, `courierPoint()`), exposed on `window` in the dev server only. Remove temporary probes before committing.

## Conflicts resolved for this repo

- **Loop:** `setAnimationLoop` (section 2), not hand-written `requestAnimationFrame`.
- **Patches vs. TSL:** use `onBeforeCompile` patches, not TSL.
- **Dispose vs. share:** keep anything shared, dispose only what the view created.
- **Damping vs. on-demand rendering:** keep the loop running while damping settles.

## Review checklist for a WebGL change

1. Every new geometry, material and texture has an owner that disposes it, or is kept as shared.
2. Closing the view stops the loop, disposes its own resources and forces the context loss.
3. No allocations inside the loop.
4. Pixel ratio capped; resize updates aspect and projection.
5. Animated objects have one mixer, uncached when dropped.
6. Test with the browser suite (`npm run check`) and a screenshot for anything visual.
