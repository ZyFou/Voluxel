import type { EffectDefinition } from '../core/types';

/**
 * Built-in effects. All values are metres / seconds at `scale = 1`. Every preset is plain
 * JSON: clone it, tweak it, export it.
 */

export const cumulus: EffectDefinition = {
	id: 'cumulus',
	name: 'Cumulus growth',
	description: 'Dense cauliflower cloud that grows by accretion, like convective towers. Matches the reference footage.',
	viewDistance: 190,
	minVoxelSize: 0.35,
	lightIntensity: 0,
	look: {
		smokeColor: [ 0.9, 0.9, 0.91 ], sootColor: [ 0.4, 0.4, 0.42 ],
		threshold: 0.22, softness: 0.18, erosion: 0.66, detailScale: 2.0,
		emission: 0, glow: 0, anisotropy: 0.55, scattering: 0.85, ambient: 0.85,
	},
	physics: {
		buoyancy: 1.6, drag: 0.6, turbulence: { amplitude: 0.6, frequency: 0.03, speed: 0.4 },
		windInfluence: 0.3, groundSink: 0.3,
	},
	emitters: [
		{
			name: 'seed', type: 'burst', shape: 'column', position: [ 0, 6, 0 ], radius: 20, thickness: 9, count: 18, group: 'cloud',
			particle: {
				radius: [ 7, 11 ], growth: [ 1.2, 2.5 ], growthDecay: 0.12, maxGrowth: 1.6, density: [ 1.1, 1.4 ],
				temperature: [ 0.08, 0.16 ], cooling: 0.04, soot: [ 0, 0.08 ], life: [ 45, 60 ], fadeIn: 0.05, fadeOut: 0.18, opacity: 1.3,
			},
			children: { count: 5, scale: [ 0.32, 0.52 ], distance: [ 0.7, 1.0 ], upBias: 0.55 },
		},
		{
			name: 'towers', type: 'accrete', shape: 'point', source: 'cloud', group: 'cloud', start: 0.5, duration: 24, rate: 8, rateCurve: [ 1, 0.25 ],
			particle: {
				radius: [ 4, 8 ], growth: [ 0.8, 1.8 ], growthDecay: 0.12, maxGrowth: 1.7, density: [ 1.1, 1.35 ],
				temperature: [ 0.1, 0.2 ], cooling: 0.05, soot: [ 0, 0.1 ], life: [ 38, 50 ], fadeIn: 0.08, fadeOut: 0.2, opacity: 1.3,
			},
			children: { count: 4, scale: [ 0.32, 0.5 ], distance: [ 0.7, 1.0 ], upBias: 0.45 },
		},
	],
};

export const smokeExplosion: EffectDefinition = {
	id: 'smokeExplosion',
	name: 'Smoke explosion',
	description: 'Low-yield blast: brief flash, dense grey smoke punched outward, ground skirt, slow buoyant drift.',
	viewDistance: 60,
	minVoxelSize: 0.12,
	lightIntensity: 1,
	flash: { intensity: 1.5, duration: 0.2, color: [ 1, 0.7, 0.4 ] },
	look: {
		smokeColor: [ 0.34, 0.33, 0.32 ], sootColor: [ 0.05, 0.045, 0.04 ],
		threshold: 0.2, softness: 0.22, erosion: 0.62, detailScale: 0.55, scattering: 0.85,
		emission: 1.5, emissionThreshold: 0.3, glow: 1.2, anisotropy: 0.55,
	},
	physics: {
		buoyancy: 4, drag: 1.2, quadraticDrag: 0.08, turbulence: { amplitude: 1.5, frequency: 0.08, speed: 1 },
		windInfluence: 0.6, groundFriction: 2,
	},
	emitters: [
		{
			name: 'core', type: 'burst', shape: 'sphere', position: [ 0, 1.2, 0 ], radius: 1.5, count: 40,
			velocity: { radial: [ 12, 24 ], random: 4, directional: [ 2, 6 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.5, 2.8 ], growth: [ 3, 6 ], growthDecay: 0.8, maxGrowth: 3.5, density: [ 1.0, 1.35 ],
				temperature: [ 0.45, 0.75 ], cooling: 3.5, soot: [ 0.35, 0.6 ], life: [ 9, 14 ], fadeOut: 0.5, dissipation: 0.03,
			},
			children: { count: 3, scale: [ 0.5, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.3 },
		},
		{
			name: 'skirt', type: 'burst', shape: 'ring', position: [ 0, 0.5, 0 ], radius: 1.2, thickness: 0.6, count: 30,
			velocity: { radial: [ 9, 17 ], directional: [ 0, 2 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.2, 2.2 ], growth: [ 2, 4 ], growthDecay: 0.7, maxGrowth: 3, density: [ 0.9, 1.2 ],
				temperature: [ 0.08, 0.15 ], cooling: 1, soot: [ 0.2, 0.35 ], life: [ 7, 11 ], fadeOut: 0.5, dissipation: 0.04,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.5, 0.8 ], upBias: 0.4 },
		},
		{
			name: 'linger', type: 'continuous', shape: 'sphere', position: [ 0, 1.5, 0 ], radius: 2, start: 0.15, duration: 1.4, rate: 10, rateCurve: [ 1, 0 ],
			velocity: { radial: [ 2, 6 ], directional: [ 1, 3 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 2, 3.2 ], growth: [ 1.5, 3 ], growthDecay: 0.4, maxGrowth: 2.5, density: [ 0.9, 1.2 ],
				temperature: [ 0.2, 0.35 ], cooling: 1, soot: [ 0.3, 0.5 ], life: [ 10, 14 ], fadeOut: 0.5, dissipation: 0.03,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.4 },
		},
	],
};

