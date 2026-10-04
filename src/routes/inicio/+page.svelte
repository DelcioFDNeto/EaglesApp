<script lang="ts">
	import { page } from '$app/state';
	import Marca from '$ui/Marca.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Botao from '$ui/Botao.svelte';
	import InstalarPwa from '$ui/InstalarPwa.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const boasVindas = $derived(page.url.searchParams.get('boas-vindas') === '1');
	const acessoRecuperado = $derived(page.url.searchParams.get('acesso-recuperado') === '1');
	const primeiroNome = $derived(data.nome.split(' ')[0]);
</script>

<svelte:head>
	<title>Início · Eagles</title>
</svelte:head>

<header>
	<div class="barra">
		<Marca tamanho={28} comNome />
		<form method="POST" action="/sair">
			<Botao tipo="submit" variante="texto">Sair</Botao>
		</form>
	</div>
</header>

<main class="conteudo">
	<div class="pilha">
		{#if boasVindas}
			<Aviso tom="sucesso" titulo="Acesso criado!">
				Bem-vindo ao Eagles, {primeiroNome}. Seu acesso está pronto.
			</Aviso>
		{/if}

		{#if acessoRecuperado}
			<Aviso tom="sucesso" titulo="Acesso recuperado">
				Sua senha nova já vale. Os aparelhos que estavam conectados foram desconectados.
			</Aviso>
		{/if}

		<h1>Olá, {primeiroNome}</h1>

		{#if data.semAcesso}
			<!--
				Quem entrou mas ainda não tem papel. Antes do M03 esta pessoa via uma
				tela de erro genérica; agora entende o que houve e a quem procurar.
			-->
			<section class="cartao vazio">
				<Marca tamanho={44} />
				<h2>Seu acesso ainda não foi configurado</h2>
				<p>
					Você já entrou, mas ninguém da liderança definiu ainda o que você pode ver aqui. Fale com
					seu conselheiro ou com a liderança dos Eagles.
				</p>
			</section>
		{:else}
			<InstalarPwa />

			{#if data.grupos.length > 0}
				<section class="cartao" aria-label="Seu grupo">
					<h2>{data.grupos.length === 1 ? 'Seu grupo' : 'Seus grupos'}</h2>
					<ul class="grupos">
						{#each data.grupos as g (g.id)}
							<li>
								<a href="/grupos/{g.id}" style={g.cor ? `--cor-grupo: ${g.cor}` : undefined}>
									<span class="ponto" aria-hidden="true"></span>
									<span class="nome">{g.nome}</span>
									<span class="legenda">{g.membros} {g.membros === 1 ? 'pessoa' : 'pessoas'}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!--
			Estado vazio verdadeiro: no M01 não existe evento porque o módulo de
			eventos é o M05. A mensagem diz isso com voz humana, sem fingir que
			há um erro nem escrever "Nenhum registro encontrado".
		-->
			<section class="cartao vazio">
				<Marca tamanho={44} />
				<h2>Ainda não há encontros por aqui</h2>
				<p>
					Quando a agenda dos Eagles estiver no ar, seus próximos encontros aparecem nesta tela — e
					você confirma presença em um toque.
				</p>
			</section>

			<section class="cartao">
				<h2>Seu acesso</h2>
				<p class="legenda">
					O que você pode fazer no app depende do seu papel. Esta lista vem do servidor, não da
					tela.
				</p>

				<dl>
					<dt>Papel</dt>
					<dd>{data.papeis.join(', ') || '—'}</dd>
					<dt>Permissões</dt>
					<dd>{data.permissoes.length}</dd>
				</dl>

				<details>
					<summary>Ver minhas permissões</summary>
					<ul>
						{#each data.permissoes as p (p)}
							<li>
								<code>{p}</code>
								<span>{data.catalogoPermissoes[p] ?? ''}</span>
							</li>
						{/each}
					</ul>
				</details>
			</section>

			<section class="cartao">
				<h2>Funcionalidades opcionais</h2>
				<p class="legenda">
					Tudo nasce desligado. Ligar cada recurso é decisão da liderança, não padrão do sistema.
				</p>
				{#if Object.keys(data.funcionalidades).length === 0}
					<p class="legenda">Nenhuma configurada ainda.</p>
				{:else}
					<ul class="flags">
						{#each Object.entries(data.funcionalidades) as [chave, ligada] (chave)}
							<li>
								<code>{chave}</code>
								<span class="pino" class:ligada>{ligada ? 'ligada' : 'desligada'}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<nav class="atalhos">
			<a href="/conta/sessoes">Meus dispositivos conectados</a>
		</nav>
	</div>
</main>

<style>
	.grupos {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.grupos a {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		color: inherit;
		text-decoration: none;
	}

	.grupos a:hover .nome {
		color: var(--cor-marca);
	}

	.grupos .ponto {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--cor-grupo, var(--cor-texto-3));
	}

	.grupos .nome {
		font-weight: 600;
	}

	.grupos .legenda {
		margin-left: auto;
	}

	header {
		border-bottom: 1px solid var(--cor-linha);
		background: var(--cor-superficie);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.barra {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-2) var(--esp-3);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	h1 {
		font-size: var(--texto-2xl);
	}

	.cartao {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		box-shadow: var(--sombra-1);
	}

	.vazio {
		align-items: center;
		text-align: center;
		padding-block: var(--esp-6);
	}

	.vazio p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--esp-1) var(--esp-4);
		font-size: var(--texto-sm);
	}

	dt {
		color: var(--cor-texto-3);
	}

	dd {
		font-weight: 600;
	}

	details summary {
		cursor: pointer;
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-marca);
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
	}

	details ul {
		list-style: none;
		padding: 0;
		margin-top: var(--esp-2);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	details li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--texto-sm);
	}

	details li span {
		color: var(--cor-texto-3);
		font-size: var(--texto-xs);
	}

	code {
		font-family: var(--fonte-mono);
		font-size: var(--texto-xs);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-sm);
		padding: 1px 5px;
		align-self: flex-start;
	}

	.flags {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.flags li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	.pino {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-3);
		color: var(--cor-texto-3);
	}

	.pino.ligada {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.atalhos {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding-block: var(--esp-2) var(--esp-6);
	}

	.atalhos a {
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
		font-size: var(--texto-sm);
		font-weight: 600;
	}
</style>
