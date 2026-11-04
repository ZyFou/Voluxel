/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import {
	Fn, Loop, float, uint, vec3, vec4, uvec3, floor, fract, sin, dot, min, mix, length, instanceIndex,
	textureStore, uniform, smoothstep, clamp,
} from 'three/tsl';
import { blackbody } from '../core/math';

type N = any;

/** Uniforms shared by every region (kernels and materials reference the same nodes). */
export function createGlobalUniforms() {

	return {
		sunDir: uniform( new THREE.Vector3( 0.4, 0.8, 0.3 ).normalize() ),
		sunColor: uniform( new THREE.Color( 1, 0.96, 0.9 ).multiplyScalar( 6 ) ),
		skyColor: uniform( new THREE.Color( 0.45, 0.6, 0.85 ) ),
		groundColor: uniform( new THREE.Color( 0.18, 0.17, 0.16 ) ),
		ambient: uniform( 1.0 ),
		time: uniform( 0 ),
		frame: uniform( 0 ),
		maxSteps: uniform( 160, 'int' ),
		stepScale: uniform( 1.0 ),
		lightSteps: uniform( 24, 'int' ),
		detailShadowSteps: uniform( 2, 'int' ),
		detail: uniform( 1.0 ),
		flowNoise: uniform( 1.0 ),
		emptySpaceSkipping: uniform( 1.0 ),
		debugMode: uniform( 0, 'int' ),
		fogColor: uniform( new THREE.Color( 0.5, 0.55, 0.6 ) ),
		fogDensity: uniform( 0.0 ),
		exposure: uniform( 1.0 ),
		shadowStrength: uniform( 1.0 ),
	};

}

export type GlobalUniforms = ReturnType<typeof createGlobalUniforms>;

/** Linear-RGB blackbody emission LUT over normalised temperature [0, LUT_MAX_T]. */
export const LUT_MAX_T = 2.5;

export function createBlackbodyLUT(): THREE.DataTexture {

	const size = 256;
	const data = new Uint16Array( size * 4 );
	const c = [ 0, 0, 0 ];
	for ( let i = 0; i < size; i ++ ) {

		blackbody( ( i / ( size - 1 ) ) * LUT_MAX_T, c );
		data[ i * 4 + 0 ] = THREE.DataUtils.toHalfFloat( Math.min( c[ 0 ], 60000 ) );
		data[ i * 4 + 1 ] = THREE.DataUtils.toHalfFloat( Math.min( c[ 1 ], 60000 ) );
		data[ i * 4 + 2 ] = THREE.DataUtils.toHalfFloat( Math.min( c[ 2 ], 60000 ) );
		data[ i * 4 + 3 ] = THREE.DataUtils.toHalfFloat( 1 );

	}

	const tex = new THREE.DataTexture( data, size, 1, THREE.RGBAFormat, THREE.HalfFloatType );
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	tex.name = 'voluxel.blackbody';
	return tex;

}

// -----------------------------------------------------------------------------------------------
// Tileable detail noise volume (billowy inverted Worley fBm + value noise), generated once on GPU
// -----------------------------------------------------------------------------------------------

const hash33 = Fn( ( [ p ]: [ N ] ) => {

	const q = vec3(
		dot( p, vec3( 127.1, 311.7, 74.7 ) ),
		dot( p, vec3( 269.5, 183.3, 246.1 ) ),
		dot( p, vec3( 113.5, 271.9, 124.6 ) ),
	);
	return fract( sin( q ).mul( 43758.5453123 ) );

} );

const wrapCell = ( c: N, period: N ) => c.sub( period.mul( floor( c.div( period ) ) ) );

/** Tileable Worley F1 distance. `p` is in cell units, `period` the number of cells per tile. */
const worley = Fn( ( [ p, period ]: [ N, N ] ) => {

	const cell = floor( p );
	const f = fract( p );
	const minD = float( 8 ).toVar();
	( Loop as N )( 3, 3, 3, ( { i, j, k }: N ) => {

		const o = vec3( float( i ).sub( 1 ), float( j ).sub( 1 ), float( k ).sub( 1 ) );
		const h = hash33( wrapCell( cell.add( o ), period ) );
		const d = length( o.add( h ).sub( f ) );
		minD.assign( min( minD, d ) );

	} );
	return minD;

} );

/** Inverted, clamped Worley: round "billow" bumps. */
const billow = ( p: N, period: number ) => float( 1 ).sub( clamp( worley( p.mul( period ), float( period ) ), 0, 1 ) );

const valueNoise = Fn( ( [ p, period ]: [ N, N ] ) => {

	const c = floor( p );
	const f = fract( p );
	const u: N = f.mul( f ).mul( float( 3 ).sub( f.mul( 2 ) ) );
	const h = ( o: N ) => hash33( wrapCell( c.add( o ), period ) ).x;
	const x00 = mix( h( vec3( 0, 0, 0 ) ), h( vec3( 1, 0, 0 ) ), u.x );
	const x10 = mix( h( vec3( 0, 1, 0 ) ), h( vec3( 1, 1, 0 ) ), u.x );
	const x01 = mix( h( vec3( 0, 0, 1 ) ), h( vec3( 1, 0, 1 ) ), u.x );
	const x11 = mix( h( vec3( 0, 1, 1 ) ), h( vec3( 1, 1, 1 ) ), u.x );
	return mix( mix( x00, x10, u.y ), mix( x01, x11, u.y ), u.z );

} );

/** 64³ rgba8 = 1 MB: small enough to stay resident in L2 while raymarching. */
export const NOISE_SIZE = 64;

export function createNoiseVolume(): { texture: THREE.Storage3DTexture; compute: N } {

	const size = NOISE_SIZE;
	const texture = new THREE.Storage3DTexture( size, size, size );
	texture.name = 'voluxel.noise';
	texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
	texture.minFilter = texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;

	const kernel = Fn( () => {

		const idx = instanceIndex;
		const x = idx.mod( uint( size ) );
		const y = idx.div( uint( size ) ).mod( uint( size ) );
		const z = idx.div( uint( size * size ) );
		const uvw = vec3( float( x ), float( y ), float( z ) ).add( 0.5 ).div( size );

		const w4 = billow( uvw, 4 );
		const w8 = billow( uvw, 8 );
		const w16 = billow( uvw, 16 );
		const w32 = billow( uvw, 32 );

		const r = w4.mul( 0.625 ).add( w8.mul( 0.25 ) ).add( w16.mul( 0.125 ) );
		const g = w8.mul( 0.625 ).add( w16.mul( 0.25 ) ).add( w32.mul( 0.125 ) );
		const b = w16.mul( 0.6 ).add( w32.mul( 0.4 ) );
		const a = valueNoise( uvw.mul( 8 ), float( 8 ) ).mul( 0.5 )
			.add( valueNoise( uvw.mul( 16 ), float( 16 ) ).mul( 0.3 ) )
			.add( valueNoise( uvw.mul( 32 ), float( 32 ) ).mul( 0.2 ) );

		// sharpen the billows slightly so the cauliflower bumps read as round lobes
		const rs = smoothstep( 0.15, 0.95, r );
		textureStore( texture, uvec3( x, y, z ), vec4( rs, g, b, a ) );

	} );

	const compute = kernel().compute( size * size * size, [ 64 ] );
	return { texture, compute };

}