export const fireExplosion: EffectDefinition = {
	id: 'fireExplosion',
	name: 'Fire explosion',
	description: 'Fuel-air fireball: white-hot core rolling into orange flame, collapsing into a rising black soot column.',
	viewDistance: 75,
	minVoxelSize: 0.12,
	lightIntensity: 1.2,
	flash: { intensity: 3, duration: 0.35, color: [ 1, 0.6, 0.3 ] },
	look: {
		smokeColor: [ 0.36, 0.34, 0.32 ], sootColor: [ 0.03, 0.025, 0.02 ],
		threshold: 0.2, softness: 0.22, erosion: 0.62, detailScale: 0.6,
		emission: 1.4, emissionThreshold: 0.25, glow: 1.4, anisotropy: 0.5,
	},
	physics: {
		buoyancy: 5, drag: 1.0, quadraticDrag: 0.06, turbulence: { amplitude: 2, frequency: 0.1, speed: 1 },
		windInfluence: 0.5, groundFriction: 2,
	},
	emitters: [
		{
			name: 'fireball', type: 'burst', shape: 'sphere', position: [ 0, 2, 0 ], radius: 2, count: 60,
			velocity: { radial: [ 10, 22 ], random: 3, directional: [ 2, 6 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.8, 3.2 ], growth: [ 3, 6 ], growthDecay: 0.7, maxGrowth: 3.5, density: [ 1.0, 1.3 ],
				temperature: [ 0.7, 1.6 ], cooling: 0.38, soot: [ 0.6, 0.9 ], life: [ 8, 12 ], fadeOut: 0.5, dissipation: 0.02,
			},
			children: { count: 3, scale: [ 0.45, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.4 },
		},
		{
			name: 'fuel', type: 'continuous', shape: 'sphere', position: [ 0, 3, 0 ], radius: 3, start: 0.05, duration: 0.8, rate: 30, rateCurve: [ 1, 0 ],
			velocity: { radial: [ 4, 10 ], directional: [ 2, 5 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.2, 2.2 ], growth: [ 2, 4 ], growthDecay: 0.7, maxGrowth: 3, density: [ 0.9, 1.2 ],
				temperature: [ 1.1, 1.6 ], cooling: 0.5, soot: [ 0.75, 0.95 ], life: [ 6, 9 ], fadeOut: 0.5, dissipation: 0.02,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.4 },
		},
		{
			name: 'dust', type: 'burst', shape: 'ring', position: [ 0, 0.5, 0 ], radius: 2, thickness: 1, count: 24,
			velocity: { radial: [ 8, 14 ], directional: [ 0, 2 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.2, 2 ], growth: [ 2, 3.5 ], growthDecay: 0.6, maxGrowth: 3, density: [ 0.8, 1.1 ],
				temperature: [ 0.05, 0.12 ], cooling: 1, soot: [ 0.1, 0.25 ], life: [ 6, 9 ], fadeOut: 0.5, dissipation: 0.05,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.5, 0.8 ], upBias: 0.4 },
		},
	],
};

