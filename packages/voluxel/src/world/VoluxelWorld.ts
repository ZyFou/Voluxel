/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { Fn, float, mix, mrt, output, positionWorld, pass, vec4 } from 'three/tsl';
import type {
	AmbientSettings, EffectDefinition, VoluxelStats, QualityPreset, QualitySettings, RegionInfo, SpawnOptions,
	SunSettings, Vec3Tuple,
} from '../core/types';
import { blackbody, clamp } from '../core/math';
import { VoluxelEffect } from '../sim/VoluxelEffect';
import { BRICK, RegionGPU, type SharedGPU } from '../gpu/RegionGPU';
import { createBlackbodyLUT, createGlobalUniforms, createNoiseVolume, type GlobalUniforms } from '../gpu/shared';
import { getPreset } from '../presets';
import { resolveQuality } from './quality';
import { instancedArray } from 'three/tsl';

type N = any;

export interface VoluxelWorldOptions {
	/** Region pool size: how many independent voxel volumes can be live at once. Default 6. */
	maxRegions?: number;
	/** Texture resolution of each region (multiple of 16, ≤ 160). Default 128. */
	regionResolution?: number;
	/** Max billows voxelised per frame across all regions. Default 32768. */
	maxParticles?: number;
	/** Max (billow, brick) pairs per frame. Default 600k. */
	maxBinEntries?: number;
	quality?: QualityPreset | Partial<QualitySettings>;
	/** Dynamic quality scaling toward a frame-rate target. Default `{ enabled: true, targetFps: 60 }`. */
	adaptive?: boolean | { enabled?: boolean; targetFps?: number };
	groundHeight?: number;
	wind?: Vec3Tuple;
	sun?: Partial<SunSettings>;
	ambient?: Partial<AmbientSettings>;
}

export type DebugView = 'none' | 'bricks' | 'lod' | 'albedo';

interface Cluster {
	effects: VoluxelEffect[];
	min: Vec3Tuple;
	max: Vec3Tuple;
}

interface RegionState {
	gpu: RegionGPU;
	inUse: boolean;
	voxelSize: number;
	/** Voxel size of the grid currently laid out by computeGrid (may differ until binning succeeds). */
	gridVs: number;
	dims: Vec3Tuple;
	origin: Vec3Tuple;
	brickDims: Vec3Tuple;
	lastUpdateFrame: number;
	lod: number;
	visible: boolean;
	updated: boolean;
	activeCount: number;
	effects: number;
	light: THREE.PointLight;
	helper: THREE.LineSegments;
}

const LOD_COLORS = [ new THREE.Color( 0.55, 1, 0.55 ), new THREE.Color( 1, 1, 0.45 ), new THREE.Color( 1, 0.6, 0.3 ), new THREE.Color( 1, 0.35, 0.35 ) ];
const OPACITY_K = 4.0;

const _box = new THREE.Box3();
const _frustum = new THREE.Frustum();
const _m4 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _bb = [ 0, 0, 0 ];

/**
 * Owns every running effect and the pool of GPU voxel regions.
 *
 * Per frame: simulate billows (CPU) → merge overlapping effects into regions → pick a voxel size
 * per region (LOD from screen coverage, texture budget and effect detail) → frustum / shadow-aware
 * culling and time slicing → bin billows into 8³ bricks → upload → dispatch clear / voxelise /
 * light / shadow kernels for the regions that need it. Rendering is a raymarch per region box.
 */
export class VoluxelWorld {

	readonly renderer: THREE.WebGPURenderer;
	/** Contains the raymarched region boxes. Rendered by the volume pass (see {@link createVolumePass}). */
	readonly volumeScene = new THREE.Scene();
	/** Fire-light point lights (one per region). Add to your main scene. */
	readonly lights = new THREE.Group();
	/** Region bounds helpers. Add to your main scene and toggle {@link showRegionBounds}. */
	readonly debug = new THREE.Group();

	readonly quality: QualitySettings;
	readonly sun: SunSettings;
	readonly ambientLight: AmbientSettings;
	readonly adaptive: { enabled: boolean; targetFps: number; scale: number };
	wind: Vec3Tuple;
	groundHeight: number;
	timeScale = 1;
	paused = false;
	debugView: DebugView = 'none';
	/** Multiplier for the fire point lights. */
	lightIntensity = 1;
	/** Peak flash of all live effects this frame (use it to drive exposure / bloom). */
	flash = 0;
	readonly flashColor = new THREE.Color( 1, 0.9, 0.8 );

	readonly stats: VoluxelStats = {
		effects: 0, particles: 0, regions: 0, visibleRegions: 0, culledRegions: 0, voxelizedRegions: 0,
		activeBricks: 0, activeVoxels: 0, binEntries: 0, cpuSimMs: 0, cpuBinMs: 0, qualityScale: 1, regionInfo: [],
	};

	readonly globals: GlobalUniforms;

	private readonly texSize: number;
	private readonly maxRegions: number;
	private readonly maxParticles: number;
	private readonly maxBinEntries: number;
	private readonly maxBricks: number;
	private readonly shared: SharedGPU;
	private readonly regions: RegionState[] = [];
	private readonly noise: { texture: THREE.Storage3DTexture; compute: N };
	private readonly effectList: VoluxelEffect[] = [];
	private depthTexture: THREE.Texture | null = null;
	private volumePass: N = null;
	private initialized = false;
	private frame = 0;
	private time = 0;
	private frameMsEma = 16;
	private currentRenderScale = 1;
	private _shadowNode: N = null;

	// binning scratch
	private readonly particleData: Float32Array;
	private readonly brickData: Uint32Array;
	private readonly listData: Uint32Array;
	private readonly staleData: Uint32Array;
	private readonly counts: Uint32Array;
	private readonly offsets: Uint32Array;
	private readonly fill: Uint32Array;
	private readonly activeList: Uint32Array;
	private readonly ranges: Int16Array;

