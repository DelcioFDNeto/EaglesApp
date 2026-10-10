<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Etiqueta from '$ui/Etiqueta.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import EstadoVazio from '$ui/EstadoVazio.svelte';
	import PedidoDeReautenticacao from '$ui/PedidoDeReautenticacao.svelte';
	import CartaoDeEvento from '$ui/CartaoDeEvento.svelte';
	import { formatarTelefone } from '$shared/pessoa';
	import { formatarCombinado } from '$shared/grupo';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const g = $derived(data.grupo);
	const combinado = $derived(formatarCombinado(g));
	const dataCurta = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

	const PENDENCIA = {
		regime_restrito: 'cadastro restrito',
		sem_acesso: 'sem acesso ao app'
	} as const;

	let enviando = $state<string | null>(null);

	/** `use:enhance` com estado de carregamento por formulário. */
	function comCarregamento(nome: string) {
		return () => {
			enviando = nome;
			return async ({ update }: { update: () => Promise<void> }) => {
				await update();
				enviando = null;
			};
		};
	}
</script>

<svelte:head>
	<title>{g.nome} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/grupos">
	{#snippet acoes()}
		{#if data.podeEditar}
			<Botao href="/grupos/{g.id}/editar" variante="secundario">Editar</Botao>
		{/if}
	{/snippet}
</BarraDeTopo>

<main class="conteudo" style={g.cor ? `--cor-grupo: ${g.cor}` : undefined}>
	{#if data.criado}
		<Aviso tom="sucesso" titulo="Grupo criado">
			Agora coloque as pessoas no grupo e defina quem é responsável por ele.
		</Aviso>
	{/if}
	{#if data.salvo}
		<Aviso tom="sucesso">Alterações salvas.</Aviso>
	{/if}
	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}
	{#if form?.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}

	<section class="cartao identidade" aria-label="Grupo">
		<h1><span class="ponto" aria-hidden="true"></span>{g.nome}</h1>
		{#if g.arquivadoEm}
			<p class="arquivado">Arquivado em {dataCurta.format(new Date(g.arquivadoEm))}</p>
		{/if}
		{#if combinado}<p class="combinado">{combinado}</p>{/if}
		{#if g.descricao}<p class="descricao">{g.descricao}</p>{/if}
	</section>

	<section class="cartao" aria-label="Próximos encontros">
		<h3>Próximos encontros</h3>
		{#if data.proximos.length === 0}
			<p class="legenda">Nada marcado para este grupo.</p>
		{:else}
			<ul class="eventos">
				{#each data.proximos as evento (evento.id)}
					<li><CartaoDeEvento {evento} mostrarData /></li>
				{/each}
			</ul>
		{/if}
		{#if data.serieAtiva}
			<Botao href="/agenda/series/{data.serieAtiva.id}" variante="secundario">
				Encontro semanal
			</Botao>
		{:else if data.podeCriarEncontroSemanal}
			<Botao href="/agenda/novo?grupo={g.id}&semanal=1" variante="secundario">
				Criar o encontro semanal
			</Botao>
		{/if}
	</section>

	<section class="cartao" aria-label="Responsáveis">
		<h3>Responsáveis</h3>
		{#if g.responsaveis.length === 0}
			<p class="legenda">Ninguém é responsável por este grupo ainda.</p>
		{:else}
			<ul class="responsaveis">
				{#each g.responsaveis as r (r.atribuicaoId)}
					<li>
						<a href="/pessoas/{r.personId}">{r.nome}</a>
						<span class="papel">{r.papel}</span>
						{#if data.podeGerirResponsaveis && data.reautenticado && r.personId !== data.euId}
							<form
								method="POST"
								action="?/removerResponsavel"
								use:enhance={comCarregamento(`remover-${r.atribuicaoId}`)}
							>
								<input type="hidden" name="atribuicaoId" value={r.atribuicaoId} />
								<Botao
									tipo="submit"
									variante="destrutivo"
									carregando={enviando === `remover-${r.atribuicaoId}`}
									aria-label="Retirar {r.nome} da responsabilidade"
								>
									Retirar
								</Botao>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.podeGerirResponsaveis}
			{#if !data.reautenticado}
				<PedidoDeReautenticacao acao="definir os responsáveis do grupo" />
			{:else if data.papeisDeGrupo.length > 0}
				<form
					method="POST"
					action="?/atribuirResponsavel"
					class="empilhado"
					use:enhance={comCarregamento('responsavel')}
				>
					<Seletor
						id="personId-responsavel"
						name="personId"
						rotulo="Nova pessoa responsável"
						opcoes={data.pessoasDaEquipe}
						vazio="Escolha a pessoa"
					/>
					{#if data.papeisDeGrupo.length > 1}
						<Seletor id="roleId" rotulo="Papel" opcoes={data.papeisDeGrupo} />
					{:else}
						<input type="hidden" name="roleId" value={data.papeisDeGrupo[0]?.valor} />
					{/if}
					<Botao tipo="submit" variante="secundario" carregando={enviando === 'responsavel'}>
						Tornar {data.papeisDeGrupo.length === 1
							? data.papeisDeGrupo[0]?.rotulo.toLowerCase()
							: 'responsável'}
					</Botao>
				</form>
			{/if}
		{/if}
	</section>

	<section class="cartao" aria-label="Pessoas do grupo">
		<div class="cabecalho">
			<h3>Pessoas</h3>
			<span class="contagem">{g.pessoas.length}</span>
		</div>

		{#if g.pessoas.length === 0}
			<EstadoVazio titulo="Ninguém neste grupo ainda">
				{#if data.podeColocar}
					Coloque aqui quem já frequenta — ou cadastre quem acabou de chegar.
				{/if}
			</EstadoVazio>
		{:else}
			<ul class="pessoas">
				{#each g.pessoas as p (p.personId)}
					<li>
						<a href="/pessoas/{p.personId}">
							<span class="nome">{p.nome}</span>
							<span class="meta">
								{#if p.estagioNome}
									<Etiqueta cor={p.estagioCor}>{p.estagioNome}</Etiqueta>
								{/if}
								{#if p.telefone}
									<span class="telefone">{formatarTelefone(p.telefone)}</span>
								{/if}
								<span class="desde">desde {dataCurta.format(new Date(p.desde))}</span>
							</span>
							{#if p.pendencias.length > 0}
								<span class="pendencias">
									{#each p.pendencias as pend (pend)}
										<span class="pendencia">{PENDENCIA[pend]}</span>
									{/each}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<!--
			Frequência é a terceira coluna que RF-04.3 pede. Ela depende de
			presença registrada, que chega com o M06 — o texto diz isso em vez de
			mostrar uma coluna vazia.
		-->
		<p class="legenda">
			A frequência de cada pessoa aparece aqui quando a presença começar a ser registrada.
		</p>

		{#if data.podeColocar}
			{#if data.candidatos.length > 0}
				<form
					method="POST"
					action="?/colocar"
					class="empilhado"
					use:enhance={comCarregamento('colocar')}
				>
					<Seletor
						id="personId"
						rotulo="Colocar no grupo"
						opcoes={data.candidatos}
						vazio="Escolha a pessoa"
					/>
					<Botao tipo="submit" variante="secundario" carregando={enviando === 'colocar'}>
						Colocar no grupo
					</Botao>
				</form>
			{/if}
			{#if data.podeCadastrar}
				<Botao href="/pessoas/nova?grupo={g.id}" variante="secundario">
					Cadastrar alguém novo neste grupo
				</Botao>
			{/if}
		{/if}
	</section>

	{#if g.sairamRecentemente.length > 0}
		<section class="cartao" aria-label="Saíram recentemente">
			<h3>Saíram nos últimos 90 dias</h3>
			<ul class="sairam">
				{#each g.sairamRecentemente as s (s.personId)}
					<li>
						<a href="/pessoas/{s.personId}">{s.nome}</a>
						<span class="legenda">
							{[dataCurta.format(new Date(s.saiuEm)), s.motivo].filter(Boolean).join(' · ')}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.podeArquivar}
		<section class="cartao" aria-label="Arquivo">
			{#if g.arquivadoEm}
				<h3>Reativar o grupo</h3>
				<form method="POST" action="?/reativar" use:enhance={comCarregamento('reativar')}>
					<Botao tipo="submit" variante="secundario" carregando={enviando === 'reativar'}>
						Reativar
					</Botao>
				</form>
			{:else}
				<h3>Arquivar o grupo</h3>
				<p class="legenda">
					Só um grupo vazio se arquiva — sem pessoas e sem responsáveis. A história de quem passou
					por ele continua guardada.
				</p>
				{#if g.pessoas.length === 0 && g.responsaveis.length === 0}
					<form method="POST" action="?/arquivar" use:enhance={comCarregamento('arquivar')}>
						<Botao tipo="submit" variante="destrutivo" carregando={enviando === 'arquivar'}>
							Arquivar
						</Botao>
					</form>
				{/if}
			{/if}
		</section>
	{/if}
</main>

<style>
	.eventos {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.identidade {
		border-top: 4px solid var(--cor-grupo, var(--cor-linha-forte));
	}

	h1 {
		font-size: var(--texto-2xl);
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	h3 {
		font-size: var(--texto-lg);
	}

	.ponto {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--cor-grupo, var(--cor-texto-3));
		flex: none;
	}

	.combinado {
		color: var(--cor-texto-2);
	}

	.descricao {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		white-space: pre-line;
	}

	.arquivado {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-aviso);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	.cabecalho {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.contagem {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
	}

	.responsaveis,
	.pessoas,
	.sairam {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.responsaveis li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
		padding: var(--esp-2) 0;
		border-bottom: 1px solid var(--cor-linha);
	}

	.responsaveis li:last-child {
		border-bottom: 0;
	}

	.responsaveis form {
		margin-left: auto;
	}

	.papel {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.pessoas a {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		padding: var(--esp-3) 0;
		border-bottom: 1px solid var(--cor-linha);
		color: inherit;
		text-decoration: none;
	}

	.pessoas li:last-child a {
		border-bottom: 0;
	}

	.pessoas a:hover .nome {
		color: var(--cor-marca);
	}

	.pessoas a:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.nome {
		font-weight: 600;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.desde {
		color: var(--cor-texto-3);
	}

	.pendencias {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1);
	}

	.pendencia {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-aviso);
		background: var(--cor-aviso-suave);
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	.sairam li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		padding: var(--esp-2) 0;
	}

	.empilhado {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}
</style>
