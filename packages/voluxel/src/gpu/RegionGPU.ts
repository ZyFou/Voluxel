/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, Break, Continue, float, int, uint, vec2, vec3, vec4, uvec2, uvec3, ivec3,
	floor, fract, dot, min, max, mix, exp, pow, abs, sign, sin, normalize, smoothstep, clamp, select,
	texture, texture3D, textureStore, uniform, workgroupId, localId, instanceIndex,
	positionWorld, cameraPosition, cameraWorldMatrix, cameraNear, cameraFar, screenUV, screenCoordinate,
	perspectiveDepthToViewZ, mrt,
} from 'three/tsl';
import type { GlobalUniforms } from './shared';
import { LUT_MAX_T } from './shared';

type N = any;
const LOD0: N = float( 0 );

export const BRICK = 8;
export const SHADOW_SIZE = 128;

export interface SharedGPU {
	globals: GlobalUniforms;
	particles: N;
	bricks: N;
	list: N;
	stale: N;
	noise: THREE.Storage3DTexture;
	lut: THREE.DataTexture;
}

/**
 * GPU resources of one voxel region slot: a sparse-brick density volume (sub-allocated
 * inside a fixed-size 3D texture), its half-resolution light volume, a sun-space shadow
 * map for receivers, the compute kernels that fill them and the raymarching proxy mesh.
 */
export class RegionGPU {

	readonly slot: number;
	readonly texSize: number;
	readonly bricksPerAxis: number;

	readonly texA: THREE.Storage3DTexture;
	readonly texB: THREE.Storage3DTexture;
	readonly texL: THREE.Storage3DTexture;
	readonly occupancy: THREE.Data3DTexture;
	readonly occData: Uint8Array;
	readonly shadowTex: THREE.StorageTexture;

	/** Bricks written last time this slot was voxelised (texture brick space). */
	readonly prevActive: Uint8Array;
	readonly currActive: Uint8Array;

	readonly u = {
		origin: uniform( new THREE.Vector3() ),
		voxelSize: uniform( 1 ),
		dims: uniform( new THREE.Vector3( 8, 8, 8 ) ),
		brickBase: uniform( 0, 'uint' ),
		staleBase: uniform( 0, 'uint' ),
		threshold: uniform( 0.2 ),
		softness: uniform( 0.35 ),
		erosion: uniform( 0.5 ),
		detailScale: uniform( 1 ),
		emission: uniform( 1 ),
		emissionThreshold: uniform( 0.25 ),
		glow: uniform( 1 ),
		/** 1 when any billow in the region is above ignition temperature. */
		glowOn: uniform( 1 ),
		scattering: uniform( 1 ),
		anisotropy: uniform( 0.55 ),
		ambientMul: uniform( 1 ),
		smokeColor: uniform( new THREE.Color( 0.9, 0.9, 0.9 ) ),
		sootColor: uniform( new THREE.Color( 0.05, 0.045, 0.04 ) ),
		lodTint: uniform( new THREE.Color( 1, 1, 1 ) ),
		// sun-space shadow map frame
		shadowCenter: uniform( new THREE.Vector3() ),
		shadowU: uniform( new THREE.Vector3( 1, 0, 0 ) ),
		shadowV: uniform( new THREE.Vector3( 0, 0, 1 ) ),
		shadowRect: uniform( new THREE.Vector4( - 1, - 1, 2, 2 ) ),
		shadowDepth: uniform( 100 ),
		shadowEnabled: uniform( 0 ),
	};

	readonly clearKernel: N;
	readonly voxelizeKernel: N;
	readonly lightKernel: N;
	readonly shadowKernel: N;

	readonly mesh: THREE.Mesh;
	material: THREE.NodeMaterial;

	private readonly shared: SharedGPU;

