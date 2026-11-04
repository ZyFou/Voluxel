import { useId, useState, type ReactNode } from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

export function Section( { title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode } ) {

	return (
		<section className="space-y-3 py-4 first:pt-1">
			<div className="flex items-center justify-between">
				<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
				{aside}
			</div>
			<div className="space-y-3">{children}</div>
		</section>
	);

}

function Hint( { text }: { text?: string } ) {

	if ( ! text ) return null;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button type="button" className="text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground" aria-label="More info">
					<Info className="size-3" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="left" className="max-w-60 text-xs leading-relaxed">{text}</TooltipContent>
		</Tooltip>
	);

}

interface SliderRowProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	unit?: string;
	digits?: number;
	hint?: string;
	onChange: ( v: number ) => void;
}

/** Labelled slider that keeps its own state so dragging never waits on a parent re-render. */
export function SliderRow( { label, value, min, max, step = 0.01, unit, digits, hint, onChange }: SliderRowProps ) {

	const id = useId();
	const [ v, setV ] = useState( value );
	const [ prev, setPrev ] = useState( value );
	if ( value !== prev ) {

		setPrev( value );
		setV( value );

	}

	const d = digits ?? ( step >= 1 ? 0 : step >= 0.1 ? 1 : 2 );
	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<Label htmlFor={id} className="text-xs font-normal">{label}</Label>
					<Hint text={hint} />
				</div>
				<span className="font-mono text-[11px] tabular-nums text-muted-foreground">{v.toFixed( d )}{unit ? ` ${ unit }` : ''}</span>
			</div>
			<Slider
				id={id}
				value={[ v ]}
				min={min}
				max={max}
				step={step}
				onValueChange={( x ) => {

					setV( x[ 0 ] );
					onChange( x[ 0 ] );

				}}
			/>
		</div>
	);

}

export function SwitchRow( { label, checked, onChange, hint }: { label: string; checked: boolean; onChange: ( v: boolean ) => void; hint?: string } ) {

	const id = useId();
	const [ v, setV ] = useState( checked );
	const [ prev, setPrev ] = useState( checked );
	if ( checked !== prev ) {

		setPrev( checked );
		setV( checked );

	}

	return (
		<div className="flex items-center justify-between gap-2">
			<div className="flex items-center gap-1.5">
				<Label htmlFor={id} className="text-xs font-normal">{label}</Label>
				<Hint text={hint} />
			</div>
			<Switch
				id={id}
				checked={v}
				onCheckedChange={( x ) => {

					setV( x );
					onChange( x );

				}}
			/>
		</div>
	);

}

const toHex = ( c: [ number, number, number ] ) => {

	// stored colours are linear; show them as sRGB
	const s = ( x: number ) => {

		const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow( x, 1 / 2.4 ) - 0.055;
		return Math.round( Math.min( 1, Math.max( 0, v ) ) * 255 ).toString( 16 ).padStart( 2, '0' );

	};

	return `#${ s( c[ 0 ] ) }${ s( c[ 1 ] ) }${ s( c[ 2 ] ) }`;

};

const fromHex = ( h: string ): [ number, number, number ] => {

	const n = parseInt( h.slice( 1 ), 16 );
	const l = ( v: number ) => {

		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 );

	};

	return [ l( ( n >> 16 ) & 255 ), l( ( n >> 8 ) & 255 ), l( n & 255 ) ];

};

export function ColorRow( { label, value, onChange }: { label: string; value: [ number, number, number ]; onChange: ( v: [ number, number, number ] ) => void } ) {

	const id = useId();
	const [ hex, setHex ] = useState( toHex( value ) );
	return (
		<div className="flex items-center justify-between gap-2">
			<Label htmlFor={id} className="text-xs font-normal">{label}</Label>
			<div className="flex items-center gap-2">
				<span className="font-mono text-[11px] text-muted-foreground">{hex}</span>
				<input
					id={id}
					type="color"
					value={hex}
					className="h-6 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
					onChange={( e ) => {

						setHex( e.target.value );
						onChange( fromHex( e.target.value ) );

					}}
				/>
			</div>
		</div>
	);

}