	constructor( renderer: THREE.WebGPURenderer, options: VoluxelWorldOptions = {} ) {

		this.renderer = renderer;
		this.texSize = clamp( Math.round( ( options.regionResolution ?? 128 ) / 16 ) * 16, 32, 160 );
		this.maxRegions = clamp( options.maxRegions ?? 6, 1, 16 );
		this.maxParticles = options.maxParticles ?? 32768;
		this.maxBinEntries = options.maxBinEntries ?? 600000;
		const B = this.texSize / BRICK;
		this.maxBricks = B * B * B * this.maxRegions;
		this.quality = resolveQuality( options.quality );
		const ad = options.adaptive;
		this.adaptive = {
			enabled: ad === undefined ? true : typeof ad === 'boolean' ? ad : ad.enabled ?? true,
			targetFps: typeof ad === 'object' && ad.targetFps ? ad.targetFps : 60,
			scale: 1,
		};
		this.wind = options.wind ?? [ 1.5, 0, 0.5 ];
		this.groundHeight = options.groundHeight ?? 0;
		this.sun = {
			direction: options.sun?.direction ?? [ - 0.45, 0.62, 0.35 ],
			color: options.sun?.color ?? [ 1, 0.95, 0.88 ],
			intensity: options.sun?.intensity ?? 5,
		};
		this.ambientLight = {
			sky: options.ambient?.sky ?? [ 0.42, 0.55, 0.78 ],
			ground: options.ambient?.ground ?? [ 0.16, 0.15, 0.14 ],
			intensity: options.ambient?.intensity ?? 1,
		};

		this.globals = createGlobalUniforms();
		this.noise = createNoiseVolume();

		const particles = instancedArray( this.maxParticles * 3, 'vec4' ).setName( 'voluxelParticles' );
		const bricks = instancedArray( this.maxBricks, 'uvec4' ).setName( 'voluxelBricks' );
		const list = instancedArray( this.maxBinEntries, 'uint' ).setName( 'voluxelBinList' );
		const stale = instancedArray( this.maxBricks, 'uint' ).setName( 'voluxelStale' );

		this.particleData = particles.value.array as Float32Array;
		this.brickData = bricks.value.array as Uint32Array;
		this.listData = list.value.array as Uint32Array;
		this.staleData = stale.value.array as Uint32Array;

		this.shared = {
			globals: this.globals,
			particles: particles.toReadOnly(),
			bricks: bricks.toReadOnly(),
			list: list.toReadOnly(),
			stale: stale.toReadOnly(),
			noise: this.noise.texture,
			lut: createBlackbodyLUT(),
		};
		this.sharedAttrs = [ particles.value, bricks.value, list.value, stale.value ];

		const B3 = B * B * B;
		this.counts = new Uint32Array( B3 );
		this.offsets = new Uint32Array( B3 );
		this.fill = new Uint32Array( B3 );
		this.activeList = new Uint32Array( B3 );
		this.ranges = new Int16Array( this.maxParticles * 6 );

		const edges = new THREE.EdgesGeometry( new THREE.BoxGeometry( 1, 1, 1 ) );
		for ( let i = 0; i < this.maxRegions; i ++ ) {

			const gpu = new RegionGPU( i, this.texSize, this.shared, null );
			this.volumeScene.add( gpu.mesh );
			const light = new THREE.PointLight( 0xff8844, 0, 0, 2 );
			light.name = `voluxel.fireLight${ i }`;
			this.lights.add( light );
			const helper = new THREE.LineSegments( edges, new THREE.LineBasicMaterial( { color: 0x66ff99, transparent: true, opacity: 0.8, depthTest: true } ) );
			helper.visible = false;
			this.debug.add( helper );
			this.regions.push( {
				gpu, inUse: false, voxelSize: 0, gridVs: 0, dims: [ 0, 0, 0 ], origin: [ 0, 0, 0 ], brickDims: [ 0, 0, 0 ],
				lastUpdateFrame: - 1, lod: 0, visible: false, updated: false, activeCount: 0, effects: 0, light, helper,
			} );

		}

		this.debug.visible = false;
		this.applyLighting();

	}

	private readonly sharedAttrs: THREE.BufferAttribute[];

	/** Generates the detail-noise volume. Call once after `await renderer.init()`. */
	async init(): Promise<void> {

		if ( this.initialized ) return;
		await this.renderer.computeAsync( this.noise.compute );
		this.initialized = true;

	}

	get effects(): readonly VoluxelEffect[] {

		return this.effectList;

	}

	get showRegionBounds(): boolean {

		return this.debug.visible;

	}

	set showRegionBounds( v: boolean ) {

		this.debug.visible = v;

	}

	// -------------------------------------------------------------------------------------------
	// Rendering integration
	// -------------------------------------------------------------------------------------------

	/**
	 * Use the depth of your main scene pass so volumes are correctly occluded by (and wrap
	 * around) opaque geometry. Rebuilds the region materials.
	 */
	setDepthTexture( depth: THREE.Texture | null ): void {

		if ( depth === this.depthTexture ) return;
		this.depthTexture = depth;
		for ( const r of this.regions ) r.gpu.rebuildMaterial( depth );

	}

