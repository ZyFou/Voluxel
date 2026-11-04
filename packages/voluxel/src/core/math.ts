import type { Range } from './types';

/** Small, fast, deterministic PRNG (mulberry32). Effects are reproducible from their seed. */
export class Rng {

	private s: number;

	constructor( seed = 1 ) {

		this.s = seed >>> 0 || 0x9e3779b9;

	}

	next(): number {

		let t = ( this.s += 0x6d2b79f5 );
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	range( r: Range | undefined, fallback = 0 ): number {

		if ( ! r ) return fallback;
		return r[ 0 ] + ( r[ 1 ] - r[ 0 ] ) * this.next();

	}

	/** Uniform direction on the unit sphere written into out[0..2]. */
	dir( out: Float32Array | number[], offset = 0 ): void {

		const z = this.next() * 2 - 1;
		const a = this.next() * Math.PI * 2;
		const r = Math.sqrt( 1 - z * z );
		out[ offset ] = r * Math.cos( a );
		out[ offset + 1 ] = z;
		out[ offset + 2 ] = r * Math.sin( a );

	}

}

export const clamp = ( v: number, a: number, b: number ) => ( v < a ? a : v > b ? b : v );
export const lerp = ( a: number, b: number, t: number ) => a + ( b - a ) * t;
export const smoothstep = ( a: number, b: number, v: number ) => {

	const t = clamp( ( v - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

/**
 * Divergence-free turbulence: a sum of rotated, phase-shifted ABC (Arnold–Beltrami–Childress)
 * flows. Each octave is analytically divergence free and rotations preserve that, so the sum
 * swirls like curl noise at a fraction of the cost (6 trig calls per octave, no lattice).
 */
const OCTAVES = 3;
const rot: number[][] = [];
const phase: number[] = [];
( () => {

	const rng = new Rng( 1337 );
	for ( let o = 0; o < OCTAVES; o ++ ) {

		// random rotation from a normalised quaternion
		let x = rng.next() * 2 - 1, y = rng.next() * 2 - 1, z = rng.next() * 2 - 1, w = rng.next() * 2 - 1;
		const l = Math.hypot( x, y, z, w );
		x /= l; y /= l; z /= l; w /= l;
		rot.push( [
			1 - 2 * ( y * y + z * z ), 2 * ( x * y - z * w ), 2 * ( x * z + y * w ),
			2 * ( x * y + z * w ), 1 - 2 * ( x * x + z * z ), 2 * ( y * z - x * w ),
			2 * ( x * z - y * w ), 2 * ( y * z + x * w ), 1 - 2 * ( x * x + y * y ),
		] );
		phase.push( rng.next() * 100 );

	}

} )();

export function turbulence( x: number, y: number, z: number, t: number, out: Float32Array ): void {

	let ox = 0, oy = 0, oz = 0;
	let f = 1, amp = 1;
	for ( let o = 0; o < OCTAVES; o ++ ) {

		const m = rot[ o ];
		const px = ( m[ 0 ] * x + m[ 1 ] * y + m[ 2 ] * z ) * f + phase[ o ] + t * 0.31 * f;
		const py = ( m[ 3 ] * x + m[ 4 ] * y + m[ 5 ] * z ) * f - t * 0.23 * f;
		const pz = ( m[ 6 ] * x + m[ 7 ] * y + m[ 8 ] * z ) * f + t * 0.17 * f;
		const A = 1.0, B = 0.8, C = 0.6;
		const vx = A * Math.sin( pz ) + C * Math.cos( py );
		const vy = B * Math.sin( px ) + A * Math.cos( pz );
		const vz = C * Math.sin( py ) + B * Math.cos( px );
		// rotate back (transpose)
		ox += ( m[ 0 ] * vx + m[ 3 ] * vy + m[ 6 ] * vz ) * amp;
		oy += ( m[ 1 ] * vx + m[ 4 ] * vy + m[ 7 ] * vz ) * amp;
		oz += ( m[ 2 ] * vx + m[ 5 ] * vy + m[ 8 ] * vz ) * amp;
		f *= 2.13;
		amp *= 0.5;

	}

	out[ 0 ] = ox * 0.6;
	out[ 1 ] = oy * 0.6;
	out[ 2 ] = oz * 0.6;

}

/**
 * Blackbody-ish emission ramp for a normalised temperature. Returns linear RGB radiance
 * (already multiplied by a Stefan–Boltzmann style intensity curve).
 */
export function blackbody( temperature: number, out: number[] = [ 0, 0, 0 ] ): number[] {

	const kelvin = 500 + temperature * 1750;
	const k = kelvin / 100;
	let r: number, g: number, b: number;
	// Tanner Helland's fit of the Planckian locus (sRGB 0..255)
	if ( k <= 66 ) {

		r = 255;
		g = clamp( 99.4708025861 * Math.log( k ) - 161.1195681661, 0, 255 );
		b = k <= 19 ? 0 : clamp( 138.5177312231 * Math.log( k - 10 ) - 305.0447927307, 0, 255 );

	} else {

		r = clamp( 329.698727446 * Math.pow( k - 60, - 0.1332047592 ), 0, 255 );
		g = clamp( 288.1221695283 * Math.pow( k - 60, - 0.0755148492 ), 0, 255 );
		b = 255;

	}

	const toLinear = ( c: number ) => {

		c /= 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 );

	};

	// Visible glow starts around 800 K. Radiance grows roughly with T^3 across the visible
	// fire range (a softened Stefan–Boltzmann curve keeps cores yellow instead of clipping white).
	const visible = smoothstep( 750, 1300, kelvin );
	const intensity = visible * Math.pow( kelvin / 1800, 3 );
	out[ 0 ] = toLinear( r ) * intensity;
	out[ 1 ] = toLinear( g ) * intensity;
	out[ 2 ] = toLinear( b ) * intensity;
	return out;

}
