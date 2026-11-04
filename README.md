# Voluxel

WebGPU voxel smoke, fire and explosion volumes for three.js (r187+), plus a React + shadcn/ui playground with live settings, API docs and code export.

```
packages/voluxel   the library (ESM + .d.ts, three.js as a peer dependency)
apps/web           playground + API documentation (Vite, React 19, Tailwind 4, shadcn/ui)
```

## Run

```bash
npm install
npm run dev          # playground on http://localhost:5173
npm run build        # builds the library, then the site
```

Needs a browser with WebGPU (Chrome / Edge 113+, Safari 26+).

## How it works

1. **Billows (CPU)**: emitters spawn spheres with buoyancy, quadratic drag, divergence-free turbulence, wind and ground contact. Sub-billows ride on their parents for the multi-scale cauliflower look. Scripted behaviours build the mushroom cloud (vortex ring + updraft).
2. **Region merging**: effects whose bounds overlap share one voxel region (one raymarch, mutual shadowing). When the pool is full, the pair with the smallest union volume merges.
3. **LOD**: each region picks its voxel size from screen coverage, the effect's detail floor and the texture budget, on a quarter-octave ladder with hysteresis. Small or far regions are time-sliced.
4. **Culling**: region bounds plus their sun-projected ground footprint are frustum tested; culled regions skip all GPU work.
5. **Chunks**: billows are counting-sorted into 8³ bricks. Only occupied bricks are voxelised and lit, bricks that emptied are cleared, and an occupancy grid drives empty-space skipping.
6. **GPU**: compute kernels voxelise, build a half-resolution light volume (sun transmittance, sky visibility, fire glow) and a sun-space deep-opacity shadow map. The raymarcher runs at reduced resolution with flow-advected billow noise, detail shadow rays, multiple-scattering octaves and blackbody emission, composited depth-aware with emission-only bloom.
7. **Adaptive quality** steers render scale, LOD and step counts toward a frame-rate target.

## Library quick start

```ts
import * as THREE from 'three/webgpu';
import { VoluxelWorld, createVoluxelPipeline } from 'voluxel';

const world = new VoluxelWorld( renderer, { quality: 'high', adaptive: { targetFps: 60 } } );
await world.init();
scene.add( world.lights );
ground.material.receivedShadowNode = world.receivedShadow();

const { pipeline } = createVoluxelPipeline( renderer, scene, camera, world, { bloom: true } );
world.spawn( 'nuke', [ 0, 0, 0 ] );

renderer.setAnimationLoop( () => {
  world.update( timer.getDelta(), camera );
  pipeline.render();
} );
```

Presets: `smokeExplosion`, `fireExplosion`, `nuke`, `dustImpact`, `cumulus`, `smokePlume`, `inferno`. Effects are plain JSON (`EffectDefinition`); the playground exports them along with ready-to-paste code.