	/**
	 * Creates the reduced-resolution volume pass and a compositing helper.
	 *
	 * ```ts
	 * const scenePass = pass( scene, camera );
	 * const volumes = world.createVolumePass( scenePass, camera );
	 * pipeline.outputNode = volumes.composite( scenePass );
	 * ```
	 */
	createVolumePass( scenePass: N, camera: THREE.Camera ): { pass: N; composite: ( color: N ) => N; emissive: N } {

		this.setDepthTexture( scenePass.getTexture( 'depth' ) );
		const volumePass: N = pass( this.volumeScene, camera, { depthBuffer: false } );
		volumePass.name = 'voluxel.volumes';
		// second target holds emission only, so bloom can make fire glow without haloing sunlit smoke
		volumePass.setMRT( mrt( { output, emissive: vec4( 0 ) } ) );
		const renderer = this.renderer;
		const original = volumePass.updateBefore.bind( volumePass );
		const clear = new THREE.Color();
		volumePass.updateBefore = ( frame: N ) => {

			renderer.getClearColor( clear );
			const alpha = renderer.getClearAlpha();
			renderer.setClearColor( 0x000000, 0 );
			original( frame );
			renderer.setClearColor( clear, alpha );

		};

		this.volumePass = volumePass;
		this.currentRenderScale = - 1;
		this.applyRenderScale();
		const vol = volumePass.getTextureNode( 'output' );
		return {
			pass: volumePass,
			composite: ( color: N ) => vec4( color.rgb.mul( vol.a.oneMinus() ).add( vol.rgb ), 1 ),
			emissive: volumePass.getTextureNode( 'emissive' ),
		};

	}

	/**
	 * Transmittance (0..1) of all volumes toward the sun at `positionWorld`. Multiply it into
	 * your sun shadow: `material.receivedShadowNode = world.receivedShadow()`.
	 */
	get shadowNode(): N {

		if ( ! this._shadowNode ) {

			this._shadowNode = Fn( () => {

				let s: N = float( 1 );
				for ( const r of this.regions ) s = s.mul( r.gpu.shadowAt( positionWorld ) );
				return mix( float( 1 ), s, this.globals.shadowStrength );

			} )();

		}

		return this._shadowNode;

	}

	receivedShadow(): N {

		const node = this.shadowNode;
		return Fn( ( [ shadow ]: [ N ] ) => shadow.mul( node ) );

	}

	// -------------------------------------------------------------------------------------------
	// Effects
	// -------------------------------------------------------------------------------------------

	spawn( definition: EffectDefinition | string, position: THREE.Vector3 | Vec3Tuple = [ 0, 0, 0 ], options: SpawnOptions = {} ): VoluxelEffect {

		const def = typeof definition === 'string' ? getPreset( definition ) : definition;
		const p: Vec3Tuple = Array.isArray( position ) ? [ position[ 0 ], position[ 1 ], position[ 2 ] ] : [ position.x, position.y, position.z ];
		const effect = new VoluxelEffect( def, p, options );
		this.effectList.push( effect );
		return effect;

	}

	remove( effect: VoluxelEffect, immediate = false ): void {

		if ( immediate ) {

			const i = this.effectList.indexOf( effect );
			if ( i >= 0 ) this.effectList.splice( i, 1 );

		} else effect.kill();

	}

	clear(): void {

		this.effectList.length = 0;

	}

	// -------------------------------------------------------------------------------------------
	// Frame update
	// -------------------------------------------------------------------------------------------

	update( deltaSeconds: number, camera: THREE.PerspectiveCamera ): void {

		const wallMs = deltaSeconds * 1000;
		this.updateAdaptive( wallMs );

		const dt = this.paused ? 0 : Math.min( deltaSeconds, 1 / 20 ) * this.timeScale;
		this.time += dt;
		this.frame ++;
		const g = this.globals;
		g.time.value = this.time;
		g.frame.value = this.frame;
		this.applyLighting();
		this.applyQualityUniforms();

		// --- 1. simulate ---
		const tSim = performance.now();
		const ctx = { wind: this.wind, groundHeight: this.groundHeight };
		let flash = 0;
		for ( let i = this.effectList.length - 1; i >= 0; i -- ) {

			const e = this.effectList[ i ];
			if ( dt > 0 ) e.update( dt, ctx );
			flash = Math.max( flash, e.flash );
			if ( e.finished ) {

				this.effectList.splice( i, 1 );
				if ( e.definition.loop && ! e.killed ) this.spawn( e.definition, e.origin, { scale: e.scale, rotation: e.rotation, look: e.look } );

			}

		}

		this.flash = flash;
		this.stats.cpuSimMs = performance.now() - tSim;

		// --- 2. cluster effects into regions ---
		const tBin = performance.now();
		const clusters = this.buildClusters();
		this.assignSlots( clusters );

		// --- 3. per region: LOD, culling, binning ---
		camera.updateMatrixWorld();
		_m4.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _m4 );
		const viewH = this.renderer.getDrawingBufferSize( new THREE.Vector2() ).y || 1080;
		const tanHalf = Math.tan( THREE.MathUtils.degToRad( camera.fov ) * 0.5 );

		let particleCursor = 0, brickCursor = 0, listCursor = 0, staleCursor = 0;
		const work: { r: RegionState; active: number; stale: number; brickBase: number; staleBase: number }[] = [];
		let totalActive = 0, visibleRegions = 0, culled = 0;
		const info: RegionInfo[] = [];

