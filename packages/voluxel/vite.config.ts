import { defineConfig } from 'vite';

export default defineConfig( {
	build: {
		lib: { entry: 'src/index.ts', formats: [ 'es' ], fileName: () => 'voluxel.js' },
		target: 'es2022',
		sourcemap: true,
		rollupOptions: {
			external: [ 'three', /^three\// ],
		},
	},
} );
