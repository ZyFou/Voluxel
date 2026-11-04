/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
	VoluxelWorld, PRESETS, clonePreset, QUALITY_PRESETS,
	type DebugView, type EffectDefinition, type VoluxelStats, type QualityPreset,
} from 'voluxel';
import { createEnvironment, type Environment } from './environment';

export interface LightingState {
	elevation: number;
	azimuth: number;
	sunIntensity: number;
	ambient: number;
	exposure: number;
	bloom: number;
	fog: number;
	fireLight: number;
	environment: 'sky' | 'studio';
}

export interface SpawnState {
	presetId: string;
	scale: number;
	autoRepeat: boolean;
	interval: number;
	clickToSpawn: boolean;
	count: number;
}

export interface FrameStats {
	fps: number;
	frameMs: number;
	world: VoluxelStats;
}

type Listener = ( s: FrameStats ) => void;

/** Initial values; the reset actions copy from these. */
const DEFAULT_SPAWN: SpawnState = { presetId: 'fireExplosion', scale: 1, autoRepeat: true, interval: 9, clickToSpawn: true, count: 1 };
const DEFAULT_LIGHTING: LightingState = {
	elevation: 38, azimuth: 215, sunIntensity: 5, ambient: 1, exposure: 1, bloom: 0.6, fog: 0.15, fireLight: 1, environment: 'sky',
};
const DEFAULT_WIND: [ number, number, number ] = [ 1.5, 0, 0.5 ];
const DEFAULT_CAMERA = { position: new THREE.Vector3( 62, 22, 58 ), target: new THREE.Vector3( 0, 10, 0 ) };

export type ResetScope = 'effect' | 'look' | 'physics' | 'light' | 'perf';

/** The playground's three.js host. Framework agnostic; React talks to it through methods. */
export class DemoEngine {

	renderer!: THREE.WebGPURenderer;
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera( 50, 1, 0.5, 30000 );
	controls!: OrbitControls;
	world!: VoluxelWorld;
	env!: Environment;
	pipeline!: THREE.RenderPipeline;
	qualityPreset: QualityPreset = 'high';
	supported = true;
	ready = false;

	/** Editable copies of every preset; spawned effects reference these objects so edits apply live. */
	readonly definitions: Record<string, EffectDefinition> = Object.fromEntries(
		Object.entries( PRESETS ).map( ( [ k, v ] ) => [ k, clonePreset( v ) ] ),
	);

	readonly spawn: SpawnState = { ...DEFAULT_SPAWN };
	readonly lighting: LightingState = { ...DEFAULT_LIGHTING };

	private bloomNode: any = null;
	debugNodes: any = null;
	private container: HTMLElement | null = null;
	private timer = new THREE.Timer();
	private listeners = new Set<Listener>();
	private repeatClock = 0;
	private fpsEma = 60;
	private frameEma = 16;
	private frameCount = 0;
	private resizeObserver: ResizeObserver | null = null;
	private cameraTween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
	private pointerDown: { x: number; y: number; t: number } | null = null;
	private active = true;
	private disposed = false;
	readonly lastPosition = new THREE.Vector3();

