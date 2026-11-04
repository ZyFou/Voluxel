import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bomb, Code2, Loader2, MousePointerClick, RotateCcw, TriangleAlert } from 'lucide-react';
import { PRESET_GROUPS } from 'voluxel';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DemoEngine, type ResetScope } from '@/viewer/engine';
import { cn } from '@/lib/utils';
import { EngineContext, useEngine, type EngineContextValue } from './engine-context';
import { EffectPanel, LightPanel, LookPanel, PerformancePanel, PhysicsPanel } from './panels';
import { StatsOverlay } from './StatsOverlay';
import { ExportDialog } from './ExportDialog';

const TABS: { value: ResetScope; label: string }[] = [
	{ value: 'effect', label: 'Effect' },
	{ value: 'look', label: 'Look' },
	{ value: 'physics', label: 'Physics' },
	{ value: 'light', label: 'Light' },
	{ value: 'perf', label: 'Perf' },
];

/** Ignore the shortcut while typing, with modifiers (Ctrl+R reloads) or behind a dialog. */
function isResetKey( e: KeyboardEvent ): boolean {

	if ( e.key !== 'r' && e.key !== 'R' ) return false;
	if ( e.ctrlKey || e.metaKey || e.altKey || e.repeat ) return false;
	const t = e.target as HTMLElement | null;
	if ( t && ( t.isContentEditable || [ 'INPUT', 'TEXTAREA', 'SELECT' ].includes( t.tagName ) ) ) return false;
	return document.querySelector( '[role="dialog"][data-state="open"]' ) === null;

}

export function Playground( { active }: { active: boolean } ) {

	const container = useRef<HTMLDivElement>( null );
	const [ engine, setEngine ] = useState<DemoEngine | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ version, setVersion ] = useState( 0 );
	const [ tab, setTab ] = useState<ResetScope>( 'effect' );

	useEffect( () => {

		const e = new DemoEngine();
		let cancelled = false;
		e.init( container.current! )
			.then( () => {

				if ( cancelled ) return;
				setEngine( e );
				// handy for poking at the world from devtools
				if ( import.meta.env.DEV ) ( window as unknown as { engine: DemoEngine } ).engine = e;

			} )
			.catch( ( err ) => ! cancelled && setError( String( err?.message ?? err ) ) );
		return () => {

			cancelled = true;
			e.dispose();

		};

	}, [] );

	useEffect( () => {

		engine?.setActive( active );

	}, [ engine, active ] );

	const bump = useCallback( () => setVersion( ( v ) => v + 1 ), [] );

	const resetAll = useCallback( () => {

		if ( ! engine ) return;
		engine.resetAll();
		bump();
		toast( 'Everything reset', { description: 'Presets, settings, camera and effects are back to their defaults.' } );

	}, [ engine, bump ] );

	useEffect( () => {

		if ( ! engine || ! active ) return;
		const onKey = ( e: KeyboardEvent ) => {

			if ( ! isResetKey( e ) ) return;
			e.preventDefault();
			resetAll();

		};

		window.addEventListener( 'keydown', onKey );
		return () => window.removeEventListener( 'keydown', onKey );

	}, [ engine, active, resetAll ] );

	const ctx = useMemo<EngineContextValue | null>(
		() => ( engine ? { engine, version, bump } : null ),
		[ engine, version, bump ],
	);

	return (
		<div className="flex h-full min-h-0">
			<div className="relative min-w-0 flex-1 bg-black">
				<div ref={container} className="absolute inset-0" />

				{! engine && ! error && (
					<div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-zinc-400">
						<Loader2 className="size-4 animate-spin" /> Compiling WebGPU kernels and generating the noise volume…
					</div>
				)}

				{error && (
					<div className="absolute inset-0 flex items-center justify-center p-8">
						<div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-5 text-sm">
							<div className="mb-2 flex items-center gap-2 font-medium text-destructive"><TriangleAlert className="size-4" /> WebGPU required</div>
							<p className="text-muted-foreground">{error}</p>
							<p className="mt-2 text-muted-foreground">Voluxel relies on compute shaders and 3D storage textures. Use Chrome or Edge 113+ (or Safari 26+) with hardware acceleration enabled.</p>
						</div>
					</div>
				)}

				{ctx && (
					<EngineContext.Provider value={ctx}>
						<div className="pointer-events-none absolute left-3 top-3">
							<StatsOverlay />
						</div>
						<QuickBar />
					</EngineContext.Provider>
				)}
			</div>

			<aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-background" aria-label="Settings">
				{ctx ? (
					<EngineContext.Provider value={ctx}>
						<Tabs value={tab} onValueChange={( v ) => setTab( v as ResetScope )} className="flex min-h-0 flex-1 flex-col gap-0">
							<div className="border-b border-border px-3 py-2.5">
								<TabsList className="grid w-full grid-cols-5">
									{TABS.map( ( t ) => <TabsTrigger key={t.value} value={t.value} className="text-xs">{t.label}</TabsTrigger> )}
								</TabsList>
							</div>
							<TabResetBar scope={tab} />
							<ScrollArea className="min-h-0 flex-1">
								<div className="px-4">
									<TabsContent value="effect"><EffectPanel /></TabsContent>
									<TabsContent value="look"><LookPanel /></TabsContent>
									<TabsContent value="physics"><PhysicsPanel /></TabsContent>
									<TabsContent value="light"><LightPanel /></TabsContent>
									<TabsContent value="perf"><PerformancePanel /></TabsContent>
								</div>
							</ScrollArea>
							<div className="flex gap-2 border-t border-border p-3">
								<ExportDialog>
									<Button variant="secondary" className="flex-1"><Code2 className="size-4" /> Export to three.js</Button>
								</ExportDialog>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button variant="outline" onClick={resetAll} aria-keyshortcuts="R">
											<RotateCcw className="size-4" /> Reset all <Kbd className="ml-0.5">R</Kbd>
										</Button>
									</TooltipTrigger>
									<TooltipContent side="top" className="max-w-56 text-xs">Clears every effect and restores presets, settings and camera. Shortcut: R</TooltipContent>
								</Tooltip>
							</div>
						</Tabs>
					</EngineContext.Provider>
				) : (
					<div className="p-4 text-sm text-muted-foreground">Settings appear once the renderer is ready.</div>
				)}
			</aside>
		</div>
	);

}

