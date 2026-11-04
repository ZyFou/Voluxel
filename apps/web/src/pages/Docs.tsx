import { useEffect, useState, type ReactNode } from 'react';
import { QUALITY_PRESETS } from 'voluxel';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CodeBlock } from '@/components/CodeBlock';
import { cn } from '@/lib/utils';
import {
	EFFECT_ROWS, EMITTER_ROWS, LOOK_ROWS, PRESET_ROWS, QUALITY_ROWS, WORLD_METHODS, WORLD_OPTIONS, WORLD_PROPS, type ApiRow,
} from './docs-data';

const TOC = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'install', label: 'Install' },
	{ id: 'quick-start', label: 'Quick start' },
	{ id: 'integration', label: 'Manual integration' },
	{ id: 'pipeline', label: 'How it works' },
	{ id: 'voluxelworld', label: 'VoluxelWorld' },
	{ id: 'effects', label: 'Effect definitions' },
	{ id: 'presets', label: 'Presets' },
	{ id: 'quality', label: 'Quality & performance' },
	{ id: 'export', label: 'Export & reuse' },
	{ id: 'support', label: 'Browser support' },
];

function H2( { id, children }: { id: string; children: ReactNode } ) {

	return <h2 id={id} className="scroll-mt-6 border-b border-border pb-2 pt-10 text-xl font-semibold tracking-tight first:pt-0">{children}</h2>;

}

function H3( { children }: { children: ReactNode } ) {

	return <h3 className="pt-6 text-sm font-semibold">{children}</h3>;

}

function P( { children }: { children: ReactNode } ) {

	return <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;

}

function C( { children }: { children: ReactNode } ) {

	return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>;

}

function ApiTable( { rows, showDefault = false }: { rows: ApiRow[]; showDefault?: boolean } ) {

	return (
		<div className="mt-3 overflow-hidden rounded-lg border border-border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[30%] text-xs">Name</TableHead>
						<TableHead className="w-[22%] text-xs">Type</TableHead>
						{showDefault && <TableHead className="text-xs">Default</TableHead>}
						<TableHead className="text-xs">Description</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map( ( r ) => (
						<TableRow key={r.name}>
							<TableCell className="align-top font-mono text-[12px] whitespace-normal">{r.name}</TableCell>
							<TableCell className="align-top font-mono text-[11px] whitespace-normal text-sky-300/90">{r.type}</TableCell>
							{showDefault && <TableCell className="align-top font-mono text-[11px] whitespace-normal text-muted-foreground">{r.default}</TableCell>}
							<TableCell className="align-top text-xs leading-relaxed whitespace-normal text-muted-foreground">{r.description}</TableCell>
						</TableRow>
					) )}
				</TableBody>
			</Table>
		</div>
	);

}

const QUICK_START = `import * as THREE from 'three/webgpu';
import { VoluxelWorld, createVoluxelPipeline } from 'voluxel';

const renderer = new THREE.WebGPURenderer();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
await renderer.init();

const world = new VoluxelWorld( renderer, { quality: 'high', adaptive: { targetFps: 60 } } );
await world.init();
scene.add( world.lights );                              // fire glow on your scene
ground.material.receivedShadowNode = world.receivedShadow(); // volume shadows

const { pipeline } = createVoluxelPipeline( renderer, scene, camera, world, { bloom: true } );

world.spawn( 'fireExplosion', [ 0, 0, 0 ] );
world.spawn( 'nuke', [ 800, 0, -400 ], { scale: 1.2 } );

const timer = new THREE.Timer();
renderer.setAnimationLoop( ( t ) => {
  timer.update( t );
  world.update( timer.getDelta(), camera );
  pipeline.render();
} );`;

const MANUAL = `import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const scenePass = pass( scene, camera );                 // your opaque scene + depth
const volumes = world.createVolumePass( scenePass, camera ); // half-res, depth-aware raymarch
const color = volumes.composite( scenePass );             // scene * (1 - a) + volume (premultiplied)

// bloom only the volume layer so hot fire glows without hazing a bright sky
const glow = bloom( volumes.pass.getTextureNode(), 0.6, 0.5, 1.1 );

const pipeline = new THREE.RenderPipeline( renderer, color.add( glow ) );`;

