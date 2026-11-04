import type { EffectDefinition, QualitySettings, SunSettings, Vec3Tuple } from '../core/types';
import { PRESETS } from '../presets';
import { QUALITY_PRESETS } from '../world/quality';

/** Pretty JSON that keeps short number arrays (ranges, colours, vectors) on one line. */
function prettyJSON( value: unknown ): string {

	return JSON.stringify( value, null, 2 ).replace(
		/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g,
		( _, items: string ) => `[ ${ items.split( /,\s*/ ).join( ', ' ) } ]`,
	);

}

/** Stable, pretty JSON for an effect definition. */
export function exportEffectJSON( def: EffectDefinition ): string {

	return prettyJSON( def );

}

/** Parses and minimally validates an exported effect. */
export function importEffectJSON( json: string ): EffectDefinition {

	const def = JSON.parse( json ) as EffectDefinition;
	if ( ! def || typeof def !== 'object' || ! Array.isArray( def.emitters ) || ! def.look || ! def.physics ) {

		throw new Error( 'voluxel: not an effect definition (needs id, look, physics, emitters)' );

	}

	return def;

}

export interface CodegenOptions {
	definition: EffectDefinition;
	position?: Vec3Tuple;
	scale?: number;
	quality?: Partial<QualitySettings>;
	sun?: SunSettings;
	wind?: Vec3Tuple;
	/** Emit a full standalone scene (renderer, camera, loop) instead of an integration snippet. */
	standalone?: boolean;
	bloom?: boolean;
}

const fmt = ( v: number ) => ( Math.round( v * 1000 ) / 1000 ).toString();
const tuple = ( t: readonly number[] ) => `[ ${ t.map( fmt ).join( ', ' ) } ]`;

/**
 * Shortest faithful quality expression: a preset name when the settings match one exactly,
 * otherwise only the keys that differ from 'high' (VoluxelWorld merges partials over 'high').
 */
function qualityExpr( q: Partial<QualitySettings> | undefined ): string {

	if ( ! q ) return `'high'`;
	const keys = Object.keys( QUALITY_PRESETS.high ) as ( keyof QualitySettings )[];
	for ( const [ name, preset ] of Object.entries( QUALITY_PRESETS ) ) {

		if ( keys.every( ( k ) => q[ k ] === undefined || q[ k ] === preset[ k ] ) ) return `'${ name }'`;

	}

	const diff = keys.filter( ( k ) => q[ k ] !== undefined && q[ k ] !== QUALITY_PRESETS.high[ k ] );
	const fmtVal = ( v: unknown ) => ( typeof v === 'number' ? fmt( v ) : String( v ) );
	return `{ ${ diff.map( ( k ) => `${ k }: ${ fmtVal( q[ k ] ) }` ).join( ', ' ) } }`;

}

/** True when the definition is byte-identical to a built-in preset. */
function builtinId( def: EffectDefinition ): string | null {

	const p = PRESETS[ def.id ];
	return p && JSON.stringify( p ) === JSON.stringify( def ) ? def.id : null;

}

/**
 * TypeScript that recreates the current effect in any three.js WebGPU scene. Built-in presets
 * are referenced by name; edited ones are inlined as JSON so the snippet is self-contained.
 */
export function generateCode( o: CodegenOptions ): string {

	const id = builtinId( o.definition );
	const pos = tuple( o.position ?? [ 0, 0, 0 ] );
	const scale = fmt( o.scale ?? o.definition.scale ?? 1 );
	const effectExpr = id ? `'${ id }'` : 'effect';
	const effectDecl = id ? '' : `\n// Edited in the Voluxel playground\nconst effect: EffectDefinition = ${ prettyJSON( o.definition ) };\n`;
	const quality = `\n\tquality: ${ qualityExpr( o.quality ) },`;
	const sun = o.sun ? `\n\tsun: { direction: ${ tuple( o.sun.direction ) }, color: ${ tuple( o.sun.color ) }, intensity: ${ fmt( o.sun.intensity ) } },` : '';
	const wind = o.wind ? `\n\twind: ${ tuple( o.wind ) },` : '';

	const imports = id ? `import { VoluxelWorld, createVoluxelPipeline } from 'voluxel';` : `import { VoluxelWorld, createVoluxelPipeline, type EffectDefinition } from 'voluxel';`;

	if ( ! o.standalone ) {

		return `import * as THREE from 'three/webgpu';
${ imports }
${ effectDecl }
// renderer: THREE.WebGPURenderer (after await renderer.init()), scene, camera already exist
const world = new VoluxelWorld( renderer, {${ quality }${ sun }${ wind }
	adaptive: { enabled: true, targetFps: 60 },
} );
await world.init();
scene.add( world.lights ); // fire glow lights

// volume shadows on your receivers (sun must cast shadows)
ground.material.receivedShadowNode = world.receivedShadow();

const { pipeline } = createVoluxelPipeline( renderer, scene, camera, world, { bloom: ${ o.bloom ?? true } } );

world.spawn( ${ effectExpr }, ${ pos }, { scale: ${ scale } } );

const timer = new THREE.Timer();
renderer.setAnimationLoop( ( t ) => {
	timer.update( t );
	world.update( timer.getDelta(), camera );
	pipeline.render();
} );
`;

	}

	return `import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
${ imports }
${ effectDecl }
const renderer = new THREE.WebGPURenderer( { antialias: false } );
renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x8ea7c4 );
const camera = new THREE.PerspectiveCamera( 50, innerWidth / innerHeight, 0.5, 20000 );
const d = ${ fmt( ( o.definition.viewDistance ?? 60 ) * ( o.scale ?? 1 ) ) };
camera.position.set( d * 0.8, d * 0.35, d * 0.8 );
const controls = new OrbitControls( camera, renderer.domElement );
controls.target.set( 0, d * 0.2, 0 );

const sunLight = new THREE.DirectionalLight( 0xfff2e0, 3 );
sunLight.position.set( ${ tuple( ( o.sun?.direction ?? [ - 0.45, 0.62, 0.35 ] ).map( ( v ) => v * 100 ) ) } );
scene.add( sunLight, new THREE.HemisphereLight( 0x9fb8d8, 0x302a24, 0.6 ) );

const ground = new THREE.Mesh( new THREE.PlaneGeometry( 4000, 4000 ), new THREE.MeshStandardNodeMaterial( { color: 0x3a3a3a } ) );
ground.rotation.x = - Math.PI / 2;
ground.receiveShadow = true;
scene.add( ground );

const world = new VoluxelWorld( renderer, {${ quality }${ sun }${ wind }
	adaptive: { enabled: true, targetFps: 60 },
} );
await world.init();
scene.add( world.lights );
ground.material.receivedShadowNode = world.receivedShadow();
sunLight.castShadow = true;

const { pipeline } = createVoluxelPipeline( renderer, scene, camera, world, { bloom: ${ o.bloom ?? true } } );

world.spawn( ${ effectExpr }, ${ pos }, { scale: ${ scale } } );

addEventListener( 'resize', () => {
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( innerWidth, innerHeight );
} );

const timer = new THREE.Timer();
renderer.setAnimationLoop( ( t ) => {
	timer.update( t );
	controls.update();
	world.update( timer.getDelta(), camera );
	pipeline.render();
} );
`;

}