	async init( container: HTMLElement ): Promise<void> {

		this.container = container;
		if ( ! ( 'gpu' in navigator ) ) {

			this.supported = false;
			throw new Error( 'WebGPU is not available in this browser.' );

		}

		const renderer = new THREE.WebGPURenderer( { antialias: false } );
		renderer.setPixelRatio( Math.min( window.devicePixelRatio, 1.25 ) );
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.setClearColor( 0x000000, 0 );
		await renderer.init();
		if ( this.disposed ) {

			renderer.dispose();
			return;

		}

		if ( ( renderer.backend as any ).isWebGPUBackend !== true ) {

			this.supported = false;
			throw new Error( 'WebGPU adapter unavailable (fell back to WebGL). Use a recent Chrome or Edge.' );

		}

		this.renderer = renderer;
		container.appendChild( renderer.domElement );
		renderer.domElement.style.display = 'block';
		renderer.domElement.style.width = '100%';
		renderer.domElement.style.height = '100%';
		renderer.domElement.style.touchAction = 'none';

		this.env = createEnvironment( this.scene );
		this.scene.fog = new THREE.FogExp2( 0x9fb3c8, 0.00035 );

		this.camera.position.copy( DEFAULT_CAMERA.position );
		this.controls = new OrbitControls( this.camera, renderer.domElement );
		this.controls.target.copy( DEFAULT_CAMERA.target );
		this.controls.enableDamping = true;
		this.controls.maxPolarAngle = Math.PI * 0.495;
		this.controls.minDistance = 4;
		this.controls.maxDistance = 6000;

		// --- voluxel ---
		this.world = new VoluxelWorld( renderer, {
			quality: 'high', maxRegions: 6, regionResolution: 128, adaptive: { enabled: true, targetFps: 60 },
		} );
		await this.world.init();
		if ( this.disposed ) {

			this.world.dispose();
			renderer.dispose();
			renderer.domElement.remove();
			return;

		}

		this.scene.add( this.world.lights, this.world.debug );
		this.env.groundMaterial.receivedShadowNode = this.world.receivedShadow();
		this.env.group.traverse( ( o: any ) => {

			if ( o.isMesh && o !== this.env.ground && o.material?.isNodeMaterial && o.receiveShadow ) o.material.receivedShadowNode = this.world.receivedShadow();

		} );

		const scenePass = pass( this.scene, this.camera );
		const volumes = this.world.createVolumePass( scenePass, this.camera );
		const composite = volumes.composite( scenePass );
		// bloom only the volume layer: fire glows without hazing the HDR sky
		const glow = bloom( volumes.emissive, 1, 0.5, 0.6 );
		this.bloomNode = glow;
		this.debugNodes = { scenePass, volumes, composite, glow };
		this.pipeline = new THREE.RenderPipeline( renderer, composite.add( glow ) );

		this.applyLighting();
		this.setEnvironment( this.lighting.environment );

		this.resizeObserver = new ResizeObserver( () => this.resize() );
		this.resizeObserver.observe( container );
		this.resize();

		renderer.domElement.addEventListener( 'pointerdown', this.onPointerDown );
		renderer.domElement.addEventListener( 'pointerup', this.onPointerUp );

		this.ready = true;
		this.spawnSelected();
		renderer.setAnimationLoop( this.loop );

	}

	// ---------------------------------------------------------------------------------------------

	subscribe( fn: Listener ): () => void {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	setActive( active: boolean ): void {

		this.active = active;
		if ( ! this.ready ) return;
		this.renderer.setAnimationLoop( active ? this.loop : null );

	}

	get definition(): EffectDefinition {

		return this.definitions[ this.spawn.presetId ];

	}

	selectPreset( id: string, frame = true ): void {

		this.spawn.presetId = id;
		this.repeatClock = 0;
		const def = this.definitions[ id ];
		this.spawn.interval = this.defaultInterval( id );
		if ( frame ) this.frameDefinition( def );

	}

	// ---------------------------------------------------------------------------------------------
	// Definitions & resets. Definitions are mutated in place (never replaced) because running
	// effects hold a reference to them; that is what makes edits apply live.
	// ---------------------------------------------------------------------------------------------

	/** Adds an imported effect and remembers its original so it can be reset later. */
	addDefinition( def: EffectDefinition ): void {

		this.imported.set( def.id, clonePreset( def ) );
		this.definitions[ def.id ] = def;

	}

	isImported( id: string ): boolean {

		return this.imported.has( id );

	}

	private pristine( id: string ): EffectDefinition | null {

		const src = PRESETS[ id ] ?? this.imported.get( id );
		return src ? clonePreset( src ) : null;

	}

	/** Look + physics + emitters of one effect back to its shipped (or imported) values. */
	resetPreset( id: string ): void {

		const fresh = this.pristine( id );
		const def = this.definitions[ id ];
		if ( ! fresh || ! def ) return;
		for ( const k of Object.keys( def ) ) if ( ! ( k in fresh ) ) delete ( def as any )[ k ];
		Object.assign( def, fresh );
		this.refreshLooks();

	}

	resetLook( id: string ): void {

		const fresh = this.pristine( id );
		const def = this.definitions[ id ];
		if ( ! fresh || ! def ) return;
		def.look = fresh.look;
		this.refreshLooks();

	}

	resetPhysics( id: string ): void {

		const fresh = this.pristine( id );
		const def = this.definitions[ id ];
		if ( ! fresh || ! def ) return;
		def.physics = fresh.physics;
		def.emitters = fresh.emitters;
		def.behaviors = fresh.behaviors;
		def.flash = fresh.flash;

	}

	/** Spawn options, simulation clock and wind. Keeps the selected effect. */
	resetSpawnSettings(): void {

		const id = this.spawn.presetId;
		Object.assign( this.spawn, DEFAULT_SPAWN, { presetId: id, interval: this.defaultInterval( id ) } );
		this.world.timeScale = 1;
		this.world.paused = false;
		this.world.wind = [ ...DEFAULT_WIND ];
		this.repeatClock = 0;

	}

	resetLighting(): void {

		Object.assign( this.lighting, DEFAULT_LIGHTING );
		this.world.globals.shadowStrength.value = 1;
		this.setEnvironment( this.lighting.environment );

	}

	resetPerformance(): void {

		this.setQualityPreset( 'high' );
		const a = this.world.adaptive;
		a.enabled = true;
		a.targetFps = 60;
		a.scale = 1;
		this.world.debugView = 'none';
		this.world.showRegionBounds = false;

	}

	/** Resets one settings tab. Look and physics apply to the selected effect. */
	reset( scope: ResetScope ): void {

		const id = this.spawn.presetId;
		if ( scope === 'effect' ) this.resetSpawnSettings();
		else if ( scope === 'look' ) this.resetLook( id );
		else if ( scope === 'physics' ) this.resetPhysics( id );
		else if ( scope === 'light' ) this.resetLighting();
		else this.resetPerformance();

	}

	/** Back to the state the page loaded in: no effects, shipped presets, default settings and camera. */
	resetAll(): void {

		if ( ! this.ready ) return;
		this.world.clear();
		for ( const id of Object.keys( this.definitions ) ) {

			if ( PRESETS[ id ] ) this.resetPreset( id );
			else delete this.definitions[ id ];

		}

		this.imported.clear();
		Object.assign( this.spawn, DEFAULT_SPAWN );
		this.world.timeScale = 1;
		this.world.paused = false;
		this.world.wind = [ ...DEFAULT_WIND ];
		this.resetLighting();
		this.resetPerformance();
		this.cameraTween = {
			from: this.camera.position.clone(), to: DEFAULT_CAMERA.position.clone(),
			tFrom: this.controls.target.clone(), tTo: DEFAULT_CAMERA.target.clone(), t: 0,
		};
		this.lastPosition.set( 0, 0, 0 );
		this.spawnSelected();

	}

	private readonly imported = new Map<string, EffectDefinition>();

	private defaultInterval( id: string ): number {

		return id === 'nuke' ? 40 : id === 'cumulus' ? 30 : DEFAULT_SPAWN.interval;

	}

	frameDefinition( def: EffectDefinition, at = new THREE.Vector3() ): void {

		const d = ( def.viewDistance ?? 60 ) * this.spawn.scale;
		const dir = this.camera.position.clone().sub( this.controls.target ).setY( 0 ).normalize();
		if ( dir.lengthSq() < 0.01 ) dir.set( 1, 0, 1 ).normalize();
		const to = at.clone().addScaledVector( dir, d ).setY( at.y + d * 0.32 );
		const tTo = at.clone().setY( at.y + d * 0.22 );
		this.cameraTween = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo, t: 0 };

	}