const CUSTOM = `import { VoluxelWorld, type EffectDefinition } from 'voluxel';

const napalm: EffectDefinition = {
  id: 'napalm', name: 'Napalm line',
  look: { smokeColor: [0.3, 0.29, 0.28], sootColor: [0.03, 0.025, 0.02],
          threshold: 0.16, softness: 0.3, erosion: 0.5, detailScale: 0.8,
          emission: 3.5, emissionThreshold: 0.25, glow: 2.5 },
  physics: { buoyancy: 6, drag: 1, quadraticDrag: 0.05,
             turbulence: { amplitude: 2, frequency: 0.1 } },
  emitters: [ {
    type: 'continuous', shape: 'disc', radius: 3, duration: 1.2, rate: 90,
    velocity: { directional: [ 30, 45 ], direction: [ 1, 0.15, 0 ], random: 4 },
    particle: { radius: [ 1.2, 2 ], growth: [ 2, 4 ], density: [ 1, 1.3 ],
                temperature: [ 1.2, 1.6 ], cooling: 0.45, soot: [ 0.7, 0.9 ], life: [ 6, 9 ] },
    children: { count: 3, scale: [ 0.45, 0.65 ], distance: [ 0.6, 0.9 ] },
  } ],
  minVoxelSize: 0.12,
};

world.spawn( napalm, [ 0, 0, 0 ], { rotation: Math.PI / 4 } );`;

const IMPORT = `import { importEffectJSON } from 'voluxel';
import blast from './my-blast.voluxel.json?raw';

const def = importEffectJSON( blast );   // validated EffectDefinition
world.spawn( def, hitPoint, { scale: 1.5, seed: 42 } );   // same seed → same explosion`;

const STAGES = [
	{ t: 'Billow simulation', d: 'CPU, structure-of-arrays. Emitters spawn billows; buoyancy, quadratic drag, divergence-free turbulence, wind, ground friction and group behaviours (vortex ring, updraft) move them. Sub-billows ride on their parents.' },
	{ t: 'Region merging', d: 'Effects whose bounds overlap are clustered (union) into one region; if the pool is exhausted the pair with the smallest union volume merges. Merged effects share a grid, a raymarch and their shadows.' },
	{ t: 'LOD', d: 'Voxel size = max(screen-coverage target, effect detail floor, texture fit), snapped to a quarter-octave ladder with hysteresis. Far regions also get time-sliced.' },
	{ t: 'Culling', d: 'Region boxes extended by their sun-projected ground footprint are frustum tested; culled regions skip all GPU work but keep simulating.' },
	{ t: 'Chunking (8³ bricks)', d: 'Billows are counting-sorted into the bricks they touch. Only occupied bricks are dispatched; bricks that emptied since the last update are cleared. An occupancy grid is uploaded for ray skipping.' },
	{ t: 'Voxelise', d: 'Compute kernel, 8 workgroups per brick: each voxel gathers its brick list into density, temperature, soot, extinction and velocity (two rgba16f 3D textures).' },
	{ t: 'Light volume', d: 'Half resolution, one workgroup per brick: sun transmittance march, sky visibility, fire glow gathered from a 29-tap stencil.' },
	{ t: 'Shadow map', d: 'Sun-space deep opacity: total transmittance plus entry/exit depth so receivers inside or above the volume are not wrongly darkened.' },
	{ t: 'Raymarch', d: 'Reduced-resolution pass. Brick skipping, flow-advected billowy Worley erosion, detail shadow rays, multi-octave multiple scattering, dual-lobe phase, blackbody emission. Depth-aware against the scene.' },
	{ t: 'Composite', d: 'Premultiplied over the scene, volume-only bloom, adaptive resolution steering toward the frame-rate target.' },
];