export const nuke: EffectDefinition = {
	id: 'nuke',
	name: 'Nuclear detonation',
	description: 'Flash, white-hot fireball, toroidal vortex lifting the mushroom cap, dusty updraft stem and an expanding base surge.',
	viewDistance: 950,
	minVoxelSize: 1.5,
	lightIntensity: 1.5,
	flash: { intensity: 80, duration: 1.6, color: [ 1, 0.92, 0.8 ] },
	look: {
		smokeColor: [ 0.62, 0.5, 0.4 ], sootColor: [ 0.17, 0.11, 0.07 ],
		threshold: 0.18, softness: 0.26, erosion: 0.6, detailScale: 6,
		emission: 1.3, emissionThreshold: 0.32, glow: 2.2, anisotropy: 0.5, scattering: 0.9,
	},
	physics: {
		buoyancy: 9, drag: 0.35, quadraticDrag: 0.004, turbulence: { amplitude: 4, frequency: 0.012, speed: 0.6 },
		windInfluence: 0.2, groundFriction: 1,
	},
	emitters: [
		{
			name: 'fireball', type: 'burst', shape: 'sphere', position: [ 0, 40, 0 ], radius: 20, count: 90, group: 'cap',
			velocity: { radial: [ 25, 50 ], random: 6 },
			particle: {
				radius: [ 18, 30 ], growth: [ 10, 20 ], growthDecay: 0.5, maxGrowth: 2.4, density: [ 1.2, 1.5 ],
				temperature: [ 1.8, 2.15 ], cooling: 0.12, soot: [ 0.35, 0.6 ], life: [ 60, 75 ], fadeIn: 0.005, fadeOut: 0.2,
			},
			children: { count: 3, scale: [ 0.45, 0.6 ], distance: [ 0.6, 0.9 ], upBias: 0.2 },
		},
		{
			name: 'capGrowth', type: 'accrete', shape: 'point', source: 'cap', group: 'cap', start: 1, duration: 12, rate: 22, rateCurve: [ 1, 0.3 ],
			particle: {
				radius: [ 10, 20 ], growth: [ 4, 9 ], growthDecay: 0.3, maxGrowth: 2, density: [ 1.1, 1.4 ],
				temperature: [ 1.1, 1.4 ], cooling: 0.16, soot: [ 0.35, 0.6 ], life: [ 50, 62 ], fadeIn: 0.02, fadeOut: 0.2,
			},
			children: { count: 3, scale: [ 0.45, 0.6 ], distance: [ 0.6, 0.9 ], upBias: 0.3 },
		},
		{
			name: 'stem', type: 'continuous', shape: 'disc', position: [ 0, 2, 0 ], radius: 14, start: 1, duration: 28, rate: 26, rateCurve: [ 1, 0.35 ], group: 'stem',
			velocity: { directional: [ 12, 22 ], direction: [ 0, 1, 0 ], random: 2 },
			particle: {
				radius: [ 6, 10 ], growth: [ 1.5, 3 ], growthDecay: 0.2, maxGrowth: 1.7, density: [ 0.9, 1.2 ],
				temperature: [ 0.3, 0.45 ], cooling: 0.05, soot: [ 0.3, 0.45 ], life: [ 16, 24 ], fadeIn: 0.05, fadeOut: 0.3,
			},
			children: { count: 2, scale: [ 0.45, 0.6 ], distance: [ 0.55, 0.85 ], upBias: 0.3 },
		},
		{
			name: 'baseSurge', type: 'burst', shape: 'ring', position: [ 0, 3, 0 ], radius: 30, thickness: 12, start: 0.35, count: 160, group: 'surge',
			velocity: { radial: [ 40, 70 ], directional: [ 0, 4 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 10, 18 ], growth: [ 4, 8 ], growthDecay: 0.3, maxGrowth: 2.5, density: [ 0.9, 1.2 ],
				temperature: [ 0.05, 0.1 ], cooling: 0.2, soot: [ 0.15, 0.25 ], life: [ 28, 40 ], fadeOut: 0.35, dissipation: 0.02, drag: 1.5,
			},
			children: { count: 2, scale: [ 0.45, 0.65 ], distance: [ 0.55, 0.85 ], upBias: 0.5 },
		},
	],
	behaviors: [
		{ type: 'vortexRing', group: 'cap', strength: 22, radiusFactor: 0.75, coreFactor: 0.45, expansion: 9, start: 1.5 },
		{ type: 'updraft', group: 'stem', target: 'cap', strength: 18, inflow: 10, start: 0.8 },
	],
};

