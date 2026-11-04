/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom as bloomNode } from 'three/addons/tsl/display/BloomNode.js';
import type { VoluxelWorld } from '../world/VoluxelWorld';

export interface VoluxelPipelineOptions {
	/** Adds a bloom pass on top of the composite (recommended for fire). */
	bloom?: boolean | { strength?: number; radius?: number; threshold?: number };
}

/**
 * One-call render setup: scene pass → reduced-resolution volume pass (depth aware) →
 * composite → optional bloom. Call `pipeline.render()` instead of `renderer.render()`.
 */
export function createVoluxelPipeline(
	renderer: THREE.WebGPURenderer,
	scene: THREE.Scene,
	camera: THREE.PerspectiveCamera,
	world: VoluxelWorld,
	options: VoluxelPipelineOptions = {},
) {

	const scenePass = pass( scene, camera );
	const volumes = world.createVolumePass( scenePass, camera );
	let output: any = volumes.composite( scenePass );
	let bloom: any = null;

	if ( options.bloom ) {

		// bloom the emission-only target: fire glows, sunlit smoke and bright skies do not halo
		const o = typeof options.bloom === 'object' ? options.bloom : {};
		bloom = bloomNode( volumes.emissive, o.strength ?? 0.6, o.radius ?? 0.5, o.threshold ?? 0.6 );
		output = output.add( bloom );

	}

	const pipeline = new THREE.RenderPipeline( renderer, output );
	return { pipeline, scenePass, volumePass: volumes.pass, bloom };

}