	constructor( slot: number, texSize: number, shared: SharedGPU, depthTexture: THREE.Texture | null ) {

		this.slot = slot;
		this.texSize = texSize;
		this.shared = shared;
		const B = texSize / BRICK;
		this.bricksPerAxis = B;

		const make3D = ( size: number, name: string ) => {

			const t = new THREE.Storage3DTexture( size, size, size );
			t.type = THREE.HalfFloatType;
			t.format = THREE.RGBAFormat;
			t.minFilter = t.magFilter = THREE.LinearFilter;
			t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
			t.generateMipmaps = false;
			t.name = `voluxel.region${ slot }.${ name }`;
			return t;

		};

		this.texA = make3D( texSize, 'density' );
		this.texB = make3D( texSize, 'velocity' );
		this.texL = make3D( texSize / 2, 'light' );

		this.occData = new Uint8Array( B * B * B );
		this.occupancy = new THREE.Data3DTexture( this.occData, B, B, B );
		this.occupancy.format = THREE.RedFormat;
		this.occupancy.type = THREE.UnsignedByteType;
		this.occupancy.minFilter = this.occupancy.magFilter = THREE.NearestFilter;
		this.occupancy.unpackAlignment = 1;
		this.occupancy.generateMipmaps = false;
		this.occupancy.needsUpdate = true;

		this.shadowTex = new THREE.StorageTexture( SHADOW_SIZE, SHADOW_SIZE );
		this.shadowTex.type = THREE.HalfFloatType;
		this.shadowTex.format = THREE.RGBAFormat;
		this.shadowTex.minFilter = this.shadowTex.magFilter = THREE.LinearFilter;
		this.shadowTex.generateMipmaps = false;
		this.shadowTex.name = `voluxel.region${ slot }.shadow`;

		this.prevActive = new Uint8Array( B * B * B );
		this.currActive = new Uint8Array( B * B * B );

		this.clearKernel = this.buildClearKernel();
		this.voxelizeKernel = this.buildVoxelizeKernel();
		this.lightKernel = this.buildLightKernel();
		this.shadowKernel = this.buildShadowKernel();

		this.material = this.buildMaterial( depthTexture );
		this.mesh = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), this.material );
		this.mesh.name = `voluxel.region${ slot }`;
		this.mesh.visible = false;
		this.mesh.matrixAutoUpdate = true;

	}

	// -------------------------------------------------------------------------------------------
	// Helpers shared by kernels
	// -------------------------------------------------------------------------------------------

	private decodeBrick( packed: N ): N {

		return uvec3( packed.bitAnd( uint( 255 ) ), packed.shiftRight( uint( 8 ) ).bitAnd( uint( 255 ) ), packed.shiftRight( uint( 16 ) ).bitAnd( uint( 255 ) ) );

	}

	/** Coarse shape density (1/m) from a density sample, no detail noise. */
	private shapeSigma( a: N ): N {

		const u = this.u;
		return smoothstep( u.threshold, u.threshold.add( u.softness ), a.x ).mul( a.w );

	}

	private sampleA( p: N ): N {

		return texture3D( this.texA, p.div( this.texSize ) ).level( LOD0 );

	}

	// -------------------------------------------------------------------------------------------
	// Kernels
	// -------------------------------------------------------------------------------------------

	/** Zeroes bricks that were active last update but not anymore (8 workgroups per brick). */
	private buildClearKernel(): N {

		const { stale } = this.shared;
		const u = this.u;
		const fn = Fn( () => {

			const wg = workgroupId.x;
			const lid = localId.x;
			const slot = wg.div( uint( 8 ) );
			const sub = wg.mod( uint( 8 ) );
			const vi = sub.mul( uint( 64 ) ).add( lid );
			const bc = this.decodeBrick( stale.element( u.staleBase.add( slot ) ) );
			const lc = uvec3( vi.bitAnd( uint( 7 ) ), vi.shiftRight( uint( 3 ) ).bitAnd( uint( 7 ) ), vi.shiftRight( uint( 6 ) ) );
			const vc = bc.mul( uint( 8 ) ).add( lc );
			textureStore( this.texA, vc, vec4( 0 ) );
			textureStore( this.texB, vc, vec4( 0 ) );
			If( sub.equal( uint( 0 ) ), () => {

				const ll = uvec3( lid.bitAnd( uint( 3 ) ), lid.shiftRight( uint( 2 ) ).bitAnd( uint( 3 ) ), lid.shiftRight( uint( 4 ) ) );
				textureStore( this.texL, bc.mul( uint( 4 ) ).add( ll ), vec4( 1, 1, 0, 0 ) );

			} );

		} );

		return fn().computeKernel( [ 64 ] ).setName( `voluxel.clear${ this.slot }` );

	}

	/** Gathers billows binned to each active brick into density / velocity voxels. */
	private buildVoxelizeKernel(): N {

		const { particles, bricks, list } = this.shared;
		const u = this.u;
		const fn = Fn( () => {

			const wg = workgroupId.x;
			const lid = localId.x;
			const slot = wg.div( uint( 8 ) );
			const sub = wg.mod( uint( 8 ) );
			const vi = sub.mul( uint( 64 ) ).add( lid );
			const entry = bricks.element( u.brickBase.add( slot ) );
			const bc = this.decodeBrick( entry.x );
			const lc = uvec3( vi.bitAnd( uint( 7 ) ), vi.shiftRight( uint( 3 ) ).bitAnd( uint( 7 ) ), vi.shiftRight( uint( 6 ) ) );
			const vc = bc.mul( uint( 8 ) ).add( lc );
			const pos = u.origin.add( vec3( vc ).add( 0.5 ).mul( u.voxelSize ) ).toVar();

			const sumW = float( 0 ).toVar();
			const sumT = float( 0 ).toVar();
			const sumS = float( 0 ).toVar();
			const sumK = float( 0 ).toVar();
			const sumV = vec3( 0 ).toVar();
			const off = entry.y;
			const cnt = entry.z;

			Loop( { start: uint( 0 ), end: cnt, type: 'uint', condition: '<' }, ( { i }: N ) => {

				const base = list.element( off.add( i ) ).mul( uint( 3 ) );
				const p0 = particles.element( base );
				const d = pos.sub( p0.xyz );
				const d2 = dot( d, d );
				const r2 = p0.w.mul( p0.w );
				If( d2.lessThan( r2 ), () => {

					const p1 = particles.element( base.add( uint( 1 ) ) );
					const p2 = particles.element( base.add( uint( 2 ) ) );
					const q = float( 1 ).sub( d2.div( r2 ) );
					const w = p1.x.mul( q ).mul( q );
					sumW.addAssign( w );
					sumT.addAssign( w.mul( p1.y ) );
					sumS.addAssign( w.mul( p1.z ) );
					sumK.addAssign( w.mul( p1.w ) );
					sumV.addAssign( p2.xyz.mul( w ) );

				} );

			} );

			const inv = float( 1 ).div( max( sumW, 1e-5 ) );
			textureStore( this.texA, vc, vec4( sumW, sumT.mul( inv ), sumS.mul( inv ), sumK.mul( inv ) ) );
			textureStore( this.texB, vc, vec4( sumV.mul( inv ), 0 ) );

		} );

		return fn().computeKernel( [ 64 ] ).setName( `voluxel.voxelize${ this.slot }` );

	}

	/**
	 * Precomputed lighting at half resolution, one workgroup (4³ light voxels) per brick:
	 * x = sun transmittance (geometric march), y = sky visibility (upward march),
	 * z = fire glow gathered from nearby hot voxels.
	 */
	private buildLightKernel(): N {

		const { bricks, globals: g } = this.shared;
		const u = this.u;
		const fn = Fn( () => {

			const slot = workgroupId.x;
			const lid = localId.x;
			const bc = this.decodeBrick( bricks.element( u.brickBase.add( slot ) ).x );
			const ll = uvec3( lid.bitAnd( uint( 3 ) ), lid.shiftRight( uint( 2 ) ).bitAnd( uint( 3 ) ), lid.shiftRight( uint( 4 ) ) );
			const lv = bc.mul( uint( 4 ) ).add( ll );
			const pG = vec3( lv ).add( 0.5 ).mul( 2.0 ).toVar();
			const dims = u.dims;
			const vs = u.voxelSize;

			// --- sun ---
			const tau = float( 0 ).toVar();
			const t = float( 1.0 ).toVar();
			const stepL = float( 1.0 ).toVar();
			Loop( { start: int( 0 ), end: g.lightSteps, type: 'int', condition: '<' }, () => {

				const p = pG.add( g.sunDir.mul( t ) );
				If( p.x.lessThan( 0 ).or( p.y.lessThan( 0 ) ).or( p.z.lessThan( 0 ) )
					.or( p.x.greaterThan( dims.x ) ).or( p.y.greaterThan( dims.y ) ).or( p.z.greaterThan( dims.z ) ), () => {

					Break();

				} );
				tau.addAssign( this.shapeSigma( this.sampleA( p ) ).mul( stepL ).mul( vs ) );
				// fully occluded: further samples cannot change exp(-tau) visibly
				If( tau.greaterThan( 6 ), () => {

					Break();

				} );
				t.addAssign( stepL );
				stepL.mulAssign( 1.12 );

			} );

			// --- sky (straight up, coarse) ---
			const tauS = float( 0 ).toVar();
			const ts = float( 1.5 ).toVar();
			const stepS = float( 1.5 ).toVar();
			Loop( 10, () => {

				const p = pG.add( vec3( 0, ts, 0 ) );
				If( p.y.greaterThan( dims.y ), () => {

					Break();

				} );
				tauS.addAssign( this.shapeSigma( this.sampleA( p ) ).mul( stepS ).mul( vs ) );
				If( tauS.greaterThan( 5 ), () => {

					Break();

				} );
				ts.addAssign( stepS );
				stepS.mulAssign( 1.35 );

			} );

			// --- fire glow: gather emitted radiance (blackbody luminance) from a 2-ring stencil ---
			const glow = float( 0 ).toVar();
			const lut = this.shared.lut;
			const emitter = ( p: N, w: number ) => {

				const a = this.sampleA( p );
				const rad = texture( lut, vec2( a.y.div( LUT_MAX_T ), 0.5 ) ).level( LOD0 ).rgb;
				const lum = dot( rad, vec3( 0.2126, 0.7152, 0.0722 ) ).mul( smoothstep( u.emissionThreshold, u.emissionThreshold.add( 0.2 ), a.y ) );
				glow.addAssign( lum.mul( smoothstep( u.threshold, u.threshold.add( u.softness ), a.x ) ).mul( w ) );

			};

			// regions without hot billows (CPU knows) skip the 29-tap gather entirely
			If( u.glowOn.greaterThan( 0.5 ), () => {

				emitter( pG, 1.0 );
				const dirs = [
					[ 1, 0, 0 ], [ - 1, 0, 0 ], [ 0, 1, 0 ], [ 0, - 1, 0 ], [ 0, 0, 1 ], [ 0, 0, - 1 ],
					[ 0.577, 0.577, 0.577 ], [ - 0.577, 0.577, 0.577 ], [ 0.577, - 0.577, 0.577 ], [ - 0.577, - 0.577, 0.577 ],
					[ 0.577, 0.577, - 0.577 ], [ - 0.577, 0.577, - 0.577 ], [ 0.577, - 0.577, - 0.577 ], [ - 0.577, - 0.577, - 0.577 ],
				];
				for ( const d of dirs ) {

					emitter( pG.add( vec3( d[ 0 ], d[ 1 ], d[ 2 ] ).mul( 3.5 ) ), 0.5 );
					emitter( pG.add( vec3( d[ 0 ], d[ 1 ], d[ 2 ] ).mul( 9.0 ) ), 0.22 );

				}

			} );

			// stencil weights sum to 1 + 14·0.5 + 14·0.22 ≈ 11
			textureStore( this.texL, lv, vec4( exp( tau.negate() ), exp( tauS.negate() ), glow.div( 11.0 ), 0 ) );

		} );

		return fn().computeKernel( [ 64 ] ).setName( `voluxel.light${ this.slot }` );

	}

	/**
	 * Sun-space "deep opacity" map for shadow receivers: per texel the total transmittance and
	 * the depth range (along the light) where density was met, so receivers inside or above the
	 * volume are not wrongly shadowed.
	 */
	private buildShadowKernel(): N {

		const { globals: g } = this.shared;
		const u = this.u;
		const S = SHADOW_SIZE;
		const fn = Fn( () => {

			const idx = instanceIndex;
			const x = idx.mod( uint( S ) );
			const y = idx.div( uint( S ) );
			const uv = vec2( float( x ), float( y ) ).add( 0.5 ).div( S );
			const su = u.shadowRect.x.add( uv.x.mul( u.shadowRect.z ) );
			const sv = u.shadowRect.y.add( uv.y.mul( u.shadowRect.w ) );
			const P = u.shadowCenter.add( u.shadowU.mul( su ) ).add( u.shadowV.mul( sv ) );
			const D = u.shadowDepth;
			const vs = u.voxelSize;
			const roG = P.add( g.sunDir.mul( D ) ).sub( u.origin ).div( vs ).toVar();
			const rd = g.sunDir.negate();
			const inv = vec3( 1 ).div( rd.add( sign( rd ).mul( 1e-6 ) ).add( vec3( 1e-7 ) ) );
			const tA = roG.negate().mul( inv );
			const tB = u.dims.sub( roG ).mul( inv );
			const tmin = min( tA, tB );
			const tmax = max( tA, tB );
			const t0 = max( max( max( tmin.x, tmin.y ), tmin.z ), 0 );
			const t1 = min( min( tmax.x, tmax.y ), tmax.z );

			const tau = float( 0 ).toVar();
			const first = float( - 1 ).toVar();
			const last = float( - 1 ).toVar();
			const t = t0.add( 0.75 ).toVar();
			const stepLen = 1.5;
			Loop( 200, () => {

				If( t.greaterThan( t1 ), () => {

					Break();

				} );
				const sigma = this.shapeSigma( this.sampleA( roG.add( rd.mul( t ) ) ) );
				If( sigma.greaterThan( 1e-3 ), () => {

					If( first.lessThan( 0 ), () => {

						first.assign( t );

					} );
					last.assign( t );

				} );
				tau.addAssign( sigma.mul( stepLen ).mul( vs ) );
				t.addAssign( stepLen );

			} );

			const hit = first.greaterThanEqual( 0 );
			const dE = select( hit, first.mul( vs ).sub( D ), D.negate() );
			const dX = select( hit, last.mul( vs ).sub( D ), D.negate() );
			textureStore( this.shadowTex, uvec2( x, y ), vec4( exp( tau.negate() ), dE, dX, 1 ) );

		} );

		return fn().compute( S * S, [ 64 ] ).setName( `voluxel.shadow${ this.slot }` );

	}

	// -------------------------------------------------------------------------------------------
	// Receiver shadow lookup (used by VoluxelWorld.shadowNode)
	// -------------------------------------------------------------------------------------------

	shadowAt( worldPos: N ): N {

		const u = this.u;
		const L = this.shared.globals.sunDir;
		const rel = worldPos.sub( u.shadowCenter );
		const uv = vec2(
			dot( rel, u.shadowU ).sub( u.shadowRect.x ).div( u.shadowRect.z ),
			dot( rel, u.shadowV ).sub( u.shadowRect.y ).div( u.shadowRect.w ),
		);
		const inside = uv.x.greaterThan( 0 ).and( uv.x.lessThan( 1 ) ).and( uv.y.greaterThan( 0 ) ).and( uv.y.lessThan( 1 ) );
		const s = texture( this.shadowTex, clamp( uv, 0.001, 0.999 ) );
		const dr = dot( rel, L.negate() );
		const f = clamp( dr.sub( s.y ).div( max( s.z.sub( s.y ), 0.01 ) ), 0, 1 );
		const T = mix( float( 1 ), s.x, f );
		return select( inside.and( u.shadowEnabled.greaterThan( 0.5 ) ), T, float( 1 ) );

	}

	// -------------------------------------------------------------------------------------------
	// Raymarch material
	// -------------------------------------------------------------------------------------------

	rebuildMaterial( depthTexture: THREE.Texture | null ): void {

		const old = this.material;
		this.material = this.buildMaterial( depthTexture );
		this.mesh.material = this.material;
		old.dispose();

	}

	private buildMaterial( depthTexture: THREE.Texture | null ): THREE.NodeMaterial {

		const { globals: g, noise, lut } = this.shared;
		const u = this.u;
		const T = this.texSize;
		const emissionOut = vec3( 0 ).toVar( 'voluxelEmission' );

		const hg = ( c: N, k: N ) => {

			const k2 = k.mul( k );
			return float( 1 ).sub( k2 ).div( pow( float( 1 ).add( k2 ).sub( k.mul( c ).mul( 2 ) ), 1.5 ) );

		};

		const detailNoise = ( pW: N, vel: N ): N => {

			const scale = float( 1 ).div( u.detailScale.mul( 4.0 ) );
			const base = pW.mul( scale );
			const period = 1.6;
			const ph1 = fract( g.time.div( period ) );
			const ph2 = fract( g.time.div( period ).add( 0.5 ) );
			const off = vel.mul( scale ).mul( period ).mul( g.flowNoise );
			const n1 = texture3D( noise, base.sub( off.mul( ph1 ) ) ).level( LOD0 );
			const n2 = texture3D( noise, base.sub( off.mul( ph2 ) ).add( vec3( 0.37, 0.11, 0.73 ) ) ).level( LOD0 );
			const w = abs( float( 1 ).sub( ph1.mul( 2 ) ) );
			return mix( n1, n2, w.mul( g.flowNoise ) );

		};

		/** Detail-eroded extinction (1/m). Multiplicative erosion keeps cores solid and carves surfaces. */
		const erodedSigma = ( a: N, n: N ): N => {

			const e = u.erosion.mul( g.detail ).mul( float( 1 ).sub( n.x.mul( 0.85 ).add( n.y.mul( 0.15 ) ) ) );
			const f = a.x.mul( float( 1 ).sub( e ) ).sub( e.mul( u.threshold ) );
			return smoothstep( u.threshold, u.threshold.add( u.softness ), f ).mul( a.w );

		};

		const frag = Fn( () => {

			const vs = u.voxelSize;
			const rd = normalize( positionWorld.sub( cameraPosition ) ).toVar();
			const roG = cameraPosition.sub( u.origin ).div( vs ).toVar();
			const inv = vec3( 1 ).div( rd.add( sign( rd ).mul( 1e-6 ) ).add( vec3( 1e-7 ) ) ).toVar();
			const tA = roG.negate().mul( inv );
			const tB = u.dims.sub( roG ).mul( inv );
			const tmin = min( tA, tB );
			const tmax = max( tA, tB );
			const t0 = max( max( max( tmin.x, tmin.y ), tmin.z ), 0 ).toVar();
			const t1 = min( min( tmax.x, tmax.y ), tmax.z ).toVar();

			if ( depthTexture ) {

				const depth = texture( depthTexture, screenUV ).x;
				const viewZ = perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
				const fwd = normalize( cameraWorldMatrix.mul( vec4( 0, 0, - 1, 0 ) ).xyz );
				const sceneDist = viewZ.negate().div( max( dot( rd, fwd ), 1e-3 ) );
				t1.assign( min( t1, sceneDist.div( vs ) ) );

			}

			const Tr = float( 1 ).toVar();
			const L = vec3( 0 ).toVar();
			// declared at function scope so the MRT output below can read it
			emissionOut.assign( vec3( 0 ) );

			If( t0.lessThan( t1 ), () => {

				// interleaved gradient noise, rotated per frame to break banding
				const fc = screenCoordinate.xy.add( g.frame.mod( 64 ).mul( 5.588238 ) );
				const ign = fract( float( 52.9829189 ).mul( fract( dot( fc, vec2( 0.06711056, 0.00583715 ) ) ) ) );
				const step = g.stepScale;
				const t = t0.add( ign.mul( step ) ).toVar();
				const cosT = dot( rd, g.sunDir );
				const gA = u.anisotropy;
				const phase = mix( hg( cosT, gA ), hg( cosT, float( - 0.3 ) ), 0.25 ).toVar();
				const phase2 = mix( hg( cosT, gA.mul( 0.5 ) ), float( 1 ), 0.3 ).toVar();
				const phase3 = hg( cosT, gA.mul( 0.25 ) ).toVar();
				const glowColor = vec3( 1.0, 0.42, 0.12 );
				const brickSize = float( 8 );

				Loop( { start: int( 0 ), end: g.maxSteps, type: 'int', condition: '<' }, () => {

					If( t.greaterThanEqual( t1 ), () => {

						Break();

					} );

					const p = roG.add( rd.mul( t ) ).toVar();

					// --- empty-space skipping on the brick occupancy grid ---
					If( g.emptySpaceSkipping.greaterThan( 0.5 ), () => {

						const bc = floor( p.div( brickSize ) );
						const occ = texture3D( this.occupancy ).load( ivec3( clamp( bc, vec3( 0 ), vec3( this.bricksPerAxis - 1 ) ) ) ).x;
						If( occ.lessThan( 0.5 ), () => {

							const bMin = bc.mul( brickSize );
							const bMax = bMin.add( brickSize );
							const tf = max( bMin.sub( roG ).mul( inv ), bMax.sub( roG ).mul( inv ) );
							const tExit = min( min( tf.x, tf.y ), tf.z );
							t.assign( max( tExit, t ).add( 0.02 ) );
							Continue();

						} );

						If( g.debugMode.equal( 1 ), () => {

							const h = fract( sin( vec3( dot( bc, vec3( 12.9898, 78.233, 37.719 ) ), dot( bc, vec3( 39.346, 11.135, 83.155 ) ), dot( bc, vec3( 73.156, 52.235, 9.151 ) ) ) ).mul( 43758.5453 ) );
							L.addAssign( h.mul( 0.04 ).mul( Tr ) );
							Tr.mulAssign( 0.985 );

						} );

					} );

					const uvw = p.div( T );
					const a = texture3D( this.texA, uvw ).level( LOD0 );

					If( a.x.greaterThan( u.threshold.mul( 0.25 ) ), () => {

						// Interior test: if even the strongest erosion keeps the field above the surface
						// band, the shape is saturated and noise cannot change the result.
						const eMax = u.erosion.mul( g.detail );
						const fMin = a.x.mul( float( 1 ).sub( eMax ) ).sub( eMax.mul( u.threshold ) );
						const nearSurface = fMin.lessThan( u.threshold.add( u.softness ) );
						const n = vec4( 0.5 ).toVar();
						If( nearSurface, () => {

							const pW = u.origin.add( p.mul( vs ) );
							// two-tap flow noise only while the sample is still visible; one tap deeper in
							If( Tr.greaterThan( 0.3 ), () => {

								n.assign( detailNoise( pW, texture3D( this.texB, uvw ).level( LOD0 ).xyz ) );

							} ).Else( () => {

								n.assign( texture3D( noise, pW.div( u.detailScale.mul( 4.0 ) ) ).level( LOD0 ) );

							} );

						} );
						const sigma = erodedSigma( a, n );

						If( sigma.greaterThan( 1e-4 ), () => {

							const li = texture3D( this.texL, uvw ).level( LOD0 );

							// short detail shadow rays: only the noise-induced difference is applied,
							// the coarse part is already in the light volume. Only near visible surfaces.
							const dTau = float( 0 ).toVar();
							If( nearSurface.and( Tr.greaterThan( 0.25 ) ), () => {

								Loop( { start: int( 0 ), end: g.detailShadowSteps, type: 'int', condition: '<' }, ( { i }: N ) => {

									const dist = float( i ).add( 1 ).mul( float( i ).add( 1 ) ).mul( 0.9 );
									const ps = p.add( g.sunDir.mul( dist ) );
									const as = texture3D( this.texA, ps.div( T ) ).level( LOD0 );
									const ns = texture3D( noise, u.origin.add( ps.mul( vs ) ).div( u.detailScale.mul( 4.0 ) ) ).level( LOD0 );
									const coarse = this.shapeSigma( as );
									dTau.addAssign( erodedSigma( as, ns ).sub( coarse ).mul( dist ).mul( vs ).mul( 0.6 ) );

								} );

							} );

							// erosion mostly removes density, so dTau skews negative; cap the brightening
							const sunT = clamp( li.x.mul( exp( clamp( dTau, - 0.4, 6.0 ).negate() ) ), 0, 1 );
							// Wrenninge-style multiple scattering octaves: each octave sees a thinner
							// medium (pow < 1), a weaker contribution and a more isotropic phase
							const ms = phase.mul( sunT )
								.add( phase2.mul( pow( sunT, 0.35 ) ).mul( 0.3 ) )
								.add( phase3.mul( pow( sunT, 0.12 ) ).mul( 0.07 ) );
							const sun = g.sunColor.mul( ms ).mul( u.scattering );
							const skyV = li.y;
							const amb = g.skyColor.mul( float( 0.3 ).add( skyV.mul( 0.7 ) ) ).add( g.groundColor.mul( 0.4 ) ).mul( g.ambient ).mul( u.ambientMul );
							const glowL = glowColor.mul( li.z ).mul( u.glow );
							const albedo = mix( u.smokeColor, u.sootColor, a.z );
							const scat = albedo.mul( sun.add( amb ).add( glowL ) ).mul( u.lodTint );

							// flame structure: temperature follows the billow lobes (hot lobes, cooler creases).
							// Ignition is gated on the unmodulated temperature so cooling gas fades out
							// smoothly instead of breaking into sub-voxel speckles.
							const em = vec3( 0 ).toVar();
							If( a.y.greaterThan( u.emissionThreshold ), () => {

								const temp = a.y.mul( float( 0.62 ).add( n.x.mul( 0.76 ) ) );
								em.assign( texture( lut, vec2( temp.div( LUT_MAX_T ), 0.5 ) ).level( LOD0 ).rgb
									.mul( u.emission )
									.mul( smoothstep( u.emissionThreshold, u.emissionThreshold.add( 0.35 ), a.y ) ) );

							} );

							const J = select( g.debugMode.equal( 3 ), albedo, scat.add( em ) );
							const opt = sigma.mul( step ).mul( vs );
							const tr = exp( opt.negate() );
							L.addAssign( J.mul( Tr ).mul( float( 1 ).sub( tr ) ) );
							emissionOut.addAssign( em.mul( Tr ).mul( float( 1 ).sub( tr ) ) );
							Tr.mulAssign( tr );
							If( Tr.lessThan( 0.02 ), () => {

								// treat as opaque: the remaining 2% is below what tone mapping can show
								Tr.assign( 0 );
								Break();

							} );

						} );

					} ).Else( () => {

						// near-empty voxel inside an occupied brick: stride twice as fast
						t.addAssign( step );

					} );

					t.addAssign( step );

				} );

			} );

			// aerial perspective
			const dist = t0.mul( vs );
			const fogT = exp( g.fogDensity.mul( dist ).negate() );
			const alpha = float( 1 ).sub( Tr );
			const col = L.mul( fogT ).add( g.fogColor.mul( alpha ).mul( float( 1 ).sub( fogT ) ) );
			emissionOut.mulAssign( fogT );
			return vec4( col, alpha );

		} );

		const material = new THREE.NodeMaterial();
		material.name = `voluxel.volume${ this.slot }`;
		// outputNode (not fragmentNode) so three still routes MRT: the volume pass gets an
		// emission-only target for bloom; plain single-target renders ignore it
		material.outputNode = frag();
		material.mrtNode = mrt( { emissive: vec4( emissionOut, 1 ) } );
		material.transparent = true;
		material.premultipliedAlpha = true;
		material.blending = THREE.NormalBlending;
		material.depthWrite = false;
		material.depthTest = false;
		material.side = THREE.BackSide;
		material.fog = false;
		material.lights = false;
		return material;

	}

	dispose(): void {

		this.texA.dispose();
		this.texB.dispose();
		this.texL.dispose();
		this.occupancy.dispose();
		this.shadowTex.dispose();
		this.mesh.geometry.dispose();
		this.material.dispose();
		this.clearKernel.dispose?.();
		this.voxelizeKernel.dispose?.();
		this.lightKernel.dispose?.();
		this.shadowKernel.dispose?.();

	}

}