export const dustImpact: EffectDefinition = {
	id: 'dustImpact',
	name: 'Dust impact',
	description: 'Artillery-style ground impact: ballistic dust column, rolling tan skirt that settles under gravity.',
	viewDistance: 55,
	minVoxelSize: 0.1,
	lightIntensity: 0.6,
	flash: { intensity: 2, duration: 0.15, color: [ 1, 0.75, 0.5 ] },
	look: {
		smokeColor: [ 0.66, 0.55, 0.42 ], sootColor: [ 0.2, 0.15, 0.1 ],
		threshold: 0.18, softness: 0.3, erosion: 0.6, detailScale: 0.6,
		emission: 1.0, emissionThreshold: 0.35, glow: 0.8, anisotropy: 0.6,
	},
	physics: {
		gravity: 4, buoyancy: 1.5, drag: 1.3, quadraticDrag: 0.05, turbulence: { amplitude: 1.2, frequency: 0.1, speed: 1 },
		windInfluence: 0.7, groundFriction: 2.5,
	},
	emitters: [
		{
			name: 'column', type: 'burst', shape: 'hemisphere', position: [ 0, 0.3, 0 ], radius: 1, count: 34,
			velocity: { directional: [ 10, 26 ], direction: [ 0, 1, 0 ], radial: [ 3, 8 ] },
			particle: {
				radius: [ 1, 2 ], growth: [ 2, 3.5 ], growthDecay: 0.6, maxGrowth: 3, density: [ 0.9, 1.2 ],
				temperature: [ 0.05, 0.4 ], cooling: 4, soot: [ 0.05, 0.2 ], life: [ 8, 12 ], fadeOut: 0.5, dissipation: 0.04,
			},
			children: { count: 3, scale: [ 0.5, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.3 },
		},
		{
			name: 'skirt', type: 'burst', shape: 'ring', position: [ 0, 0.4, 0 ], radius: 1.5, thickness: 0.6, count: 40,
			velocity: { radial: [ 8, 16 ], directional: [ 0, 3 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.2, 2.2 ], growth: [ 2.5, 4 ], growthDecay: 0.5, maxGrowth: 3, density: [ 0.85, 1.15 ],
				temperature: [ 0.02, 0.06 ], cooling: 1, soot: [ 0.05, 0.15 ], life: [ 9, 13 ], fadeOut: 0.5, dissipation: 0.04,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.5, 0.8 ], upBias: 0.5 },
		},
	],
};

export const smokePlume: EffectDefinition = {
	id: 'smokePlume',
	name: 'Smoke plume',
	description: 'Continuous oil-fire column: flames at the base feeding a dense black plume that bends with the wind.',
	viewDistance: 80,
	minVoxelSize: 0.15,
	lightIntensity: 0.8,
	look: {
		smokeColor: [ 0.3, 0.29, 0.28 ], sootColor: [ 0.035, 0.03, 0.028 ],
		threshold: 0.17, softness: 0.35, erosion: 0.5, detailScale: 0.9,
		emission: 1.6, emissionThreshold: 0.28, glow: 2, anisotropy: 0.55,
	},
	physics: {
		buoyancy: 3, drag: 0.8, turbulence: { amplitude: 1.2, frequency: 0.07, speed: 0.8 },
		windInfluence: 1, groundSink: 0.4,
	},
	emitters: [
		{
			name: 'smoke', type: 'continuous', shape: 'disc', position: [ 0, 0.8, 0 ], radius: 2, duration: 1e6, rate: 14,
			velocity: { directional: [ 3, 5 ], direction: [ 0, 1, 0 ], random: 1 },
			particle: {
				radius: [ 1.2, 2.0 ], growth: [ 0.8, 1.5 ], growthDecay: 0.08, maxGrowth: 5, density: [ 0.95, 1.25 ],
				temperature: [ 0.5, 0.7 ], cooling: 0.25, soot: [ 0.7, 0.9 ], life: [ 14, 18 ], fadeIn: 0.04, fadeOut: 0.4, dissipation: 0.03,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.3 },
		},
		{
			name: 'flames', type: 'continuous', shape: 'disc', position: [ 0, 0.6, 0 ], radius: 1.6, duration: 1e6, rate: 22,
			velocity: { directional: [ 2, 4 ], direction: [ 0, 1, 0 ], random: 1 },
			particle: {
				radius: [ 0.6, 1.1 ], growth: [ 0.5, 1 ], growthDecay: 0.5, maxGrowth: 2.5, density: [ 0.7, 1.0 ],
				temperature: [ 1.0, 1.4 ], cooling: 2.5, soot: [ 0.4, 0.6 ], life: [ 0.8, 1.4 ], fadeIn: 0.1, fadeOut: 0.5,
			},
		},
	],
};

