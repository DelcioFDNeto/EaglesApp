<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Navegação principal (Anexo A.3: "barra inferior com no máximo 5 itens,
	 * variando por papel").
	 *
	 * Os itens chegam prontos do servidor, calculados a partir das permissões de
	 * quem está usando. A barra não decide nada: um item que não aparece aqui é
	 * um item cuja rota o servidor já recusaria.
	 */
	export type ItemDeNavegacao = {
		href: string;
		rotulo: string;
		icone: 'inicio' | 'pessoas' | 'grupos' | 'acessos' | 'conta';
	};

	let { itens }: { itens: ItemDeNavegacao[] } = $props();

	const ativo = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);

	const caminhos: Record<ItemDeNavegacao['icone'], string> = {
		inicio: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
		pessoas:
			'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.4c1.8.9 3 2.9 3 5.6',
		grupos:
			'M7.5 10.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Zm9 0a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM12 19.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM3 16.5c.4-2.3 2.2-3.8 4.5-3.8M21 16.5c-.4-2.3-2.2-3.8-4.5-3.8',
		acessos: 'M12 3 5 6v5c0 4.4 3 8.4 7 9.5 4-1.1 7-5.1 7-9.5V6zm-2.5 9 2 2 3.5-4',
		conta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c0-3.9 3.1-7 7-7s7 3.1 7 7'
	};
</script>

<nav aria-label="Navegação principal">
	<ul>
		{#each itens as item (item.href)}
			{@const atual = ativo(item.href)}
			<li>
				<a href={item.href} aria-current={atual ? 'page' : undefined} class:atual>
					<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
						<path
							d={caminhos[item.icone]}
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span>{item.rotulo}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	nav {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 20;
		background: var(--cor-superficie);
		border-top: 1px solid var(--cor-linha);
		/* Respeita a barra de gestos do iPhone. */
		padding-bottom: env(safe-area-inset-bottom);
	}

	ul {
		list-style: none;
		margin: 0 auto;
		padding: 0;
		max-width: 560px;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
	}

	a {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: 56px;
		color: var(--cor-texto-3);
		text-decoration: none;
		font-size: var(--texto-xs);
		font-weight: 600;
		transition: color var(--transicao);
	}

	a:hover {
		color: var(--cor-texto);
	}

	/*
		O item atual muda de cor E ganha um traço: a indicação não depende só
		da cor (RNF-12).
	*/
	a.atual {
		color: var(--cor-marca);
		box-shadow: inset 0 2px 0 var(--cor-marca);
	}

	a:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: -4px;
		border-radius: var(--raio);
	}
</style>
