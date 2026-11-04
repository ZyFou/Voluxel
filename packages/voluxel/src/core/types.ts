/**
 * Public data model. Every effect is plain JSON so it can be exported from the
 * playground, stored, diffed and re-imported in any three.js scene.
 */

export type Vec3Tuple = [ number, number, number ];
export type Range = [ number, number ];
export type ColorTuple = [ number, number, number ];

export type EmitterShape = 'point' | 'sphere' | 'hemisphere' | 'disc' | 'ring' | 'column';

export interface ParticleSpec {
	/** Billow radius in metres, sampled uniformly from the range. */
	radius: Range;
	/** Radius growth in metres per second (expansion / entrainment). */
	growth?: Range;
	/** Exponential decay of the growth rate (1/s). */
	growthDecay?: number;
	/** Upper bound for the radius as a multiple of the spawn radius. */
	maxGrowth?: number;
	/** Field density contributed at the billow centre (dimensionless, ~1 = opaque core). */
	density: Range;
	/** Normalised temperature (0 = ambient, 1 ≈ 2300 K, 2 ≈ 4000 K). */
	temperature?: Range;
	/** Exponential cooling rate (1/s). */
	cooling?: number;
	/** 0 = white condensate / dust, 1 = black soot. */
	soot?: Range;
	/** Lifetime in seconds. */
	life: Range;
	/** Fraction of the lifetime used to fade in / out. */
	fadeIn?: number;
	fadeOut?: number;
	/** Exponential density dissipation (1/s). */
	dissipation?: number;
	/** Multiplies the effect-level buoyancy for this emitter's billows. */
	buoyancy?: number;
	/** Multiplies the effect-level drag. */
	drag?: number;
	/** Optical thickness multiplier (extinction per particle radius). */
	opacity?: number;
}

export interface VelocitySpec {
	/** Speed away from the emitter centre (m/s). */
	radial?: Range;
	/** Speed along `direction` (m/s). */
	directional?: Range;
	direction?: Vec3Tuple;
	/** Random isotropic speed (m/s). */
	random?: number;
	/** Tangential swirl around the emitter's Y axis (m/s). */
	swirl?: Range;
}

export interface ChildSpec {
	/** Number of sub-billows attached to every billow (cauliflower detail). */
	count: number;
	/** Child radius as a fraction of the parent radius. */
	scale: Range;
	/** Distance of the child centre from the parent centre, in parent radii. */
	distance: Range;
	/** Children are biased toward +Y (0 = uniform, 1 = upper hemisphere). */
	upBias?: number;
}

export interface EmitterDefinition {
	/** Optional name, used by behaviours via `group`. */
	name?: string;
	/** `burst` spawns `count` at `start`; `continuous` spawns `rate`/s during `duration`; `accrete` grows new billows on existing ones. */
	type: 'burst' | 'continuous' | 'accrete';
	shape: EmitterShape;
	/** Emitter-local offset from the effect origin (m). */
	position?: Vec3Tuple;
	/** Shape radius (m). For `ring`, the ring radius; for `column`, the column radius. */
	radius?: number;
	/** Inner radius for `ring` / `disc` (m), or height for `column`. */
	thickness?: number;
	start?: number;
	duration?: number;
	count?: number;
	rate?: number;
	/** Rate multiplier curve over the emitter duration: [t0 value, t1 value]. */
	rateCurve?: Range;
	particle: ParticleSpec;
	velocity?: VelocitySpec;
	children?: ChildSpec;
	/** Behaviour group tag (e.g. `cap`, `stem`). */
	group?: string;
	/** For `accrete`: emitter to grow from (defaults to its own group). */
	source?: string;
}

export interface VortexRingBehavior {
	type: 'vortexRing';
	group: string;
	/** Poloidal speed (m/s) at the ring core. */
	strength: number;
	/** Ring radius as fraction of the group's horizontal radius. */
	radiusFactor?: number;
	/** Core thickness as fraction of ring radius. */
	coreFactor?: number;
	/** Horizontal spreading speed of the ring (m/s): entrainment that widens a mushroom cap. */
	expansion?: number;
	start?: number;
	duration?: number;
}

export interface UpdraftBehavior {
	type: 'updraft';
	group: string;
	/** Group whose underside the updraft feeds (e.g. the mushroom cap). */
	target?: string;
	/** Upward speed (m/s). */
	strength: number;
	/** Radial convergence speed toward the axis (m/s). */
	inflow?: number;
	start?: number;
	duration?: number;
}

export interface AttractBehavior {
	type: 'attract';
	group: string;
	/** Group centroid to attract toward. */
	target: string;
	strength: number;
	start?: number;
	duration?: number;
}

export type BehaviorDefinition = VortexRingBehavior | UpdraftBehavior | AttractBehavior;

