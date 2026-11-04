export interface ApiRow {
	name: string;
	type: string;
	default?: string;
	description: string;
}

export const WORLD_OPTIONS: ApiRow[] = [
	{ name: 'maxRegions', type: 'number', default: '6', description: 'Size of the region pool: independent voxel volumes alive at once. Extra clusters are force-merged (smallest volume increase first).' },
	{ name: 'regionResolution', type: 'number', default: '128', description: 'Edge length of each region texture in voxels (multiple of 16, max 160). Memory per region ≈ 2 × res³ × 8 B + light + shadow.' },
	{ name: 'maxParticles', type: 'number', default: '32768', description: 'Billows voxelised per frame across all regions.' },
	{ name: 'maxBinEntries', type: 'number', default: '600000', description: 'Budget of (billow, brick) pairs per frame. A region that would exceed it is coarsened one LOD step.' },
	{ name: 'quality', type: "QualityPreset | Partial<QualitySettings>", default: "'high'", description: "'low' | 'medium' | 'high' | 'ultra', or individual settings merged over 'high'." },
	{ name: 'adaptive', type: 'boolean | { enabled?, targetFps? }', default: '{ enabled: true, targetFps: 60 }', description: 'Dynamic resolution + LOD bias steering the smoothed frame time toward the target.' },
	{ name: 'groundHeight', type: 'number', default: '0', description: 'Y of the collision plane for billows.' },
	{ name: 'wind', type: '[x, y, z]', default: '[1.5, 0, 0.5]', description: 'Wind velocity in m/s, scaled per effect by physics.windInfluence.' },
	{ name: 'sun', type: 'Partial<SunSettings>', default: '', description: '{ direction (toward the sun), color (linear), intensity } used by the light volume and raymarcher.' },
	{ name: 'ambient', type: 'Partial<AmbientSettings>', default: '', description: '{ sky, ground, intensity } ambient terms. Sky light is occluded by the precomputed upward visibility.' },
];

export const WORLD_METHODS: ApiRow[] = [
	{ name: 'init()', type: 'Promise<void>', description: 'Generates the tileable detail-noise volume on the GPU. Call once after `await renderer.init()`.' },
	{ name: 'spawn(def, position?, options?)', type: 'VoluxelEffect', description: 'Starts an effect. `def` is an EffectDefinition or a preset id. Options: scale, seed, rotation (yaw), look overrides, timeOffset.' },
	{ name: 'update(dt, camera)', type: 'void', description: 'Simulates billows, merges regions, picks LODs, culls, bins and dispatches the compute kernels. Call once per frame before rendering.' },
	{ name: 'createVolumePass(scenePass, camera)', type: '{ pass, composite(color) }', description: 'Reduced-resolution volume pass that reads the scene depth, plus a premultiplied-alpha composite function for your RenderPipeline.' },
	{ name: 'setDepthTexture(texture)', type: 'void', description: 'Use a different depth texture for occlusion (rebuilds region materials).' },
	{ name: 'receivedShadow()', type: 'Fn', description: 'Drop-in for `material.receivedShadowNode`: multiplies the sun shadow by the volumes\' transmittance.' },
	{ name: 'shadowNode', type: 'Node<float>', description: 'Transmittance toward the sun at positionWorld (all regions). Use it in custom shading.' },
	{ name: 'remove(effect, immediate?)', type: 'void', description: 'Stops an effect (billows die out) or deletes it immediately.' },
	{ name: 'clear()', type: 'void', description: 'Removes every effect.' },
	{ name: 'dispose()', type: 'void', description: 'Frees textures, kernels and materials.' },
];

