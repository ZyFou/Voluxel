/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import {
	abs, clamp, color, float, fract, fwidth, length, max, min, mix, positionWorld, cameraPosition, smoothstep, vec2, uniform,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

type N = any;

/** Anti-aliased grid line mask for a given spacing (world units). */
function gridLines( p: N, spacing: number, width: number ): N {

	const coord = p.div( spacing );
	const g: N = abs( fract( coord.sub( 0.5 ) ).sub( 0.5 ) ).div( fwidth( coord ) );
	const line = min( g.x, g.y );
	return float( 1 ).sub( min( line.div( width ), 1 ) );

}

export interface Environment {
	group: THREE.Group;
	ground: THREE.Mesh;
	groundMaterial: THREE.MeshStandardNodeMaterial;
	sky: SkyMesh;
	sun: THREE.DirectionalLight;
	hemi: THREE.HemisphereLight;
	studio: { value: number };
	setMode( mode: 'sky' | 'studio' ): void;
	setSun( elevationDeg: number, azimuthDeg: number ): THREE.Vector3;
	followCamera( target: THREE.Vector3, distance: number ): void;
}

export function createEnvironment( scene: THREE.Scene ): Environment {

	const group = new THREE.Group();
	group.name = 'environment';

	// --- sky ---
	const sky = new SkyMesh();
	sky.scale.setScalar( 14000 );
	sky.turbidity.value = 3.5;
	sky.rayleigh.value = 1.4;
	sky.mieCoefficient.value = 0.004;
	sky.mieDirectionalG.value = 0.8;
	( sky as any ).cloudCoverage.value = 0.18;
	( sky as any ).cloudDensity.value = 0.25;
	// the analytic sky is calibrated for exposure ~0.5; scale it so lights and volumes can use exposure 1
	const skyMat = sky.material as THREE.NodeMaterial;
	skyMat.colorNode = ( skyMat.colorNode as any ).mul( 0.42 );
	group.add( sky );

	// --- ground: dark technical grid like the reference viewport ---
	const studio = uniform( 0 );
	const groundMaterial = new THREE.MeshStandardNodeMaterial( { roughness: 0.92, metalness: 0 } );
	const p = vec2( positionWorld.x, positionWorld.z );
	const dist = length( positionWorld.sub( cameraPosition ) );
	const fine = gridLines( p, 10, 1.0 ).mul( smoothstep( 600, 120, dist ) ).mul( 0.35 );
	const coarse = gridLines( p, 100, 1.4 ).mul( smoothstep( 6000, 600, dist ) ).mul( 0.55 );
	const km = gridLines( p, 1000, 2.0 ).mul( 0.6 );
	const lines = clamp( max( max( fine, coarse ), km ), 0, 1 );
	const base = mix( color( 0x2d2f2b ), color( 0x272828 ), studio );
	const lineCol = mix( color( 0x474a44 ), color( 0x3e4040 ), studio );
	groundMaterial.colorNode = mix( base, lineCol, lines );

	const ground = new THREE.Mesh( new THREE.PlaneGeometry( 30000, 30000 ), groundMaterial );
	ground.rotation.x = - Math.PI / 2;
	ground.receiveShadow = true;
	ground.name = 'ground';
	group.add( ground );

	// --- a few blocks for scale and to show volumes wrapping around geometry ---
	const blockMat = new THREE.MeshStandardNodeMaterial( { color: 0x8a8781, roughness: 0.85 } );
	const blocks = new THREE.Group();
	const rnd = ( () => {

		let s = 7;
		return () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );

	} )();
	for ( let i = 0; i < 14; i ++ ) {

		const w = 6 + rnd() * 10, d = 6 + rnd() * 10, h = 5 + rnd() * 22;
		const m = new THREE.Mesh( new THREE.BoxGeometry( w, h, d ), blockMat );
		const a = rnd() * Math.PI * 2, r = 45 + rnd() * 60;
		m.position.set( Math.cos( a ) * r, h / 2, Math.sin( a ) * r );
		m.rotation.y = rnd() * Math.PI;
		m.castShadow = m.receiveShadow = true;
		blocks.add( m );

	}

	group.add( blocks );

	// --- lights ---
	const sun = new THREE.DirectionalLight( 0xfff1df, 3.2 );
	sun.castShadow = true;
	sun.shadow.mapSize.set( 2048, 2048 );
	sun.shadow.bias = - 0.0004;
	sun.shadow.normalBias = 0.6;
	const sc = sun.shadow.camera;
	sc.left = sc.bottom = - 160; sc.right = sc.top = 160; sc.near = 1; sc.far = 3000;
	group.add( sun, sun.target );

	const hemi = new THREE.HemisphereLight( 0x9db6d6, 0x3a332c, 0.9 );
	group.add( hemi );

	scene.add( group );

	const sunDir = new THREE.Vector3();
	const env: Environment = {
		group, ground, groundMaterial, sky, sun, hemi, studio,
		setMode( mode ) {

			studio.value = mode === 'studio' ? 1 : 0;
			sky.visible = mode === 'sky';
			scene.background = mode === 'studio' ? new THREE.Color( 0x1d1e20 ) : null;
			blocks.visible = mode === 'sky';

		},
		setSun( elevationDeg, azimuthDeg ) {

			const phi = THREE.MathUtils.degToRad( 90 - elevationDeg );
			const theta = THREE.MathUtils.degToRad( azimuthDeg );
			sunDir.setFromSphericalCoords( 1, phi, theta );
			sky.sunPosition.value.copy( sunDir );
			return sunDir;

		},
		followCamera( target, distance ) {

			// keep the sun shadow frustum around what the camera looks at
			const extent = THREE.MathUtils.clamp( distance * 0.9, 60, 1500 );
			sc.left = sc.bottom = - extent; sc.right = sc.top = extent;
			sc.far = extent * 6;
			sc.updateProjectionMatrix();
			sun.target.position.copy( target ).setY( 0 );
			sun.position.copy( sun.target.position ).addScaledVector( sunDir, extent * 3 );
			sun.target.updateMatrixWorld();

		},
	};
	return env;

}
