import { useEffect, useState } from 'react';
import { BookOpen, Flame, Gauge } from 'lucide-react';
import { REVISION } from 'three/webgpu';
import { VERSION } from 'voluxel';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Playground } from '@/components/playground/Playground';
import { Docs } from '@/pages/Docs';
import { cn } from '@/lib/utils';

type Route = 'playground' | 'docs';

const readRoute = (): Route => ( location.hash.startsWith( '#/docs' ) ? 'docs' : 'playground' );

export function App() {

	const [ route, setRoute ] = useState<Route>( readRoute );

	useEffect( () => {

		const on = () => setRoute( readRoute() );
		window.addEventListener( 'hashchange', on );
		return () => window.removeEventListener( 'hashchange', on );

	}, [] );

	const nav = ( r: Route, label: string, Icon: typeof Gauge ) => (
		<a
			href={r === 'docs' ? '#/docs' : '#/'}
			className={cn(
				'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
				route === r ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
			)}
			aria-current={route === r ? 'page' : undefined}
		>
			<Icon className="size-4" /> {label}
		</a>
	);

	return (
		<TooltipProvider delayDuration={250}>
			<div className="flex h-screen flex-col bg-background text-foreground">
				<header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
					<div className="flex items-center gap-2">
						<Flame className="size-5 text-orange-400" aria-hidden />
						<span className="font-semibold tracking-tight">Voluxel</span>
						<span className="hidden text-xs text-muted-foreground sm:inline">voxel smoke, fire &amp; explosions for three.js</span>
					</div>
					<nav className="flex items-center gap-1" aria-label="Main">
						{nav( 'playground', 'Playground', Gauge )}
						{nav( 'docs', 'API docs', BookOpen )}
					</nav>
					<div className="ml-auto flex items-center gap-1.5">
						<Badge variant="outline" className="font-mono text-[10px]">voluxel {VERSION}</Badge>
						<Badge variant="outline" className="font-mono text-[10px]">three r{REVISION}</Badge>
						<Badge variant="outline" className="font-mono text-[10px]">WebGPU</Badge>
					</div>
				</header>
				<main className="relative min-h-0 flex-1">
					{/* the playground stays mounted so the GPU state survives a trip to the docs */}
					<div className={cn( 'absolute inset-0', route !== 'playground' && 'invisible' )} aria-hidden={route !== 'playground'}>
						<Playground active={route === 'playground'} />
					</div>
					{route === 'docs' && (
						<div className="absolute inset-0 bg-background">
							<Docs />
						</div>
					)}
				</main>
			</div>
			<Toaster position="bottom-right" />
		</TooltipProvider>
	);

}
