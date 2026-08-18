import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
		environment: 'node',
		// PGlite (Postgres em WASM) sobe do zero em cada suíte de integração.
		testTimeout: 30_000,
		hookTimeout: 30_000
	}
});