	spawnSelected( at?: THREE.Vector3 ): void {

		if ( ! this.ready ) return;
		const def = this.definition;
		const p = at ?? new THREE.Vector3();
		this.lastPosition.copy( p );
		const n = Math.max( 1, this.spawn.count );
		for ( let i = 0; i < n; i ++ ) {

			const spread = n > 1 ? ( def.viewDistance ?? 60 ) * this.spawn.scale * 0.45 : 0;
			const a = ( i / n ) * Math.PI * 2 + Math.random() * 0.6;
			const off = i === 0 && n > 1 ? 0 : spread * ( 0.6 + Math.random() * 0.4 );
			this.world.spawn( def, [ p.x + Math.cos( a ) * off, this.world.groundHeight, p.z + Math.sin( a ) * off ], {
				scale: this.spawn.scale * ( n > 1 ? 0.8 + Math.random() * 0.4 : 1 ), rotation: Math.random() * Math.PI * 2,
			} );

		}

		this.repeatClock = 0;

	}

	clear(): void {

		this.world.clear();

	}

	setQualityPreset( q: QualityPreset ): void {

		this.qualityPreset = q;
		Object.assign( this.world.quality, QUALITY_PRESETS[ q ] );

	}

	setDebugView( v: DebugView ): void {

		this.world.debugView = v;

	}

	setEnvironment( mode: 'sky' | 'studio' ): void {

		this.lighting.environment = mode;
		this.env.setMode( mode );
		this.applyLighting();

	}