export const WORLD_PROPS: ApiRow[] = [
	{ name: 'quality', type: 'QualitySettings', description: 'Live-editable quality knobs (see the Quality section).' },
	{ name: 'adaptive', type: '{ enabled, targetFps, scale }', description: '`scale` is the controller output (0.35–1) applied to render scale, LOD and step counts.' },
	{ name: 'sun / ambientLight / wind / groundHeight', type: '', description: 'Environment inputs, read every frame.' },
	{ name: 'timeScale / paused', type: 'number / boolean', description: 'Simulation clock control.' },
	{ name: 'debugView', type: "'none' | 'bricks' | 'lod' | 'albedo'", description: 'Visualise the sparse brick grid, LOD level per region, or unlit albedo.' },
	{ name: 'showRegionBounds', type: 'boolean', description: 'Shows region boxes (colour = LOD, grey = culled). Add `world.debug` to your scene.' },
	{ name: 'lights', type: 'THREE.Group', description: 'One point light per region, positioned at the emission centroid and driven by blackbody energy. Add to your scene.' },
	{ name: 'volumeScene', type: 'THREE.Scene', description: 'Holds the raymarched region boxes; rendered by the volume pass.' },
	{ name: 'flash', type: 'number', description: 'Peak detonation flash this frame. Drive exposure or bloom with it.' },
	{ name: 'stats', type: 'VoluxelStats', description: 'Effects, billows, regions (visible / culled), active bricks & voxels, bin entries, CPU timings and per-region LOD info.' },
];

export const QUALITY_ROWS: ApiRow[] = [
	{ name: 'renderScale', type: 'number', description: 'Volume pass resolution relative to the canvas (0.25–1). Biggest single cost lever.' },
	{ name: 'pixelsPerVoxel', type: 'number', description: 'LOD target. Each region uses the coarsest voxel size that still projects to this many volume-pass pixels.' },
	{ name: 'stepScale / maxSteps', type: 'number', description: 'Raymarch step length in voxels and the step cap.' },
	{ name: 'lightSteps', type: 'number', description: 'Steps of the half-resolution light-volume march toward the sun.' },
	{ name: 'detailShadowSteps', type: '0–4', description: 'Short sun rays per shaded sample that shade individual noise bumps.' },
	{ name: 'detail', type: 'number', description: 'Detail-noise erosion multiplier (0 disables).' },
	{ name: 'flowNoise', type: 'boolean', description: 'Advect the detail noise with the billow velocity field (two-phase flow noise).' },
	{ name: 'emptySpaceSkipping', type: 'boolean', description: 'Skip empty 8³ bricks using the occupancy grid.' },
	{ name: 'timeSlicing', type: 'boolean', description: 'Re-voxelise small / far regions every 2nd or 3rd frame.' },
	{ name: 'frustumCulling', type: 'boolean', description: 'Skip voxelisation & lighting for regions whose box and ground-shadow footprint are off screen.' },
	{ name: 'regionMerging', type: 'boolean', description: 'Merge overlapping effects into one voxel grid.' },
	{ name: 'shadows', type: 'boolean', description: 'Compute the sun-space deep opacity map used by receivers.' },
];

export const EFFECT_ROWS: ApiRow[] = [
	{ name: 'id / name / description', type: 'string', description: 'Identity. `id` is used by generateCode to reference built-ins.' },
	{ name: 'scale', type: 'number', default: '1', description: 'Default spawn scale.' },
	{ name: 'look', type: 'LookDefinition', description: 'Shading: albedo, surface threshold & softness, detail erosion, emission, glow, anisotropy.' },
	{ name: 'physics', type: 'PhysicsDefinition', description: 'Buoyancy, gravity, linear & quadratic drag, turbulence, wind influence, ground friction.' },
	{ name: 'emitters', type: 'EmitterDefinition[]', description: 'Burst, continuous and accrete emitters with shapes, velocities, billow specs and sub-billows.' },
	{ name: 'behaviors', type: 'BehaviorDefinition[]', description: 'Scripted flows on groups: vortexRing (mushroom cap), updraft (stem), attract.' },
	{ name: 'flash', type: '{ intensity, duration, color? }', description: 'Detonation light pulse.' },
	{ name: 'minVoxelSize', type: 'number', description: 'Finest voxel size the effect needs (m, multiplied by scale). Prevents wasting voxels on close-ups.' },
	{ name: 'lightIntensity', type: 'number', description: 'Multiplier for the fire point light.' },
	{ name: 'viewDistance', type: 'number', description: 'Suggested preview distance (m).' },
	{ name: 'duration / loop', type: 'number / boolean', description: 'Hard stop and automatic restart.' },
];

