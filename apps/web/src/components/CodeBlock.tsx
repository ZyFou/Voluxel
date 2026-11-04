import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const KEYWORDS = new Set( [
	'import', 'from', 'export', 'const', 'let', 'var', 'new', 'await', 'async', 'function', 'return', 'if', 'else', 'for', 'of', 'in',
	'type', 'interface', 'class', 'extends', 'true', 'false', 'null', 'undefined', 'typeof', 'as', 'void',
] );

const TOKEN = /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d'"`/]+|\/)/g;

/** Tiny tokenizer: comments, strings, numbers, keywords, types. Enough for TS / JSON snippets. */
function highlight( code: string ): ReactNode[] {

	const out: ReactNode[] = [];
	let m: RegExpExecArray | null;
	let i = 0;
	TOKEN.lastIndex = 0;
	while ( ( m = TOKEN.exec( code ) ) !== null ) {

		const [ text, comment, str, num, ident ] = m;
		let cls = '';
		if ( comment ) cls = 'text-zinc-500 italic';
		else if ( str ) cls = 'text-emerald-300';
		else if ( num ) cls = 'text-amber-300';
		else if ( ident ) {

			if ( KEYWORDS.has( ident ) ) cls = 'text-sky-300';
			else if ( /^[A-Z]/.test( ident ) ) cls = 'text-violet-300';

		}

		out.push( cls ? <span key={i ++} className={cls}>{text}</span> : text );

	}

	return out;

}

interface CodeBlockProps {
	code: string;
	filename?: string;
	className?: string;
	maxHeight?: string;
	language?: string;
	/** Soft-wrap long lines instead of scrolling horizontally. */
	wrap?: boolean;
}

export function CodeBlock( { code, filename, className, maxHeight, language = 'ts', wrap = false }: CodeBlockProps ) {

	const [ copied, setCopied ] = useState( false );
	const nodes = useMemo( () => highlight( code ), [ code ] );

	const copy = async () => {

		await navigator.clipboard.writeText( code );
		setCopied( true );
		setTimeout( () => setCopied( false ), 1400 );

	};

	const download = () => {

		const blob = new Blob( [ code ], { type: 'text/plain' } );
		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( blob );
		a.download = filename ?? `voluxel.${ language }`;
		a.click();
		URL.revokeObjectURL( a.href );

	};

	return (
		<div className={cn( 'group relative min-w-0 overflow-hidden rounded-lg border border-border bg-zinc-950', className )}>
			<div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
				<span className="font-mono text-[11px] text-muted-foreground">{filename ?? language}</span>
				<div className="flex gap-1">
					{filename && (
						<Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={download}>
							<Download className="size-3" /> Download
						</Button>
					)}
					<Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={copy} aria-live="polite">
						{copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy'}
					</Button>
				</div>
			</div>
			<pre
				className={cn(
					'overflow-auto p-3 text-[12px] leading-relaxed text-zinc-200',
					wrap && 'whitespace-pre-wrap [overflow-wrap:anywhere]',
				)}
				style={{ maxHeight }}
			>
				<code className="font-mono">{nodes}</code>
			</pre>
		</div>
	);

}
