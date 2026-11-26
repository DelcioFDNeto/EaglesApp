/**
 * Build da API (adapter-node → build-api/). Script em vez de
 * `BUILD_TARGET=api vite build` para funcionar igual no Windows e no Linux.
 */
import { spawnSync } from 'node:child_process';

const resultado = spawnSync('npx', ['vite', 'build'], {
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, BUILD_TARGET: 'api' }
});

process.exit(resultado.status ?? 1);
