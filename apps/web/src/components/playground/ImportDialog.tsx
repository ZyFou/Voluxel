import { useState, type ReactNode } from 'react';
import { importEffectJSON } from 'voluxel';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
	Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useEngine } from './engine-context';

export function ImportDialog( { children }: { children: ReactNode } ) {

	const { engine, bump } = useEngine();
	const [ open, setOpen ] = useState( false );
	const [ text, setText ] = useState( '' );
	const [ error, setError ] = useState<string | null>( null );

	const load = () => {

		try {

			const def = importEffectJSON( text );
			if ( ! def.id ) def.id = `custom-${ Date.now() }`;
			engine.addDefinition( def );
			engine.selectPreset( def.id );
			engine.spawnSelected();
			bump();
			setOpen( false );
			setError( null );
			toast.success( `Imported "${ def.name ?? def.id }"` );

		} catch ( e ) {

			setError( ( e as Error ).message );

		}

	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Import an effect</DialogTitle>
					<DialogDescription>Paste JSON exported from this playground (or written by hand). It is added to the list and spawned.</DialogDescription>
				</DialogHeader>
				<textarea
					value={text}
					onChange={( e ) => setText( e.target.value )}
					spellCheck={false}
					placeholder={'{ "id": "myBlast", "name": "My blast", "look": { … }, "physics": { … }, "emitters": [ … ] }'}
					className="h-72 w-full resize-none rounded-md border border-input bg-zinc-950 p-3 font-mono text-xs text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Effect JSON"
				/>
				{error && <p className="text-xs text-destructive" role="alert">{error}</p>}
				<DialogFooter>
					<Button variant="ghost" onClick={() => setOpen( false )}>Cancel</Button>
					<Button onClick={load} disabled={! text.trim()}>Import and spawn</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);

}