export interface LookDefinition {
	/** Albedo of clean smoke / condensate (linear RGB). */
	smokeColor: ColorTuple;
	/** Albedo of soot (linear RGB). */
	sootColor: ColorTuple;
	/** Field value where the surface starts (0..1). Higher = thinner, crisper billows. */
	threshold: number;
	/** Width of the surface transition. Lower = harder cauliflower edges. */
	softness: number;
	/** Detail-noise erosion strength (0..1). */
	erosion: number;
	/** World-space size of the detail noise (m). */
	detailScale: number;
	/** Emission multiplier for hot gas. */
	emission: number;
	/** Temperature at which emission becomes visible. */
	emissionThreshold?: number;
	/** How much fire light bounces inside surrounding smoke. */
	glow: number;
	/** Multiplier on sunlight scattering. */
	scattering?: number;
	/** Henyey-Greenstein forward anisotropy. */
	anisotropy?: number;
	/** Multiplier on ambient sky light. */
	ambient?: number;
}

export interface PhysicsDefinition {
	gravity?: number;
	/** Upward acceleration per unit temperature (m/s²). */
	buoyancy?: number;
	/** Linear drag (1/s). */
	drag?: number;
	/** Quadratic drag (1/m), dominant for fast explosive ejecta. */
	quadraticDrag?: number;
	turbulence?: { amplitude: number; frequency: number; speed?: number };
	/** 0 = ignores wind, 1 = fully carried by wind. */
	windInfluence?: number;
	/** Horizontal friction on the ground (1/s). */
	groundFriction?: number;
	/** Fraction of a billow radius allowed below the ground. */
	groundSink?: number;
}

export interface FlashDefinition {
	/** Peak intensity of the scene light at detonation. */
	intensity: number;
	/** Seconds for the flash to decay. */
	duration: number;
	color?: ColorTuple;
}

export interface EffectDefinition {
	id: string;
	name: string;
	description?: string;
	/** Default spawn scale. */
	scale?: number;
	/** Hard stop in seconds (the effect is removed once all billows are gone). */
	duration?: number;
	/** Restart automatically when finished. */
	loop?: boolean;
	look: LookDefinition;
	physics: PhysicsDefinition;
	emitters: EmitterDefinition[];
	behaviors?: BehaviorDefinition[];
	flash?: FlashDefinition;
	/** Finest voxel size this effect needs (m, before scale). */
	minVoxelSize?: number;
	/** Fire light multiplier. */
	lightIntensity?: number;
	/** Suggested camera distance for previews (m, before scale). */
	viewDistance?: number;
}

export interface SpawnOptions {
	scale?: number;
	seed?: number;
	/** Rotation around Y in radians. */
	rotation?: number;
	/** Partial overrides merged into the definition's look. */
	look?: Partial<LookDefinition>;
	/** Start the effect this many seconds into its timeline. */
	timeOffset?: number;
}

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
	/** Volume pass resolution relative to the canvas. */
	renderScale: number;
	/** Target screen pixels per voxel; the main LOD knob. */
	pixelsPerVoxel: number;
	/** Raymarch step length in voxels. */
	stepScale: number;
	maxSteps: number;
	/** Light-volume march steps toward the sun. */
	lightSteps: number;
	/** Short per-sample shadow rays for billow-scale self shadowing (0-3). */
	detailShadowSteps: number;
	/** Detail noise strength multiplier (0 disables noise sampling). */
	detail: number;
	/** Advect detail noise with the billow velocity field. */
	flowNoise: boolean;
	/** Skip empty bricks while raymarching. */
	emptySpaceSkipping: boolean;
	/** Update small / distant regions every 2nd or 3rd frame. */
	timeSlicing: boolean;
	/** Skip voxelisation & lighting of regions outside the frustum (shadow aware). */
	frustumCulling: boolean;
	/** Merge overlapping effects into shared voxel regions. */
	regionMerging: boolean;
	/** Ground / receiver shadows. */
	shadows: boolean;
}

export interface SunSettings {
	direction: Vec3Tuple;
	color: ColorTuple;
	intensity: number;
}

export interface AmbientSettings {
	sky: ColorTuple;
	ground: ColorTuple;
	intensity: number;
}

export interface VoluxelStats {
	effects: number;
	particles: number;
	regions: number;
	visibleRegions: number;
	culledRegions: number;
	voxelizedRegions: number;
	activeBricks: number;
	activeVoxels: number;
	binEntries: number;
	cpuSimMs: number;
	cpuBinMs: number;
	qualityScale: number;
	regionInfo: RegionInfo[];
}

export interface RegionInfo {
	slot: number;
	effects: number;
	voxelSize: number;
	dims: Vec3Tuple;
	activeBricks: number;
	lod: number;
	visible: boolean;
	updatedThisFrame: boolean;
}
