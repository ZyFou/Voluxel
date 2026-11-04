import { createContext, useContext } from 'react';
import type { DemoEngine } from '@/viewer/engine';

export interface EngineContextValue {
	engine: DemoEngine;
	/** Increments whenever a control changes something other panels display. */
	version: number;
	bump: () => void;
}

export const EngineContext = createContext<EngineContextValue | null>( null );

export function useEngine(): EngineContextValue {

	const ctx = useContext( EngineContext );
	if ( ! ctx ) throw new Error( 'useEngine must be used inside <EngineContext.Provider>' );
	return ctx;

}