export function Docs() {

	const [ activeId, setActiveId ] = useState( 'overview' );

	useEffect( () => {

		const els = TOC.map( ( t ) => document.getElementById( t.id ) ).filter( Boolean ) as HTMLElement[];
		const io = new IntersectionObserver( ( entries ) => {

			const visible = entries.filter( ( e ) => e.isIntersecting ).sort( ( a, b ) => a.boundingClientRect.top - b.boundingClientRect.top );
			if ( visible[ 0 ] ) setActiveId( visible[ 0 ].target.id );

		}, { rootMargin: '0px 0px -70% 0px' } );
		els.forEach( ( el ) => io.observe( el ) );
		return () => io.disconnect();

	}, [] );

	return (
		<div className="flex h-full min-h-0">
			<nav className="hidden w-56 shrink-0 border-r border-border p-5 md:block" aria-label="Documentation sections">
				<p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">API documentation</p>
				<ul className="space-y-0.5">
					{TOC.map( ( t ) => (
						<li key={t.id}>
							<a
								href={`#/docs/${ t.id }`}
								onClick={( e ) => {

									e.preventDefault();
									document.getElementById( t.id )?.scrollIntoView( { behavior: 'smooth' } );

								}}
								className={cn(
									'block rounded px-2 py-1 text-sm transition-colors hover:text-foreground',
									activeId === t.id ? 'bg-accent text-foreground' : 'text-muted-foreground',
								)}
							>
								{t.label}
							</a>
						</li>
					) )}
				</ul>
			</nav>

			<ScrollArea className="min-w-0 flex-1">
				<article className="mx-auto max-w-4xl px-6 py-8 md:px-10">
					<H2 id="overview">Voluxel</H2>
					<P>
						Voxel smoke, fire and explosion volumes for three.js on WebGPU. Effects are authored as billows (spheres with
						physics), voxelised every frame into sparse 8³ bricks, lit with precomputed light volumes and raymarched at reduced
						resolution. Overlapping effects merge into shared regions, each region picks its own level of detail, and a frame-time
						controller keeps the whole thing on budget.
					</P>
					<div className="mt-4 flex flex-wrap gap-1.5">
						{[ 'three r187+', 'WebGPU + TSL', 'compute shaders', 'sparse bricks', 'LOD ladder', 'frustum & shadow culling', 'region merging', 'time slicing', 'adaptive resolution', 'JSON effects' ].map( ( b ) => (
							<Badge key={b} variant="secondary" className="font-normal">{b}</Badge>
						) )}
					</div>

					<H2 id="install">Install</H2>
					<CodeBlock className="mt-3" code="npm install voluxel three@^0.187.0" language="bash" />
					<P>
						Voluxel ships as ES modules and imports <C>three/webgpu</C>, <C>three/tsl</C> and <C>three/addons</C> as peers. It needs a
						<C>WebGPURenderer</C> running on the WebGPU backend (the WebGL2 fallback has no storage textures).
					</P>

					<H2 id="quick-start">Quick start</H2>
					<P>The pipeline helper sets up the scene pass, the depth-aware volume pass, the composite and optional bloom.</P>
					<CodeBlock className="mt-3" code={QUICK_START} filename="main.ts" />

					<H2 id="integration">Manual integration</H2>
					<P>
						If you already own a <C>RenderPipeline</C>, add the volume pass yourself. The volume material reads your scene pass depth
						so smoke wraps around buildings and the camera can fly through it.
					</P>
					<CodeBlock className="mt-3" code={MANUAL} filename="pipeline.ts" />
					<H3>Shadows and fire light</H3>
					<P>
						<C>world.receivedShadow()</C> plugs into any node material&apos;s <C>receivedShadowNode</C>. The directional light must have
						<C>castShadow = true</C> and the mesh <C>receiveShadow = true</C>. Add <C>world.lights</C> to your scene for per-region fire
						light (blackbody coloured, positioned at the emission centroid).
					</P>

					<H2 id="pipeline">How it works</H2>
					<ol className="mt-4 space-y-2">
						{STAGES.map( ( s, i ) => (
							<li key={s.t} className="flex gap-3 rounded-lg border border-border p-3">
								<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px]">{i + 1}</span>
								<div>
									<div className="text-sm font-medium">{s.t}</div>
									<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.d}</p>
								</div>
							</li>
						) )}
					</ol>

					<H2 id="voluxelworld">VoluxelWorld</H2>
					<CodeBlock className="mt-3" code="new VoluxelWorld( renderer: WebGPURenderer, options?: VoluxelWorldOptions )" />
					<H3>Options</H3>
					<ApiTable rows={WORLD_OPTIONS} showDefault />
					<H3>Methods</H3>
					<ApiTable rows={WORLD_METHODS} />
					<H3>Properties</H3>
					<ApiTable rows={WORLD_PROPS} />
					<H3>VoluxelEffect</H3>
					<P>
						Returned by <C>spawn()</C>. Read <C>time</C>, <C>count</C> (live billows), <C>boundsMin / boundsMax</C>, <C>emission</C>,
						<C>finished</C>; call <C>kill()</C> to stop it. <C>look</C> can be reassigned at runtime.
					</P>
					<H3>createVoluxelPipeline( renderer, scene, camera, world, options? )</H3>
					<P>Returns <C>{'{ pipeline, scenePass, volumePass, bloom }'}</C>. Options: <C>bloom: boolean | {'{ strength, radius, threshold }'}</C>.</P>

					<H2 id="effects">Effect definitions</H2>
					<P>Effects are plain JSON. Units are metres and seconds at scale 1; scaling an effect scales sizes, speeds and forces together so the timing stays the same.</P>
					<H3>EffectDefinition</H3>
					<ApiTable rows={EFFECT_ROWS} showDefault />
					<H3>EmitterDefinition</H3>
					<ApiTable rows={EMITTER_ROWS} />
					<H3>LookDefinition</H3>
					<ApiTable rows={LOOK_ROWS} />
					<H3>Behaviours</H3>
					<P>
						<C>vortexRing</C> spins a group around its own ring core (up through the middle, out over the top, down the outside): the
						mushroom cap. <C>updraft</C> lifts a group toward the underside of a <C>target</C> group with radial inflow: the stem.
						<C>attract</C> accelerates a group toward another group&apos;s centroid.
					</P>
					<H3>Writing your own</H3>
					<CodeBlock className="mt-3" code={CUSTOM} filename="napalm.ts" />

					<H2 id="presets">Presets</H2>
					<div className="mt-3 overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="text-xs">id</TableHead>
									<TableHead className="text-xs">Kind</TableHead>
									<TableHead className="text-xs">Notes</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{PRESET_ROWS.map( ( r ) => (
									<TableRow key={r.id}>
										<TableCell className="font-mono text-[12px]">{r.id}</TableCell>
										<TableCell className="text-xs">{r.kind}</TableCell>
										<TableCell className="text-xs whitespace-normal text-muted-foreground">{r.notes}</TableCell>
									</TableRow>
								) )}
							</TableBody>
						</Table>
					</div>
					<P>Use <C>clonePreset( PRESETS.nuke )</C> before editing so the built-ins stay intact.</P>

					<H2 id="quality">Quality & performance</H2>
					<ApiTable rows={QUALITY_ROWS} />
					<H3>Presets</H3>
					<div className="mt-3 overflow-x-auto rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="text-xs">setting</TableHead>
									{Object.keys( QUALITY_PRESETS ).map( ( k ) => <TableHead key={k} className="text-xs capitalize">{k}</TableHead> )}
								</TableRow>
							</TableHeader>
							<TableBody>
								{( [ 'renderScale', 'pixelsPerVoxel', 'stepScale', 'maxSteps', 'lightSteps', 'detailShadowSteps', 'flowNoise', 'timeSlicing' ] as const ).map( ( key ) => (
									<TableRow key={key}>
										<TableCell className="font-mono text-[12px]">{key}</TableCell>
										{Object.values( QUALITY_PRESETS ).map( ( q, i ) => <TableCell key={i} className="font-mono text-[12px] text-muted-foreground">{String( q[ key ] )}</TableCell> )}
									</TableRow>
								) )}
							</TableBody>
						</Table>
					</div>
					<H3>Budgeting tips</H3>
					<ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
						<li>Cost scales with <em>occupied bricks</em> (voxelise, light) and <em>covered pixels × steps</em> (raymarch). Watch both in <C>world.stats</C>.</li>
						<li><C>renderScale</C> is the strongest lever on mid-range GPUs; 0.5 looks close to full resolution because the volumes are soft.</li>
						<li>Raise <C>minVoxelSize</C> on huge effects (the nuke uses 1.5 m) so close-ups do not burn the brick budget.</li>
						<li>Keep sub-billows (<C>children</C>) for detail instead of raising billow counts: they are cheap on the CPU and bin into the same bricks.</li>
						<li>Leave adaptive quality on in production: it only lowers resolution, LOD and step counts while the frame time is over budget.</li>
					</ul>

					<H2 id="export">Export & reuse</H2>
					<P>
						In the playground, <em>Export to three.js</em> produces an integration snippet, a standalone scene and the effect JSON for the
						current preset, scale, sun, wind and quality. Built-in presets are referenced by id; edited ones are inlined. Spawning with a
						fixed <C>seed</C> reproduces an effect exactly.
					</P>
					<CodeBlock className="mt-3" code={IMPORT} filename="load.ts" />

					<H2 id="support">Browser support</H2>
					<P>
						Chrome / Edge 113+ on Windows, macOS, ChromeOS and Android; Safari 26+; Firefox with WebGPU enabled. Requires
						<C>rgba16float</C> storage textures, which are part of core WebGPU.
					</P>
					<div className="h-16" />
				</article>
			</ScrollArea>
		</div>
	);

}
