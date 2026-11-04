import { PRESET_GROUPS, type QualityPreset, type DebugView } from 'voluxel';
import { Bomb, Eraser, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ColorRow, Section, SliderRow, SwitchRow } from './controls';
import { useEngine } from './engine-context';
import { ImportDialog } from './ImportDialog';

// ---------------------------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------------------------

export function EffectPanel() {

	const { engine, bump, version } = useEngine();
	const s = engine.spawn;
	const w = engine.world;
	const custom = Object.keys( engine.definitions ).filter( ( id ) => ! PRESET_GROUPS.some( ( g ) => g.ids.includes( id ) ) );
	const groups = custom.length ? [ ...PRESET_GROUPS, { label: 'Imported', ids: custom } ] : PRESET_GROUPS;

	return (
		<div key={version}>
			{groups.map( ( g ) => (
				<Section key={g.label} title={g.label}>
					<div className="grid grid-cols-1 gap-1.5">
						{g.ids.map( ( id ) => {

							const def = engine.definitions[ id ];
							const active = s.presetId === id;
							return (
								<button
									key={id}
									type="button"
									onClick={() => {

										engine.selectPreset( id );
										engine.spawnSelected();
										bump();

									}}
									className={cn(
										'rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
										active ? 'border-orange-400/60 bg-orange-500/10' : 'border-border hover:bg-accent/60',
									)}
									aria-pressed={active}
								>
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium">{def.name}</span>
										{active && <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">selected</Badge>}
									</div>
									<p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{def.description}</p>
								</button>
							);

						} )}
					</div>
				</Section>
			) )}

			<Section title="Spawn">
				<div className="flex gap-2">
					<Button className="flex-1 bg-orange-500 text-black hover:bg-orange-400" onClick={() => engine.spawnSelected()}>
						<Bomb className="size-4" /> Detonate
					</Button>
					<Button variant="secondary" onClick={() => engine.clear()}>
						<Eraser className="size-4" /> Clear
					</Button>
				</div>
				<SliderRow label="Scale" value={s.scale} min={0.25} max={4} step={0.05} unit="×" hint="Uniform size multiplier. Velocities and forces scale with it so timing is preserved." onChange={( v ) => ( s.scale = v )} />
				<SliderRow label="Instances" value={s.count} min={1} max={6} step={1} hint="Spawns several effects around the point. Overlapping ones merge into a shared voxel region." onChange={( v ) => ( s.count = v )} />
				<SwitchRow label="Auto repeat" checked={s.autoRepeat} onChange={( v ) => ( s.autoRepeat = v )} />
				<SliderRow label="Repeat every" value={s.interval} min={2} max={60} step={1} unit="s" onChange={( v ) => ( s.interval = v )} />
				<SwitchRow label="Click ground to spawn" checked={s.clickToSpawn} onChange={( v ) => ( s.clickToSpawn = v )} />
			</Section>

			<Section title="Time & wind">
				<SliderRow label="Time scale" value={w.timeScale} min={0} max={2} step={0.05} unit="×" onChange={( v ) => ( w.timeScale = v )} />
				<SwitchRow label="Pause simulation" checked={w.paused} onChange={( v ) => ( w.paused = v )} />
				<SliderRow label="Wind X" value={w.wind[ 0 ]} min={- 15} max={15} step={0.5} unit="m/s" onChange={( v ) => ( w.wind[ 0 ] = v )} />
				<SliderRow label="Wind Z" value={w.wind[ 2 ]} min={- 15} max={15} step={0.5} unit="m/s" onChange={( v ) => ( w.wind[ 2 ] = v )} />
			</Section>

			<div className="flex gap-2 pb-4">
				<Button variant="outline" size="sm" className="flex-1" onClick={() => {

					engine.resetPreset( s.presetId );
					engine.refreshLooks();
					bump();

				}}>
					<RotateCcw className="size-3.5" /> Reset preset
				</Button>
				<ImportDialog>
					<Button variant="outline" size="sm" className="flex-1"><Upload className="size-3.5" /> Import JSON</Button>
				</ImportDialog>
			</div>
		</div>
	);

}

// ---------------------------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------------------------

export function LookPanel() {

	const { engine, version } = useEngine();
	const def = engine.definition;
	const l = def.look;
	const set = <K extends keyof typeof l>( k: K, v: ( typeof l )[ K ] ) => {

		l[ k ] = v;
		engine.refreshLooks();

	};

	return (
		<div key={`${ def.id }-${ version }`}>
			<p className="pt-3 text-[11px] text-muted-foreground">Changes apply live to running instances.</p>
			<Section title="Shape">
				<SliderRow label="Threshold" value={l.threshold} min={0.02} max={0.8} hint="Field value where the surface starts. Higher = thinner, more separated billows." onChange={( v ) => set( 'threshold', v )} />
				<SliderRow label="Softness" value={l.softness} min={0.03} max={1} hint="Width of the surface transition. Low values give hard cauliflower edges." onChange={( v ) => set( 'softness', v )} />
				<SliderRow label="Erosion" value={l.erosion} min={0} max={1} hint="How deeply the billow noise carves the surface." onChange={( v ) => set( 'erosion', v )} />
				<SliderRow label="Detail size" value={l.detailScale} min={0.1} max={20} step={0.05} unit="m" hint="World size of the smallest billow bumps (scaled with the effect)." onChange={( v ) => set( 'detailScale', v )} />
			</Section>
			<Section title="Colour & scattering">
				<ColorRow label="Smoke albedo" value={l.smokeColor} onChange={( v ) => set( 'smokeColor', v )} />
				<ColorRow label="Soot albedo" value={l.sootColor} onChange={( v ) => set( 'sootColor', v )} />
				<SliderRow label="Sun scattering" value={l.scattering ?? 1} min={0} max={3} onChange={( v ) => set( 'scattering', v )} />
				<SliderRow label="Anisotropy (g)" value={l.anisotropy ?? 0.55} min={- 0.2} max={0.9} hint="Henyey–Greenstein forward scattering. Higher = brighter silver lining when looking toward the sun." onChange={( v ) => set( 'anisotropy', v )} />
				<SliderRow label="Ambient" value={l.ambient ?? 1} min={0} max={3} onChange={( v ) => set( 'ambient', v )} />
			</Section>
			<Section title="Fire">
				<SliderRow label="Emission" value={l.emission} min={0} max={10} step={0.05} hint="Blackbody emission multiplier for hot gas." onChange={( v ) => set( 'emission', v )} />
				<SliderRow label="Ignition temperature" value={l.emissionThreshold ?? 0.25} min={0} max={1.5} hint="Normalised temperature where flames become visible (1 ≈ 2250 K)." onChange={( v ) => set( 'emissionThreshold', v )} />
				<SliderRow label="Glow in smoke" value={l.glow} min={0} max={8} step={0.05} hint="Fire light bounced inside the surrounding smoke (precomputed in the light volume)." onChange={( v ) => set( 'glow', v )} />
			</Section>
		</div>
	);

}

// ---------------------------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------------------------

export function PhysicsPanel() {

	const { engine, version } = useEngine();
	const def = engine.definition;
	const p = def.physics;
	const turb = p.turbulence ?? ( p.turbulence = { amplitude: 0, frequency: 0.1, speed: 1 } );

	return (
		<div key={`${ def.id }-${ version }`}>
			<p className="pt-3 text-[11px] text-muted-foreground">Forces apply live; emitter changes apply to the next spawn.</p>
			<Section title="Forces">
				<SliderRow label="Buoyancy" value={p.buoyancy ?? 6} min={0} max={20} step={0.1} unit="m/s²" hint="Upward acceleration per unit of temperature." onChange={( v ) => ( p.buoyancy = v )} />
				<SliderRow label="Gravity" value={p.gravity ?? 0} min={0} max={10} step={0.1} unit="m/s²" hint="Settling of heavy dust." onChange={( v ) => ( p.gravity = v )} />
				<SliderRow label="Drag" value={p.drag ?? 0.8} min={0} max={4} step={0.05} unit="1/s" onChange={( v ) => ( p.drag = v )} />
				<SliderRow label="Quadratic drag" value={p.quadraticDrag ?? 0} min={0} max={0.3} step={0.002} digits={3} unit="1/m" hint="Dominant for fast explosive ejecta: the burst decelerates hard, then billows." onChange={( v ) => ( p.quadraticDrag = v )} />
				<SliderRow label="Wind influence" value={p.windInfluence ?? 0.5} min={0} max={1.5} onChange={( v ) => ( p.windInfluence = v )} />
			</Section>
			<Section title="Turbulence">
				<SliderRow label="Amplitude" value={turb.amplitude} min={0} max={12} step={0.1} unit="m/s" onChange={( v ) => ( turb.amplitude = v )} />
				<SliderRow label="Frequency" value={turb.frequency} min={0.002} max={0.4} step={0.002} digits={3} unit="1/m" onChange={( v ) => ( turb.frequency = v )} />
				<SliderRow label="Speed" value={turb.speed ?? 1} min={0} max={3} onChange={( v ) => ( turb.speed = v )} />
			</Section>
			<Section title="Emitters" aside={<span className="text-[11px] text-muted-foreground">next spawn</span>}>
				{def.emitters.map( ( e, i ) => (
					<div key={i} className="space-y-2 rounded-md border border-border p-2.5">
						<div className="flex items-center justify-between">
							<span className="text-xs font-medium">{e.name ?? `emitter ${ i }`}</span>
							<div className="flex gap-1">
								<Badge variant="outline" className="h-4 px-1.5 text-[10px]">{e.type}</Badge>
								<Badge variant="outline" className="h-4 px-1.5 text-[10px]">{e.shape}</Badge>
							</div>
						</div>
						{e.type === 'burst'
							? <SliderRow label="Billows" value={e.count ?? 0} min={0} max={400} step={1} onChange={( v ) => ( e.count = v )} />
							: <SliderRow label="Rate" value={e.rate ?? 0} min={0} max={120} step={1} unit="/s" onChange={( v ) => ( e.rate = v )} />}
						<SliderRow label="Sub-billows" value={e.children?.count ?? 0} min={0} max={8} step={1} hint="Child spheres attached to each billow: the multi-scale cauliflower structure." onChange={( v ) => {

							if ( ! e.children ) e.children = { count: v, scale: [ 0.4, 0.6 ], distance: [ 0.6, 0.9 ], upBias: 0.4 };
							else e.children.count = v;

						}} />
						<SliderRow label="Initial temperature" value={e.particle.temperature?.[ 1 ] ?? 0} min={0} max={2.5} onChange={( v ) => {

							const lo = e.particle.temperature?.[ 0 ] ?? 0;
							const hi = e.particle.temperature?.[ 1 ] ?? 0;
							const ratio = hi > 0 ? lo / hi : 0.8;
							e.particle.temperature = [ v * ratio, v ];

						}} />
					</div>
				) )}
			</Section>
		</div>
	);

}

// ---------------------------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------------------------

export function LightPanel() {

	const { engine, bump } = useEngine();
	const l = engine.lighting;
	const set = <K extends keyof typeof l>( k: K, v: ( typeof l )[ K ] ) => {

		l[ k ] = v;
		engine.applyLighting();

	};

	return (
		<div>
			<Section title="Environment">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={l.environment}
					onValueChange={( v ) => {

						if ( ! v ) return;
						engine.setEnvironment( v as 'sky' | 'studio' );
						bump();

					}}
					className="w-full"
				>
					<ToggleGroupItem value="sky" className="flex-1 text-xs">Physical sky</ToggleGroupItem>
					<ToggleGroupItem value="studio" className="flex-1 text-xs">Studio (reference)</ToggleGroupItem>
				</ToggleGroup>
			</Section>
			<Section title="Sun">
				<SliderRow label="Elevation" value={l.elevation} min={1} max={89} step={1} unit="°" onChange={( v ) => set( 'elevation', v )} />
				<SliderRow label="Azimuth" value={l.azimuth} min={0} max={360} step={1} unit="°" onChange={( v ) => set( 'azimuth', v )} />
				<SliderRow label="Intensity" value={l.sunIntensity} min={0} max={15} step={0.1} onChange={( v ) => set( 'sunIntensity', v )} />
				<SliderRow label="Sky ambient" value={l.ambient} min={0} max={3} onChange={( v ) => set( 'ambient', v )} />
			</Section>
			<Section title="Camera & post">
				<SliderRow label="Exposure" value={l.exposure} min={0.1} max={3} onChange={( v ) => set( 'exposure', v )} />
				<SliderRow label="Fire bloom" value={l.bloom} min={0} max={2} onChange={( v ) => set( 'bloom', v )} />
				<SliderRow label="Aerial fog" value={l.fog} min={0} max={2} hint="Exponential height-less fog applied to both the scene and the volumes." onChange={( v ) => set( 'fog', v )} />
				<SliderRow label="Fire light on scene" value={l.fireLight} min={0} max={4} hint="Point light per region driven by the emitted energy of its hot billows." onChange={( v ) => set( 'fireLight', v )} />
				<SliderRow label="Volume shadows" value={engine.world.globals.shadowStrength.value as number} min={0} max={1} hint="Strength of the sun-space deep opacity shadows the volumes cast on receivers." onChange={( v ) => ( engine.world.globals.shadowStrength.value = v )} />
			</Section>
		</div>
	);

}

// ---------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------

export function PerformancePanel() {

	const { engine, bump, version } = useEngine();
	const w = engine.world;
	const q = w.quality;

	return (
		<div key={version}>
			<Section title="Quality">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={engine.qualityPreset}
					onValueChange={( v ) => {

						if ( ! v ) return;
						engine.setQualityPreset( v as QualityPreset );
						bump();

					}}
					className="w-full"
				>
					{( [ 'low', 'medium', 'high', 'ultra' ] as const ).map( ( p ) => (
						<ToggleGroupItem key={p} value={p} className="flex-1 text-xs capitalize">{p}</ToggleGroupItem>
					) )}
				</ToggleGroup>
				<SwitchRow label="Adaptive quality" checked={w.adaptive.enabled} hint="Dynamic resolution and LOD bias that steer the frame time toward the target." onChange={( v ) => {

					w.adaptive.enabled = v;
					bump();

				}} />
				<div className="flex items-center justify-between">
					<Label className="text-xs font-normal">Target frame rate</Label>
					<Select value={String( w.adaptive.targetFps )} onValueChange={( v ) => ( w.adaptive.targetFps = Number( v ) )}>
						<SelectTrigger size="sm" className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
						<SelectContent>
							{[ 30, 60, 75, 90, 120, 144 ].map( ( f ) => <SelectItem key={f} value={String( f )} className="text-xs">{f} fps</SelectItem> )}
						</SelectContent>
					</Select>
				</div>
			</Section>

			<Section title="Raymarching">
				<SliderRow label="Render scale" value={q.renderScale} min={0.25} max={1} step={0.05} hint="Resolution of the volume pass relative to the canvas, upsampled in the composite." onChange={( v ) => ( q.renderScale = v )} />
				<SliderRow label="Step length" value={q.stepScale} min={0.4} max={2.5} step={0.05} unit="vox" onChange={( v ) => ( q.stepScale = v )} />
				<SliderRow label="Max steps" value={q.maxSteps} min={32} max={400} step={8} onChange={( v ) => ( q.maxSteps = v )} />
				<SliderRow label="Detail shadow rays" value={q.detailShadowSteps} min={0} max={4} step={1} hint="Short per-sample rays toward the sun that shade individual noise bumps." onChange={( v ) => ( q.detailShadowSteps = v )} />
				<SliderRow label="Detail noise" value={q.detail} min={0} max={1.5} onChange={( v ) => ( q.detail = v )} />
			</Section>

			<Section title="LOD & lighting">
				<SliderRow label="Pixels per voxel" value={q.pixelsPerVoxel} min={1} max={10} step={0.25} hint="Main LOD target: each region picks the coarsest voxel size that still covers this many volume-pass pixels." onChange={( v ) => ( q.pixelsPerVoxel = v )} />
				<SliderRow label="Light march steps" value={q.lightSteps} min={4} max={64} step={1} onChange={( v ) => ( q.lightSteps = v )} />
			</Section>

			<Section title="Optimisations">
				<SwitchRow label="Empty-space skipping" checked={q.emptySpaceSkipping} hint="Rays jump over 8³ bricks with no billows using the occupancy grid." onChange={( v ) => ( q.emptySpaceSkipping = v )} />
				<SwitchRow label="Frustum culling" checked={q.frustumCulling} hint="Regions outside the view (including their ground shadow footprint) skip voxelisation and lighting." onChange={( v ) => ( q.frustumCulling = v )} />
				<SwitchRow label="Time slicing" checked={q.timeSlicing} hint="Small or distant regions re-voxelise every 2nd or 3rd frame." onChange={( v ) => ( q.timeSlicing = v )} />
				<SwitchRow label="Region merging" checked={q.regionMerging} hint="Overlapping effects share one voxel grid: one raymarch, correct mutual shadowing." onChange={( v ) => ( q.regionMerging = v )} />
				<SwitchRow label="Flow-advected detail" checked={q.flowNoise} hint="Detail noise travels with the billow velocity field instead of sliding through it." onChange={( v ) => ( q.flowNoise = v )} />
				<SwitchRow label="Receiver shadows" checked={q.shadows} onChange={( v ) => ( q.shadows = v )} />
			</Section>

			<Section title="Debug">
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					value={w.debugView}
					onValueChange={( v ) => {

						if ( ! v ) return;
						engine.setDebugView( v as DebugView );
						bump();

					}}
					className="w-full"
				>
					<ToggleGroupItem value="none" className="flex-1 text-xs">Final</ToggleGroupItem>
					<ToggleGroupItem value="bricks" className="flex-1 text-xs">Bricks</ToggleGroupItem>
					<ToggleGroupItem value="lod" className="flex-1 text-xs">LOD</ToggleGroupItem>
					<ToggleGroupItem value="albedo" className="flex-1 text-xs">Albedo</ToggleGroupItem>
				</ToggleGroup>
				<SwitchRow label="Show region bounds" checked={w.showRegionBounds} onChange={( v ) => ( w.showRegionBounds = v )} />
			</Section>
		</div>
	);

}

