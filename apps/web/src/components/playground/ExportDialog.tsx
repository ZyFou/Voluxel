import { useMemo, useState, type ReactNode } from 'react';
import { exportEffectJSON, generateCode } from 'voluxel';
import {
	Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from '@/components/CodeBlock';
import { useEngine } from './engine-context';

export function ExportDialog( { children }: { children: ReactNode } ) {

	const { engine } = useEngine();
	const [ open, setOpen ] = useState( false );

	const data = useMemo( () => {

		if ( ! open ) return null;
		const def = engine.definition;
		const w = engine.world;
		const q = { ...w.quality };
		const p = engine.lastPosition;
		const opts = {
			definition: def,
			position: [ Math.round( p?.x ?? 0 ), 0, Math.round( p?.z ?? 0 ) ] as [ number, number, number ],
			scale: engine.spawn.scale,
			quality: q,
			sun: { ...w.sun },
			wind: [ ...w.wind ] as [ number, number, number ],
			bloom: true,
		};
		return {
			snippet: generateCode( opts ),
			standalone: generateCode( { ...opts, standalone: true } ),
			json: exportEffectJSON( def ),
			id: def.id,
		};

	}, [ open, engine ] );

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			{/* width is capped to the viewport and the grid column may shrink below its content,
			    so long code lines wrap inside the block instead of widening the dialog */}
			<DialogContent className="max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] max-w-none grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-none">
				<DialogHeader className="min-w-0 pr-8">
					<DialogTitle>Export to your three.js scene</DialogTitle>
					<DialogDescription>
						The current effect, scale, sun, wind and quality settings as code. Edited presets are inlined as JSON so the snippet is self-contained.
					</DialogDescription>
				</DialogHeader>
				{data && (
					<Tabs defaultValue="snippet" className="min-h-0 min-w-0">
						<TabsList className="max-w-full">
							<TabsTrigger value="snippet">Integration snippet</TabsTrigger>
							<TabsTrigger value="standalone">Standalone scene</TabsTrigger>
							<TabsTrigger value="json">Effect JSON</TabsTrigger>
						</TabsList>
						<TabsContent value="snippet" className="min-h-0 min-w-0">
							<CodeBlock code={data.snippet} filename="add-voluxel.ts" maxHeight="max(12rem, calc(90vh - 12rem))" wrap />
						</TabsContent>
						<TabsContent value="standalone" className="min-h-0 min-w-0">
							<CodeBlock code={data.standalone} filename="main.ts" maxHeight="max(12rem, calc(90vh - 12rem))" wrap />
						</TabsContent>
						<TabsContent value="json" className="min-h-0 min-w-0">
							<CodeBlock code={data.json} filename={`${ data.id }.voluxel.json`} language="json" maxHeight="max(12rem, calc(90vh - 12rem))" wrap />
						</TabsContent>
					</Tabs>
				)}
			</DialogContent>
		</Dialog>
	);

}