		for ( let slot = 0; slot < this.regions.length; slot ++ ) {

			const r = this.regions[ slot ];
			const cluster = this.slotClusters[ slot ];

			if ( ! cluster ) {

				if ( r.inUse ) this.releaseRegion( r, work, staleCursor, ( n ) => ( staleCursor += n ) );
				continue;

			}

			r.inUse = true;
			r.effects = cluster.effects.length;

			// look from the dominant effect
			let dominant = cluster.effects[ 0 ];
			let hot = false;
			for ( const e of cluster.effects ) {

				if ( e.count > dominant.count ) dominant = e;
				if ( e.look.glow > 0 && e.maxTemperature > ( e.look.emissionThreshold ?? 0.25 ) ) hot = true;

			}

			this.applyLook( r, dominant );
			r.gpu.u.glowOn.value = hot ? 1 : 0;

			// --- LOD: voxel size ---
			const ex = cluster.max[ 0 ] - cluster.min[ 0 ], ey = cluster.max[ 1 ] - cluster.min[ 1 ], ez = cluster.max[ 2 ] - cluster.min[ 2 ];
			const cx = ( cluster.max[ 0 ] + cluster.min[ 0 ] ) / 2, cy = ( cluster.max[ 1 ] + cluster.min[ 1 ] ) / 2, cz = ( cluster.max[ 2 ] + cluster.min[ 2 ] ) / 2;
			const radius = 0.5 * Math.hypot( ex, ey, ez );
			const dist = camera.position.distanceTo( _v.set( cx, cy, cz ) );
			const effDist = Math.max( dist - radius * 0.5, radius * 0.25, camera.near );
			const pxPerMeter = viewH / ( 2 * effDist * tanHalf );
			const renderScale = this.currentRenderScale > 0 ? this.currentRenderScale : this.quality.renderScale;
			const vsLod = this.quality.pixelsPerVoxel / ( pxPerMeter * renderScale * this.adaptive.scale );
			let vsMin = Infinity;
			for ( const e of cluster.effects ) vsMin = Math.min( vsMin, ( e.definition.minVoxelSize ?? 0.1 ) * e.scale );
			const usable = this.texSize - BRICK;
			const vsFit = Math.max( ex, ey, ez ) / usable;
			let desired = Math.max( vsLod, vsMin, vsFit );

			// quarter-octave ladder + hysteresis
			const ladder = ( v: number ) => Math.pow( 2, Math.ceil( Math.log2( v ) * 4 ) / 4 );
			desired = ladder( desired );
			let vs = r.voxelSize;
			if ( ! ( vs > 0 ) || desired > vs * 1.01 || desired < vs * 0.7 || vs < vsFit ) vs = desired;

			const projectedPx = radius * 2 * pxPerMeter;
			r.lod = projectedPx > 600 ? 0 : projectedPx > 250 ? 1 : projectedPx > 100 ? 2 : 3;

			// --- culling (shadow aware) ---
			_box.min.set( cluster.min[ 0 ], cluster.min[ 1 ], cluster.min[ 2 ] );
			_box.max.set( cluster.max[ 0 ], cluster.max[ 1 ], cluster.max[ 2 ] );
			const sd = this.sun.direction;
			const sl = Math.hypot( sd[ 0 ], sd[ 1 ], sd[ 2 ] ) || 1;
			if ( this.quality.shadows && sd[ 1 ] / sl > 0.05 ) {

				const k = ( cluster.max[ 1 ] - this.groundHeight ) / ( sd[ 1 ] / sl );
				_box.expandByPoint( _v.set( cluster.min[ 0 ] - sd[ 0 ] / sl * k, this.groundHeight, cluster.min[ 2 ] - sd[ 2 ] / sl * k ) );
				_box.expandByPoint( _v.set( cluster.max[ 0 ] - sd[ 0 ] / sl * k, this.groundHeight, cluster.max[ 2 ] - sd[ 2 ] / sl * k ) );

			}

			const inFrustum = _frustum.intersectsBox( _box );
			r.visible = inFrustum || ! this.quality.frustumCulling;
			if ( r.visible ) visibleRegions ++; else culled ++;

			// --- time slicing ---
			const interval = this.quality.timeSlicing ? [ 1, 1, 2, 3 ][ r.lod ] : 1;
			const due = this.frame - r.lastUpdateFrame >= interval || r.lastUpdateFrame < 0;
			r.updated = false;

			if ( r.visible && due ) {

				// --- grid & binning, coarsening if the bin budget is exceeded ---
				let ok = false;
				for ( let attempt = 0; attempt < 5 && ! ok; attempt ++ ) {

					if ( ! this.computeGrid( r, cluster, vs ) ) {

						vs = ladder( vs * 1.19 );
						continue;

					}

					const entries = this.countEntries( r, cluster );
					if ( listCursor + entries > this.maxBinEntries ) {

						vs = ladder( vs * 1.19 );
						continue;

					}

					ok = true;

				}

				if ( ok ) {

					r.voxelSize = vs;
					const res = this.binRegion( r, cluster, particleCursor, listCursor, brickCursor );
					particleCursor = res.particleCursor;
					listCursor = res.listCursor;

					// stale bricks: active last update, inactive now
					const B = r.gpu.bricksPerAxis;
					const B3 = B * B * B;
					const prev = r.gpu.prevActive, curr = r.gpu.currActive;
					let staleCount = 0;
					for ( let b = 0; b < B3; b ++ ) {

						if ( prev[ b ] && ! curr[ b ] ) {

							const bx = b % B, by = Math.floor( b / B ) % B, bz = Math.floor( b / ( B * B ) );
							this.staleData[ staleCursor + staleCount ++ ] = bx | ( by << 8 ) | ( bz << 16 );

						}

						r.gpu.occData[ b ] = curr[ b ] ? 255 : 0;

					}

					prev.set( curr );
					r.gpu.occupancy.needsUpdate = true;

					work.push( { r, active: res.active, stale: staleCount, brickBase: brickCursor, staleBase: staleCursor } );
					brickCursor += res.active;
					staleCursor += staleCount;
					r.activeCount = res.active;
					r.lastUpdateFrame = this.frame;
					r.updated = true;

					this.updateRegionTransform( r );

				}

			}

			totalActive += r.activeCount;
			r.gpu.mesh.visible = r.visible && r.activeCount > 0;
			r.gpu.u.shadowEnabled.value = this.quality.shadows && r.activeCount > 0 ? 1 : 0;
			r.gpu.u.lodTint.value.copy( this.debugView === 'lod' ? LOD_COLORS[ r.lod ] : _c.setRGB( 1, 1, 1 ) );

			this.updateFireLight( r, cluster );
			this.updateHelper( r );

			info.push( {
				slot, effects: r.effects, voxelSize: r.voxelSize, dims: [ ...r.dims ] as Vec3Tuple, activeBricks: r.activeCount,
				lod: r.lod, visible: r.visible, updatedThisFrame: r.updated,
			} );

		}

		this.stats.cpuBinMs = performance.now() - tBin;