export const EMITTER_ROWS: ApiRow[] = [
	{ name: 'type', type: "'burst' | 'continuous' | 'accrete'", description: 'Accrete grows new billows on the surface of existing ones (convective towers, mushroom cap growth).' },
	{ name: 'shape', type: "'point' | 'sphere' | 'hemisphere' | 'disc' | 'ring' | 'column'", description: 'Spawn volume. `radius` sizes it; `thickness` is ring jitter, disc inner radius or column height.' },
	{ name: 'position', type: '[x, y, z]', description: 'Offset from the effect origin (rotated by the spawn yaw, scaled).' },
	{ name: 'start / duration', type: 'number', description: 'Timeline in seconds.' },
	{ name: 'count / rate / rateCurve', type: 'number / [from, to]', description: 'Burst size or spawn rate per second, optionally ramped over the duration.' },
	{ name: 'particle', type: 'ParticleSpec', description: 'radius, growth, growthDecay, maxGrowth, density, temperature, cooling, soot, life, fadeIn/Out, dissipation, buoyancy, drag, opacity. Ranges are [min, max].' },
	{ name: 'velocity', type: 'VelocitySpec', description: 'radial, directional + direction, random, swirl (m/s).' },
	{ name: 'children', type: '{ count, scale, distance, upBias? }', description: 'Sub-billows rigidly attached to every billow — the multi-scale cauliflower structure.' },
	{ name: 'group / source', type: 'string', description: 'Behaviour tag; accrete emitters grow from `source`.' },
];

export const LOOK_ROWS: ApiRow[] = [
	{ name: 'smokeColor / sootColor', type: '[r, g, b] linear', description: 'Albedo of clean smoke and of soot. Per-voxel soot fraction blends between them.' },
	{ name: 'threshold / softness', type: 'number', description: 'Surface iso-level of the billow field and its transition width.' },
	{ name: 'erosion / detailScale', type: 'number / metres', description: 'Billowy Worley erosion strength and the world size of the smallest bumps.' },
	{ name: 'emission / emissionThreshold', type: 'number', description: 'Blackbody emission multiplier and ignition temperature (normalised, 1 ≈ 2250 K).' },
	{ name: 'glow', type: 'number', description: 'Fire light scattered inside the surrounding smoke (from the light volume).' },
	{ name: 'scattering / anisotropy / ambient', type: 'number', description: 'Sun scattering gain, Henyey–Greenstein g, ambient gain.' },
];

export const PRESET_ROWS = [
	{ id: 'smokeExplosion', kind: 'Explosion', notes: 'Grey burst, skirt ring, lingering smoke. ~25 m.' },
	{ id: 'fireExplosion', kind: 'Explosion', notes: 'White-hot fireball → orange flame → black soot column. ~30 m.' },
	{ id: 'nuke', kind: 'Explosion', notes: 'Flash, vortex-ring mushroom cap, updraft stem, base surge. ~350 m tall.' },
	{ id: 'dustImpact', kind: 'Explosion', notes: 'Ballistic dust column and settling skirt (gravity).' },
	{ id: 'cumulus', kind: 'Volume', notes: 'Accreting cauliflower cloud matching the reference footage. ~80 m.' },
	{ id: 'smokePlume', kind: 'Volume', notes: 'Continuous oil-fire column bent by wind.' },
	{ id: 'inferno', kind: 'Volume', notes: 'Large ground fire with soot ceiling.' },
];