	applyLighting(): void {

		const l = this.lighting;
		const dir = this.env.setSun( l.elevation, l.azimuth );
		this.world.sun.direction = [ dir.x, dir.y, dir.z ];
		this.world.sun.intensity = l.sunIntensity;
		const lowSun = THREE.MathUtils.smoothstep( l.elevation, 2, 25 );
		this.world.sun.color = [ 1, 0.72 + 0.23 * lowSun, 0.5 + 0.38 * lowSun ];
		this.env.sun.intensity = l.sunIntensity * 0.65;
		this.env.sun.color.setRGB( 1, 0.8 + 0.15 * lowSun, 0.66 + 0.25 * lowSun );
		this.world.ambientLight.intensity = l.ambient;
		this.env.hemi.intensity = 0.9 * l.ambient;
		this.renderer.toneMappingExposure = l.exposure;
		if ( this.bloomNode ) this.bloomNode.strength.value = l.bloom;
		this.world.lightIntensity = l.fireLight;
		const studio = l.environment === 'studio';
		this.world.ambientLight.sky = studio ? [ 0.36, 0.38, 0.42 ] : [ 0.42, 0.55, 0.78 ];
		const fogColor = studio ? 0x1d1e20 : 0x9fb3c8;
		( this.scene.fog as THREE.FogExp2 ).color.set( fogColor );
		( this.scene.fog as THREE.FogExp2 ).density = l.fog * 0.001;
		this.world.globals.fogColor.value.set( fogColor );
		this.world.globals.fogDensity.value = l.fog * 0.001;

	}

	/** Applies the edited definition's look to running effects that use it. */
	refreshLooks(): void {

		for ( const e of this.world.effects ) {

			const def = this.definitions[ e.definition.id ];
			if ( def && e.definition === def ) e.look = { ...def.look };

		}

	}

	dispose(): void {

		this.disposed = true;
		if ( ! this.ready ) return;
		this.renderer?.setAnimationLoop( null );
		this.resizeObserver?.disconnect();
		this.renderer?.domElement.removeEventListener( 'pointerdown', this.onPointerDown );
		this.renderer?.domElement.removeEventListener( 'pointerup', this.onPointerUp );
		this.world?.dispose();
		this.renderer?.dispose();
		this.renderer?.domElement.remove();

	}

	// ---------------------------------------------------------------------------------------------

	private resize(): void {

		if ( ! this.container ) return;
		const w = this.container.clientWidth, h = this.container.clientHeight;
		if ( w === 0 || h === 0 ) return;
		this.renderer.setSize( w, h, false );
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();

	}

	private onPointerDown = ( e: PointerEvent ) => {

		this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };

	};

	private onPointerUp = ( e: PointerEvent ) => {

		const d = this.pointerDown;
		this.pointerDown = null;
		if ( ! d || ! this.spawn.clickToSpawn || e.button !== 0 ) return;
		if ( Math.hypot( e.clientX - d.x, e.clientY - d.y ) > 5 || performance.now() - d.t > 400 ) return;
		const rect = this.renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2( ( ( e.clientX - rect.left ) / rect.width ) * 2 - 1, - ( ( e.clientY - rect.top ) / rect.height ) * 2 + 1 );
		const ray = new THREE.Raycaster();
		ray.setFromCamera( ndc, this.camera );
		const hit = new THREE.Vector3();
		if ( ray.ray.intersectPlane( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ), hit ) ) {

			if ( hit.distanceTo( this.camera.position ) < 12000 ) this.spawnSelected( hit );

		}

	};

	private loop = ( time: number ) => {

		this.timer.update( time );
		const dt = Math.min( this.timer.getDelta(), 0.25 );
		if ( ! this.active ) return;

		if ( this.cameraTween ) {

			const c = this.cameraTween;
			c.t = Math.min( 1, c.t + dt / 1.2 );
			const k = c.t * c.t * ( 3 - 2 * c.t );
			this.camera.position.lerpVectors( c.from, c.to, k );
			this.controls.target.lerpVectors( c.tFrom, c.tTo, k );
			if ( c.t >= 1 ) this.cameraTween = null;

		}

		this.controls.update( dt );

		if ( this.spawn.autoRepeat && ! this.world.paused ) {

			this.repeatClock += dt * this.world.timeScale;
			if ( this.repeatClock >= this.spawn.interval ) this.spawnSelected( this.lastPosition );

		}

		this.env.followCamera( this.controls.target, this.camera.position.distanceTo( this.controls.target ) );

		// flash → exposure kick
		const flash = Math.min( 1, this.world.flash / 40 );
		this.renderer.toneMappingExposure = this.lighting.exposure * ( 1 + flash * 0.8 );

		this.world.update( dt, this.camera );
		this.pipeline.render();

		// stats
		this.frameCount ++;
		if ( dt > 0 ) {

			this.fpsEma += ( 1 / dt - this.fpsEma ) * 0.05;
			this.frameEma += ( dt * 1000 - this.frameEma ) * 0.05;

		}

		if ( this.frameCount % 15 === 0 ) {

			const s: FrameStats = {
				fps: this.fpsEma, frameMs: this.frameEma, world: { ...this.world.stats },
			};
			for ( const l of this.listeners ) l( s );

		}

	};

}