export const inferno: EffectDefinition = {
	id: 'inferno',
	name: 'Inferno',
	description: 'Large ground fire: licking flame billows, glowing undersides and a soot ceiling. Runs until removed.',
	viewDistance: 45,
	minVoxelSize: 0.08,
	lightIntensity: 1.2,
	look: {
		smokeColor: [ 0.26, 0.25, 0.24 ], sootColor: [ 0.035, 0.03, 0.028 ],
		threshold: 0.15, softness: 0.35, erosion: 0.6, detailScale: 0.5,
		emission: 1.8, emissionThreshold: 0.25, glow: 2.5, anisotropy: 0.5,
	},
	physics: {
		buoyancy: 5, drag: 1.2, turbulence: { amplitude: 2, frequency: 0.15, speed: 1.2 },
		windInfluence: 0.8, groundSink: 0.4,
	},
	emitters: [
		{
			name: 'flames', type: 'continuous', shape: 'disc', position: [ 0, 0.3, 0 ], radius: 4, duration: 1e6, rate: 45,
			velocity: { directional: [ 3, 6 ], direction: [ 0, 1, 0 ], random: 1.5 },
			particle: {
				radius: [ 0.7, 1.4 ], growth: [ 0.4, 0.8 ], growthDecay: 0.5, maxGrowth: 2.5, density: [ 0.8, 1.1 ],
				temperature: [ 1.1, 1.6 ], cooling: 1.6, soot: [ 0.3, 0.6 ], life: [ 1.2, 2.2 ], fadeIn: 0.08, fadeOut: 0.5,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.5, 0.8 ], upBias: 0.3 },
		},
		{
			name: 'smoke', type: 'continuous', shape: 'disc', position: [ 0, 3, 0 ], radius: 3, duration: 1e6, rate: 12,
			velocity: { directional: [ 3, 5 ], direction: [ 0, 1, 0 ] },
			particle: {
				radius: [ 1.5, 2.5 ], growth: [ 1, 2 ], growthDecay: 0.2, maxGrowth: 3, density: [ 0.9, 1.2 ],
				temperature: [ 0.4, 0.5 ], cooling: 0.3, soot: [ 0.8, 0.95 ], life: [ 10, 14 ], fadeIn: 0.05, fadeOut: 0.4, dissipation: 0.04,
			},
			children: { count: 2, scale: [ 0.5, 0.7 ], distance: [ 0.55, 0.85 ], upBias: 0.3 },
		},
	],
};

export const PRESETS: Record<string, EffectDefinition> = {
	smokeExplosion, fireExplosion, nuke, dustImpact, cumulus, smokePlume, inferno,
};

export const PRESET_GROUPS: { label: string; ids: string[] }[] = [
	{ label: 'Explosions', ids: [ 'smokeExplosion', 'fireExplosion', 'nuke', 'dustImpact' ] },
	{ label: 'Realistic volumes', ids: [ 'cumulus', 'smokePlume', 'inferno' ] },
];

export function getPreset( id: string ): EffectDefinition {

	const p = PRESETS[ id ];
	if ( ! p ) throw new Error( `voluxel: unknown preset "${ id }". Available: ${ Object.keys( PRESETS ).join( ', ' ) }` );
	return p;

}

/** Deep clone, so presets can be edited without mutating the built-ins. */
export function clonePreset( def: EffectDefinition ): EffectDefinition {

	return JSON.parse( JSON.stringify( def ) );

}
