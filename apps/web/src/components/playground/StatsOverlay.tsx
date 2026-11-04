import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { FrameStats } from '@/viewer/engine';
import { cn } from '@/lib/utils';
import { useEngine } from './engine-context';

const fmt = ( n: number | null | undefined, d = 1 ) => ( n == null ? '–' : n.toFixed( d ) );
const big = ( n: number ) => ( n >= 1e6 ? `${ ( n / 1e6 ).toFixed( 2 ) }M` : n >= 1e3 ? `${ ( n / 1e3 ).toFixed( 1 ) }k` : String( n ) );
const LOD_CLASS = [ 'text-emerald-300', 'text-yellow-200', 'text-orange-300', 'text-red-300' ];

function Row( { label, value, className }: { label: string; value: string; className?: string } ) {

	return (
		<div className="flex justify-between gap-4">
			<span className="text-zinc-400">{label}</span>
			<span className={cn( 'tabular-nums text-zinc-100', className )}>{value}</span>
		</div>
	);

}

export function StatsOverlay() {

	const { engine } = useEngine();
	const [ s, setS ] = useState<FrameStats | null>( null );
	const [ open, setOpen ] = useState( true );

	useEffect( () => engine.subscribe( setS ), [ engine ] );

	if ( ! s ) return null;
	const p = s.world;
	const target = engine.world.adaptive.targetFps;
	const fpsClass = s.fps >= target - 1 ? 'text-emerald-300' : s.fps >= target * 0.8 ? 'text-yellow-200' : 'text-red-300';

	return (
		<div className="pointer-events-auto w-60 rounded-lg border border-white/10 bg-black/55 font-mono text-[11px] text-zinc-200 shadow-lg backdrop-blur-md">
			<button
				type="button"
				className="flex w-full items-baseline justify-between px-3 pt-2.5 pb-2 text-left"
				onClick={() => setOpen( ! open )}
				aria-expanded={open}
			>
				<span>
					<span className={cn( 'text-xl font-semibold tabular-nums', fpsClass )}>{fmt( s.fps, 0 )}</span>
					<span className="ml-1 text-zinc-400">fps</span>
					<span className="ml-2 text-zinc-400">{fmt( s.frameMs )} ms</span>
				</span>
				{open ? <ChevronUp className="size-3.5 text-zinc-400" /> : <ChevronDown className="size-3.5 text-zinc-400" />}
			</button>
			{open && (
				<div className="space-y-2 border-t border-white/10 px-3 py-2.5">
					<div className="space-y-0.5">
						<Row label="Frame budget" value={`${ fmt( s.frameMs ) } / ${ fmt( 1000 / target ) } ms`} className={s.frameMs > 1000 / target ? 'text-yellow-200' : undefined} />
						<Row label="CPU sim / bin" value={`${ fmt( p.cpuSimMs, 2 ) } / ${ fmt( p.cpuBinMs, 2 ) }`} />
						<Row label="Adaptive scale" value={`${ Math.round( p.qualityScale * 100 ) }%`} className={p.qualityScale < 0.99 ? 'text-yellow-200' : undefined} />
					</div>
					<div className="space-y-0.5 border-t border-white/10 pt-2">
						<Row label="Effects / billows" value={`${ p.effects } / ${ big( p.particles ) }`} />
						<Row label="Regions vis / culled" value={`${ p.visibleRegions } / ${ p.culledRegions }`} />
						<Row label="Active bricks" value={big( p.activeBricks )} />
						<Row label="Active voxels" value={big( p.activeVoxels )} />
						<Row label="Bin entries" value={big( p.binEntries )} />
					</div>
					{p.regionInfo.length > 0 && (
						<table className="w-full border-t border-white/10 pt-2 text-[10px]">
							<thead>
								<tr className="text-zinc-500">
									<th className="pt-2 text-left font-normal">slot</th>
									<th className="pt-2 text-left font-normal">lod</th>
									<th className="pt-2 text-right font-normal">voxel</th>
									<th className="pt-2 text-right font-normal">grid</th>
									<th className="pt-2 text-right font-normal">bricks</th>
								</tr>
							</thead>
							<tbody>
								{p.regionInfo.map( ( r ) => (
									<tr key={r.slot} className={r.visible ? '' : 'text-zinc-500'}>
										<td>{r.slot}{r.effects > 1 ? <span className="text-sky-300"> ×{r.effects}</span> : null}</td>
										<td className={r.visible ? LOD_CLASS[ r.lod ] : undefined}>{r.visible ? r.lod : 'cull'}</td>
										<td className="text-right">{r.voxelSize < 1 ? `${ Math.round( r.voxelSize * 100 ) }cm` : `${ r.voxelSize.toFixed( 1 ) }m`}</td>
										<td className="text-right">{r.dims.map( ( d ) => d / 8 ).join( '·' )}</td>
										<td className="text-right">{r.activeBricks}{r.updatedThisFrame ? '' : '*'}</td>
									</tr>
								) )}
							</tbody>
						</table>
					)}
				</div>
			)}
		</div>
	);

}