const SCOPE_TEXT: Record<ResetScope, ( effect: string ) => string> = {
	effect: () => 'Spawn, time and wind',
	look: ( name ) => `Look of ${ name }`,
	physics: ( name ) => `Physics of ${ name }`,
	light: () => 'Sun, environment and post',
	perf: () => 'Quality, optimisations and debug',
};

/** Sticky row under the tabs naming what the tab edits, with a reset for just that tab. */
function TabResetBar( { scope }: { scope: ResetScope } ) {

	const { engine, bump } = useEngine();
	const name = engine.definition.name;
	return (
		<div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
			<span className="truncate text-[11px] text-muted-foreground">{SCOPE_TEXT[ scope ]( name )}</span>
			<Button
				variant="ghost"
				size="sm"
				className="h-6 shrink-0 px-2 text-[11px]"
				onClick={() => {

					engine.reset( scope );
					bump();
					toast( `${ TABS.find( ( t ) => t.value === scope )?.label } settings reset` );

				}}
			>
				<RotateCcw className="size-3" /> Reset tab
			</Button>
		</div>
	);

}

function QuickBar() {

	const { engine, bump } = useEngine();
	const ids = PRESET_GROUPS.flatMap( ( g ) => g.ids );
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2">
			<div className="pointer-events-auto flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto rounded-lg border border-white/10 bg-black/55 p-1 shadow-lg backdrop-blur-md [scrollbar-width:thin] [&>button]:shrink-0">
				{ids.map( ( id ) => (
					<button
						key={id}
						type="button"
						onClick={() => {

							engine.selectPreset( id );
							engine.spawnSelected();
							bump();

						}}
						className={cn(
							'rounded-md px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
							engine.spawn.presetId === id && 'bg-white/15 text-white',
						)}
					>
						{engine.definitions[ id ].name}
					</button>
				) )}
				<div className="mx-1 h-5 w-px bg-white/15" />
				<Button size="sm" className="h-7 bg-orange-500 text-black hover:bg-orange-400" onClick={() => engine.spawnSelected()}>
					<Bomb className="size-3.5" /> Detonate
				</Button>
			</div>
			<p className="hidden items-center gap-1.5 text-[11px] text-zinc-400 md:flex">
				<MousePointerClick className="size-3" /> Click the ground to spawn · drag to orbit · <Kbd>scroll</Kbd> to zoom · <Kbd>R</Kbd> reset all
			</p>
		</div>
	);

}
