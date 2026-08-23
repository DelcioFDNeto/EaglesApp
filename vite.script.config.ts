import { defineConfig } from 'vite';

/**
 * Configuração mínima para scripts avulsos (semeadura).
 *
 * Não carrega o plugin do SvelteKit de propósito: o script roda fora do ciclo
 * da aplicação e o plugin não resolve arquivos de `seed/`. Serve só para dar
 * a resolução de módulos do Vite, que é a que o código-fonte assume.
 */
export default defineConfig({});