		// --- 4. upload + dispatch ---
		if ( work.length > 0 && this.initialized ) {

			const [ pAttr, bAttr, lAttr, sAttr ] = this.sharedAttrs;
			this.markRange( pAttr, particleCursor * 12 );
			this.markRange( bAttr, brickCursor * 4 );
			this.markRange( lAttr, listCursor );
			this.markRange( sAttr, staleCursor );

			for ( const w of work ) {

				const gpu = w.r.gpu;
				gpu.u.brickBase.value = w.brickBase;
				gpu.u.staleBase.value = w.staleBase;
				if ( w.stale > 0 ) this.renderer.compute( gpu.clearKernel, [ w.stale * 8, 1, 1 ] );
				if ( w.active > 0 ) {

					this.renderer.compute( gpu.voxelizeKernel, [ w.active * 8, 1, 1 ] );
					this.renderer.compute( gpu.lightKernel, [ w.active, 1, 1 ] );
					if ( this.quality.shadows ) {

						this.updateShadowFrame( w.r );
						this.renderer.compute( gpu.shadowKernel );

					}

				}

			}

		}

		// --- stats ---
		let particles = 0;
		for ( const e of this.effectList ) particles += e.count;
		const s = this.stats;
		s.effects = this.effectList.length;
		s.particles = particles;
		s.regions = info.length;
		s.visibleRegions = visibleRegions;
		s.culledRegions = culled;
		s.voxelizedRegions = work.filter( ( w ) => w.active > 0 ).length;
		s.activeBricks = totalActive;
		s.activeVoxels = totalActive * BRICK * BRICK * BRICK;
		s.binEntries = listCursor;
		s.qualityScale = this.adaptive.scale;
		s.regionInfo = info;

	}

	// -------------------------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------------------------

	private slotClusters: ( Cluster | null )[] = [];

	private buildClusters(): Cluster[] {

		const live = this.effectList.filter( ( e ) => e.count > 0 );
		const clusters: Cluster[] = live.map( ( e ) => ( {
			effects: [ e ],
			min: [ ...e.boundsMin ] as Vec3Tuple,
			max: [ ...e.boundsMax ] as Vec3Tuple,
		} ) );

		const overlap = ( a: Cluster, b: Cluster ) => {

			for ( let k = 0; k < 3; k ++ ) {

				const m = Math.max( a.max[ k ] - a.min[ k ], b.max[ k ] - b.min[ k ] ) * 0.04;
				if ( a.min[ k ] > b.max[ k ] + m || b.min[ k ] > a.max[ k ] + m ) return false;

			}

			return true;

		};

		const merge = ( a: Cluster, b: Cluster ) => {

			a.effects.push( ...b.effects );
			for ( let k = 0; k < 3; k ++ ) {

				a.min[ k ] = Math.min( a.min[ k ], b.min[ k ] );
				a.max[ k ] = Math.max( a.max[ k ], b.max[ k ] );

			}

		};

		if ( this.quality.regionMerging ) {

			let merged = true;
			while ( merged ) {

				merged = false;
				outer: for ( let i = 0; i < clusters.length; i ++ ) {

					for ( let j = i + 1; j < clusters.length; j ++ ) {

						if ( overlap( clusters[ i ], clusters[ j ] ) ) {

							merge( clusters[ i ], clusters[ j ] );
							clusters.splice( j, 1 );
							merged = true;
							break outer;

						}

					}

				}

			}

		}

		// pool limit: merge the pair whose union grows the least
		const vol = ( mn: Vec3Tuple, mx: Vec3Tuple ) => ( mx[ 0 ] - mn[ 0 ] ) * ( mx[ 1 ] - mn[ 1 ] ) * ( mx[ 2 ] - mn[ 2 ] );
		while ( clusters.length > this.maxRegions ) {

			let bi = 0, bj = 1, best = Infinity;
			for ( let i = 0; i < clusters.length; i ++ ) {

				for ( let j = i + 1; j < clusters.length; j ++ ) {

					const a = clusters[ i ], b = clusters[ j ];
					for ( let k = 0; k < 3; k ++ ) _bb[ k ] = Math.min( a.min[ k ], b.min[ k ] );
					const mx: Vec3Tuple = [ Math.max( a.max[ 0 ], b.max[ 0 ] ), Math.max( a.max[ 1 ], b.max[ 1 ] ), Math.max( a.max[ 2 ], b.max[ 2 ] ) ];
					const cost = vol( _bb as Vec3Tuple, mx ) - vol( a.min, a.max ) - vol( b.min, b.max );
					if ( cost < best ) {

						best = cost; bi = i; bj = j;

					}

				}

			}

			merge( clusters[ bi ], clusters[ bj ] );
			clusters.splice( bj, 1 );

		}

		return clusters;

	}

	private assignSlots( clusters: Cluster[] ): void {

		const slots: ( Cluster | null )[] = new Array( this.regions.length ).fill( null );
		const pending: Cluster[] = [];
		for ( const c of clusters ) {

			// keep the slot most of its effects used last frame (stable time slicing & clears)
			const votes = new Map<number, number>();
			for ( const e of c.effects ) if ( e.regionSlot >= 0 ) votes.set( e.regionSlot, ( votes.get( e.regionSlot ) ?? 0 ) + e.count );
			let best = - 1, bestV = - 1;
			for ( const [ s, v ] of votes ) if ( v > bestV && ! slots[ s ] ) {

				best = s; bestV = v;

			}

			if ( best >= 0 ) slots[ best ] = c; else pending.push( c );

		}

		for ( const c of pending ) {

			let s = slots.findIndex( ( x, i ) => ! x && ! this.regions[ i ].inUse );
			if ( s < 0 ) s = slots.findIndex( ( x ) => ! x );
			if ( s >= 0 ) slots[ s ] = c;

		}

		slots.forEach( ( c, s ) => {

			if ( c ) for ( const e of c.effects ) e.regionSlot = s;

		} );
		this.slotClusters = slots;

	}

	private computeGrid( r: RegionState, c: Cluster, vs: number ): boolean {

		const bw = vs * BRICK;
		const B = r.gpu.bricksPerAxis;
		r.gridVs = vs;
		for ( let k = 0; k < 3; k ++ ) {

			const lo = Math.floor( ( c.min[ k ] - vs ) / bw );
			const hi = Math.ceil( ( c.max[ k ] + vs ) / bw );
			const n = Math.max( 1, hi - lo );
			if ( n > B ) return false;
			r.origin[ k ] = lo * bw;
			r.brickDims[ k ] = n;
			r.dims[ k ] = n * BRICK;

		}

		return true;

	}

	/** Number of (billow, brick) pairs the current grid would produce; used to respect the bin budget. */
	private countEntries( r: RegionState, c: Cluster ): number {

		const vs = r.gridVs;
		const bwv = vs * BRICK;
		let total = 0;
		for ( const e of c.effects ) {

			for ( let i = 0; i < e.count; i ++ ) {

				if ( e.dens[ i ] <= 1e-3 ) continue;
				const rad = Math.max( e.r[ i ], vs * 0.75 );
				let n = 1;
				for ( let k = 0; k < 3; k ++ ) {

					const p = k === 0 ? e.px[ i ] : k === 1 ? e.py[ i ] : e.pz[ i ];
					const b0 = Math.max( 0, Math.floor( ( p - rad - r.origin[ k ] ) / bwv ) );
					const b1 = Math.min( r.brickDims[ k ] - 1, Math.floor( ( p + rad - r.origin[ k ] ) / bwv ) );
					n *= Math.max( 0, b1 - b0 + 1 );

				}

				total += n;

			}

		}

		return total;

	}

	private binRegion( r: RegionState, c: Cluster, particleBase: number, listBase: number, brickBase: number ) {

		const vs = r.voxelSize;
		const bw = vs * BRICK;
		const B = r.gpu.bricksPerAxis;
		const counts = this.counts, offsets = this.offsets, fill = this.fill, ranges = this.ranges;
		counts.fill( 0 );
		r.gpu.currActive.fill( 0 );
		const pd = this.particleData;
		let gp = particleBase;
		const [ ox, oy, oz ] = r.origin;
		const [ nbx, nby, nbz ] = r.brickDims;

		for ( const e of c.effects ) {

			for ( let i = 0; i < e.count; i ++ ) {

				if ( gp >= this.maxParticles ) break;
				const dens = e.dens[ i ];
				if ( dens <= 1e-3 ) continue;
				const rad = Math.max( e.r[ i ], vs * 0.75 );
				const x = e.px[ i ], y = e.py[ i ], z = e.pz[ i ];
				const bx0 = Math.max( 0, Math.floor( ( x - rad - ox ) / bw ) ), bx1 = Math.min( nbx - 1, Math.floor( ( x + rad - ox ) / bw ) );
				const by0 = Math.max( 0, Math.floor( ( y - rad - oy ) / bw ) ), by1 = Math.min( nby - 1, Math.floor( ( y + rad - oy ) / bw ) );
				const bz0 = Math.max( 0, Math.floor( ( z - rad - oz ) / bw ) ), bz1 = Math.min( nbz - 1, Math.floor( ( z + rad - oz ) / bw ) );
				if ( bx1 < bx0 || by1 < by0 || bz1 < bz0 ) continue;

				const o = gp * 12;
				pd[ o ] = x; pd[ o + 1 ] = y; pd[ o + 2 ] = z; pd[ o + 3 ] = rad;
				pd[ o + 4 ] = dens; pd[ o + 5 ] = e.temp[ i ]; pd[ o + 6 ] = e.soot[ i ];
				pd[ o + 7 ] = e.opacity[ i ] * OPACITY_K / Math.max( rad, 1e-3 );
				pd[ o + 8 ] = e.ex[ i ]; pd[ o + 9 ] = e.ey[ i ]; pd[ o + 10 ] = e.ez[ i ]; pd[ o + 11 ] = 0;

				const ro = ( gp - particleBase ) * 6;
				ranges[ ro ] = bx0; ranges[ ro + 1 ] = bx1; ranges[ ro + 2 ] = by0; ranges[ ro + 3 ] = by1; ranges[ ro + 4 ] = bz0; ranges[ ro + 5 ] = bz1;

				for ( let bz = bz0; bz <= bz1; bz ++ ) for ( let by = by0; by <= by1; by ++ ) {

					const row = ( bz * B + by ) * B;
					for ( let bx = bx0; bx <= bx1; bx ++ ) counts[ row + bx ] ++;

				}

				gp ++;

			}

		}

		// prefix sum over used bricks → active list
		let active = 0, cursor = 0;
		const al = this.activeList;
		for ( let bz = 0; bz < nbz; bz ++ ) for ( let by = 0; by < nby; by ++ ) {

			const row = ( bz * B + by ) * B;
			for ( let bx = 0; bx < nbx; bx ++ ) {

				const b = row + bx;
				const n = counts[ b ];
				if ( n === 0 ) continue;
				offsets[ b ] = cursor;
				fill[ b ] = 0;
				cursor += n;
				al[ active ++ ] = b;
				r.gpu.currActive[ b ] = 1;

			}

		}

		// fill
		const list = this.listData;
		for ( let p = particleBase; p < gp; p ++ ) {

			const ro = ( p - particleBase ) * 6;
			for ( let bz = ranges[ ro + 4 ]; bz <= ranges[ ro + 5 ]; bz ++ ) for ( let by = ranges[ ro + 2 ]; by <= ranges[ ro + 3 ]; by ++ ) {

				const row = ( bz * B + by ) * B;
				for ( let bx = ranges[ ro ]; bx <= ranges[ ro + 1 ]; bx ++ ) {

					const b = row + bx;
					list[ listBase + offsets[ b ] + fill[ b ] ++ ] = p;

				}

			}

		}

		// brick entries
		const bd = this.brickData;
		for ( let k = 0; k < active; k ++ ) {

			const b = al[ k ];
			const bx = b % B, by = Math.floor( b / B ) % B, bz = Math.floor( b / ( B * B ) );
			const o = ( brickBase + k ) * 4;
			bd[ o ] = bx | ( by << 8 ) | ( bz << 16 );
			bd[ o + 1 ] = listBase + offsets[ b ];
			bd[ o + 2 ] = counts[ b ];
			bd[ o + 3 ] = 0;

		}

		return { particleCursor: gp, listCursor: listBase + cursor, active };

	}

	private releaseRegion( r: RegionState, work: { r: RegionState; active: number; stale: number; brickBase: number; staleBase: number }[], staleBase: number, advance: ( n: number ) => void ): void {

		const B = r.gpu.bricksPerAxis;
		const B3 = B * B * B;
		let n = 0;
		for ( let b = 0; b < B3; b ++ ) {

			if ( r.gpu.prevActive[ b ] ) {

				const bx = b % B, by = Math.floor( b / B ) % B, bz = Math.floor( b / ( B * B ) );
				this.staleData[ staleBase + n ++ ] = bx | ( by << 8 ) | ( bz << 16 );

			}

		}

		r.gpu.prevActive.fill( 0 );
		r.gpu.currActive.fill( 0 );
		r.gpu.occData.fill( 0 );
		r.gpu.occupancy.needsUpdate = true;
		r.inUse = false;
		r.voxelSize = 0;
		r.activeCount = 0;
		r.lastUpdateFrame = - 1;
		r.gpu.mesh.visible = false;
		r.gpu.u.shadowEnabled.value = 0;
		r.light.intensity = 0;
		r.helper.visible = false;
		if ( n > 0 ) work.push( { r, active: 0, stale: n, brickBase: 0, staleBase } );
		advance( n );

	}

	private updateRegionTransform( r: RegionState ): void {

		const u = r.gpu.u;
		const vs = r.voxelSize;
		u.origin.value.set( r.origin[ 0 ], r.origin[ 1 ], r.origin[ 2 ] );
		u.voxelSize.value = vs;
		u.dims.value.set( r.dims[ 0 ], r.dims[ 1 ], r.dims[ 2 ] );
		const m = r.gpu.mesh;
		const sx = r.dims[ 0 ] * vs, sy = r.dims[ 1 ] * vs, sz = r.dims[ 2 ] * vs;
		m.position.set( r.origin[ 0 ] + sx / 2, r.origin[ 1 ] + sy / 2, r.origin[ 2 ] + sz / 2 );
		m.scale.set( sx * 1.001, sy * 1.001, sz * 1.001 );
		m.updateMatrix();

	}

	private updateShadowFrame( r: RegionState ): void {

		const u = r.gpu.u;
		const L = this.globals.sunDir.value as THREE.Vector3;
		const up = Math.abs( L.y ) > 0.95 ? _v.set( 1, 0, 0 ) : _v.set( 0, 1, 0 );
		const U = ( u.shadowU.value as THREE.Vector3 ).crossVectors( up, L ).normalize();
		const V = ( u.shadowV.value as THREE.Vector3 ).crossVectors( L, U ).normalize();
		const vs = r.voxelSize;
		const size = [ r.dims[ 0 ] * vs, r.dims[ 1 ] * vs, r.dims[ 2 ] * vs ];
		const center = ( u.shadowCenter.value as THREE.Vector3 ).set( r.origin[ 0 ] + size[ 0 ] / 2, r.origin[ 1 ] + size[ 1 ] / 2, r.origin[ 2 ] + size[ 2 ] / 2 );
		let uMin = Infinity, uMax = - Infinity, vMin = Infinity, vMax = - Infinity;
		const corner = new THREE.Vector3();
		for ( let i = 0; i < 8; i ++ ) {

			corner.set( ( i & 1 ? 0.5 : - 0.5 ) * size[ 0 ], ( i & 2 ? 0.5 : - 0.5 ) * size[ 1 ], ( i & 4 ? 0.5 : - 0.5 ) * size[ 2 ] );
			const cu = corner.dot( U ), cv = corner.dot( V );
			uMin = Math.min( uMin, cu ); uMax = Math.max( uMax, cu );
			vMin = Math.min( vMin, cv ); vMax = Math.max( vMax, cv );

		}

		void center;
		( u.shadowRect.value as THREE.Vector4 ).set( uMin, vMin, Math.max( uMax - uMin, 1e-3 ), Math.max( vMax - vMin, 1e-3 ) );
		u.shadowDepth.value = Math.hypot( size[ 0 ], size[ 1 ], size[ 2 ] ) * 0.5 + vs * 2;

	}

	private applyLook( r: RegionState, e: VoluxelEffect ): void {

		const u = r.gpu.u;
		const l = e.look;
		u.threshold.value = l.threshold;
		u.softness.value = Math.max( 0.01, l.softness );
		u.erosion.value = l.erosion;
		// band-limit: the largest noise octave spans ≥ 2 voxels so the finest one stays near voxel scale
		u.detailScale.value = Math.max( l.detailScale * e.scale, r.voxelSize * 2.0 );
		u.emission.value = l.emission;
		u.emissionThreshold.value = l.emissionThreshold ?? 0.25;
		u.glow.value = l.glow;
		u.scattering.value = l.scattering ?? 1;
		u.anisotropy.value = l.anisotropy ?? 0.55;
		u.ambientMul.value = l.ambient ?? 1;
		( u.smokeColor.value as THREE.Color ).setRGB( l.smokeColor[ 0 ], l.smokeColor[ 1 ], l.smokeColor[ 2 ] );
		( u.sootColor.value as THREE.Color ).setRGB( l.sootColor[ 0 ], l.sootColor[ 1 ], l.sootColor[ 2 ] );

	}

	private updateFireLight( r: RegionState, c: Cluster ): void {

		let e = 0, x = 0, y = 0, z = 0, t = 0, f = 0, scale = 0;
		for ( const ef of c.effects ) {

			const w = ef.emission * ( ef.definition.lightIntensity ?? 1 );
			e += w;
			x += ef.emissionCentroid[ 0 ] * w; y += ef.emissionCentroid[ 1 ] * w; z += ef.emissionCentroid[ 2 ] * w;
			t += ef.emissionTemp * w;
			f = Math.max( f, ef.flash );
			scale = Math.max( scale, ef.scale * ( ef.definition.viewDistance ?? 50 ) / 50 );

		}

		const light = r.light;
		if ( e <= 1e-6 && f <= 1e-3 ) {

			light.intensity = 0;
			return;

		}

		if ( e > 1e-6 ) light.position.set( x / e, y / e, z / e );
		else light.position.set( ( c.min[ 0 ] + c.max[ 0 ] ) / 2, c.min[ 1 ] + ( c.max[ 1 ] - c.min[ 1 ] ) * 0.3, ( c.min[ 2 ] + c.max[ 2 ] ) / 2 );
		const temp = e > 0 ? t / e : 1.2;
		const bb = blackbody( Math.max( temp, 0.6 ) );
		const m = Math.max( bb[ 0 ], bb[ 1 ], bb[ 2 ], 1e-4 );
		light.color.setRGB( bb[ 0 ] / m, bb[ 1 ] / m, bb[ 2 ] / m );
		light.intensity = ( e * 0.25 + f * 300 * scale * scale ) * this.lightIntensity;

	}

	private updateHelper( r: RegionState ): void {

		const h = r.helper;
		h.visible = r.inUse && r.activeCount > 0;
		if ( ! h.visible ) return;
		const vs = r.voxelSize;
		const sx = r.dims[ 0 ] * vs, sy = r.dims[ 1 ] * vs, sz = r.dims[ 2 ] * vs;
		h.position.set( r.origin[ 0 ] + sx / 2, r.origin[ 1 ] + sy / 2, r.origin[ 2 ] + sz / 2 );
		h.scale.set( sx, sy, sz );
		( h.material as THREE.LineBasicMaterial ).color.copy( r.visible ? LOD_COLORS[ r.lod ] : _c.setRGB( 0.4, 0.4, 0.45 ) );

	}

	private markRange( attr: THREE.BufferAttribute, count: number ): void {

		if ( count <= 0 ) return;
		attr.clearUpdateRanges();
		attr.addUpdateRange( 0, count );
		attr.needsUpdate = true;

	}

	private applyLighting(): void {

		const g = this.globals;
		const d = this.sun.direction;
		( g.sunDir.value as THREE.Vector3 ).set( d[ 0 ], d[ 1 ], d[ 2 ] ).normalize();
		( g.sunColor.value as THREE.Color ).setRGB( this.sun.color[ 0 ], this.sun.color[ 1 ], this.sun.color[ 2 ] ).multiplyScalar( this.sun.intensity );
		( g.skyColor.value as THREE.Color ).setRGB( this.ambientLight.sky[ 0 ], this.ambientLight.sky[ 1 ], this.ambientLight.sky[ 2 ] );
		( g.groundColor.value as THREE.Color ).setRGB( this.ambientLight.ground[ 0 ], this.ambientLight.ground[ 1 ], this.ambientLight.ground[ 2 ] );
		g.ambient.value = this.ambientLight.intensity;

	}

	private applyQualityUniforms(): void {

		const q = this.quality;
		const g = this.globals;
		const s = this.adaptive.scale;
		g.maxSteps.value = Math.round( q.maxSteps * ( 0.6 + 0.4 * s ) );
		g.stepScale.value = q.stepScale / ( 0.75 + 0.25 * s );
		g.lightSteps.value = q.lightSteps;
		g.detailShadowSteps.value = s < 0.6 ? Math.min( 1, q.detailShadowSteps ) : q.detailShadowSteps;
		g.detail.value = q.detail;
		g.flowNoise.value = q.flowNoise ? 1 : 0;
		g.emptySpaceSkipping.value = q.emptySpaceSkipping ? 1 : 0;
		g.debugMode.value = this.debugView === 'bricks' ? 1 : this.debugView === 'lod' ? 2 : this.debugView === 'albedo' ? 3 : 0;
		this.applyRenderScale();

	}

	private applyRenderScale(): void {

		if ( ! this.volumePass ) return;
		const s = this.adaptive.scale;
		const target = Math.round( clamp( this.quality.renderScale * ( 0.55 + 0.45 * s ), 0.25, 1 ) * 20 ) / 20;
		if ( target !== this.currentRenderScale ) {

			this.currentRenderScale = target;
			this.volumePass.setResolutionScale( target );

		}

	}

	private updateAdaptive( frameMs: number ): void {

		if ( ! ( frameMs > 0 ) || frameMs > 250 ) return;
		this.frameMsEma += ( frameMs - this.frameMsEma ) * 0.08;
		const a = this.adaptive;
		if ( ! a.enabled ) {

			a.scale = 1;
			return;

		}

		const budget = 1000 / a.targetFps;
		if ( this.frameMsEma > budget * 1.06 ) a.scale = Math.max( 0.35, a.scale - 0.015 );
		else if ( this.frameMsEma < budget * 0.9 ) a.scale = Math.min( 1, a.scale + 0.004 );

	}

	/** Smoothed frame time used by the adaptive controller (ms). */
	get frameTime(): number {

		return this.frameMsEma;

	}

	dispose(): void {

		for ( const r of this.regions ) {

			r.gpu.dispose();
			r.light.dispose();
			( r.helper.material as THREE.Material ).dispose();

		}

		this.noise.texture.dispose();
		this.shared.lut.dispose();
		this.effectList.length = 0;

	}

}
