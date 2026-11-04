import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig( {
	plugins: [ react(), tailwindcss() ],
	resolve: {
		alias: {
			'@': path.resolve( __dirname, './src' ),
			// Develop against the package source for instant HMR; the published build uses packages/voluxel/dist.
			voluxel: path.resolve( __dirname, '../../packages/voluxel/src/index.ts' ),
		},
		dedupe: [ 'three' ],
	},
	server: { port: 5173 },
	build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
} );
