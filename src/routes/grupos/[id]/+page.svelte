<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	const grupoId = page.params.id ?? '';

	let grupo = $state<any>(null);
	let membros: any[] = $state([]);
	let movimentacao: any[] = $state([]);
	let permissoes = $state({
		podeEditar: false,
		podeArquivar: false,
		podeTransferir: false,
		podeTirarDeTodos: false,
		podeVerPessoas: false
	});
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	// Editar
	let editando = $state(false);
	let edNome = $state('');
	let edDescricao = $state('');
	let salvando = $state(false);

	// Arquivar
	let confirmandoArquivo = $state(false);
	let arquivando = $state(false);

	// Mover integrantes
	let selecionados = $state<string[]>([]);
	let destinos = $state<Array<{ id: string; name: string }>>([]);
	let destino = $state('');
	let motivo = $state('');
	let movendo = $state(false);

	const STATUS_ROTULO: Record<string, string> = {
		visitante: 'Visitante',
		recorrente: 'Recorrente',
		membro: 'Membro',
		conselheiro: 'Membro',
		lider: 'Membro'
	};

	/** Valor do seletor que significa "tirar de todos os PGs". */
	const SEM_PG = '__sem_pg__';

	onMount(carregar);

	async function carregar() {
		erro = undefined;
		try {
			const res = await api.get(`/api/grupos/${grupoId}`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = data.erro ?? 'Não foi possível carregar o grupo.';
				return;
			}
			grupo = data.grupo;
			membros = data.membros ?? [];
			movimentacao = data.movimentacao ?? [];
			permissoes = data.permissoes ?? permissoes;
			selecionados = selecionados.filter((id) => membros.some((m) => m.id === id));

			if (permissoes.podeTransferir && destinos.length === 0) {
				const r = await api.get('/api/grupos');
				if (r.ok) {
					const d = await r.json();
					destinos = (d.grupos ?? []).filter((g: any) => g.id !== grupoId);
				}
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os dados do grupo podem estar desatualizados.'
					: 'Erro ao carregar o grupo.';
		} finally {
			carregando = false;
		}
	}

	function rotuloStatus(s: string | null | undefined) {
		return STATUS_ROTULO[s ?? 'visitante'] ?? s ?? 'Visitante';
	}

	function abrirEdicao() {
		edNome = grupo.name;
		edDescricao = grupo.description ?? '';
		mensagem = undefined;
		editando = true;
	}

	async function salvarEdicao(e: SubmitEvent) {
		e.preventDefault();
		if (!edNome.trim()) {
			erro = 'Dê um nome ao subgrupo.';
			return;
		}
		salvando = true;
		erro = undefined;
		try {
			const res = await api.patch(`/api/grupos/${grupoId}`, {
				name: edNome.trim(),
				description: edDescricao.trim() || null
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem;
				editando = false;
				await carregar();
			} else {
				erro = d.erro ?? 'Não foi possível salvar.';
			}
		} catch {
			erro = 'Sem conexão. Nada foi salvo.';
		} finally {
			salvando = false;
		}
	}

	async function alternarArquivo(arquivar: boolean) {
		arquivando = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.patch(`/api/grupos/${grupoId}`, { arquivado: arquivar });
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem;
				confirmandoArquivo = false;
				await carregar();
			} else {
				erro = d.erro ?? 'Não foi possível mudar o subgrupo.';
			}
		} catch {
			erro = 'Sem conexão. Nada mudou.';
		} finally {
			arquivando = false;
		}
	}

	function alternarSelecao(id: string) {
		selecionados = selecionados.includes(id)
			? selecionados.filter((x) => x !== id)
			: [...selecionados, id];
	}

	async function mover() {
		if (selecionados.length === 0 || !destino) return;
		movendo = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/grupos/transferencias', {
				pessoas: selecionados,
				paraGrupoId: destino === SEM_PG ? null : destino,
				motivo: motivo.trim() || null
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem;
				selecionados = [];
				destino = '';
				motivo = '';
				await carregar();
			} else {
				erro = d.erro ?? 'Não foi possível mover.';
			}
		} catch {
			erro = 'Sem conexão. Ninguém foi movido.';
		} finally {
			movendo = false;
		}
	}

	function data(iso: string) {
		return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
	}

	function descreverMovimento(mv: any) {
		if (mv.tipo === 'chegou') return mv.outroGrupo ? `chegou de ${mv.outroGrupo}` : 'chegou';
		return mv.outroGrupo ? `foi para ${mv.outroGrupo}` : 'saiu dos subgrupos';
	}
</script>

<svelte:head>
	<title>{grupo?.name || 'Subgrupo'} · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/grupos" class="voltar">← Subgrupos</a>

		{#if editando}
			<form class="painel" onsubmit={salvarEdicao}>
				<h1>Editar subgrupo</h1>
				<Campo
					id="nome-pg"
					rotulo="Nome do subgrupo"
					bind:valor={edNome}
					obrigatorio
					maxlength="100"
				/>
				<div class="campo-texto">
					<label for="desc-pg">Descrição</label>
					<textarea id="desc-pg" bind:value={edDescricao} rows="3" maxlength="500"></textarea>
				</div>
				<div class="botoes">
					<Botao tipo="submit" carregando={salvando}>Salvar</Botao>
					<Botao variante="texto" desabilitado={salvando} onclick={() => (editando = false)}>
						Cancelar
					</Botao>
				</div>
			</form>
		{:else}
			<header>
				<div class="topo">
					<h1>{grupo?.name || 'Carregando…'}</h1>
					{#if grupo?.arquivado}<span class="arquivado">Arquivado</span>{/if}
				</div>
				{#if grupo?.description}<p class="sub">{grupo.description}</p>{/if}
				{#if grupo && (permissoes.podeEditar || permissoes.podeArquivar)}
					<div class="botoes">
						{#if permissoes.podeEditar}
							<Botao variante="secundario" onclick={abrirEdicao}>Editar subgrupo</Botao>
						{/if}
						{#if permissoes.podeArquivar}
							{#if grupo.arquivado}
								<Botao
									variante="secundario"
									carregando={arquivando}
									onclick={() => alternarArquivo(false)}
								>
									Reativar subgrupo
								</Botao>
							{:else if !confirmandoArquivo}
								<Botao variante="texto" onclick={() => (confirmandoArquivo = true)}>
									Arquivar subgrupo
								</Botao>
							{/if}
						{/if}
					</div>
				{/if}
			</header>
		{/if}

		{#if confirmandoArquivo && grupo && !grupo.arquivado}
			<div class="confirmar" role="group" aria-labelledby="titulo-arquivar">
				<h2 id="titulo-arquivar">Arquivar {grupo.name}?</h2>
				<p class="sub">
					O subgrupo sai das listas e não recebe mais ninguém. Os eventos e o histórico de quem
					passou por ele ficam guardados, e você pode reativá-lo depois. Só dá para arquivar um
					subgrupo vazio e sem eventos marcados.
				</p>
				<div class="botoes">
					<Botao
						variante="destrutivo"
						carregando={arquivando}
						onclick={() => alternarArquivo(true)}
					>
						Arquivar
					</Botao>
					<Botao
						variante="texto"
						desabilitado={arquivando}
						onclick={() => (confirmandoArquivo = false)}
					>
						Manter
					</Botao>
				</div>
			</div>
		{/if}

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando && !grupo}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando grupo…</p>
			</div>
		{:else if grupo}
			<div class="grupo-resumo">
				<p class="contagem">
					{membros.length}
					{membros.length === 1 ? 'integrante' : 'integrantes'}
				</p>
			</div>

			<div class="cabecalho-secao">
				<h2>Integrantes</h2>
				{#if permissoes.podeTransferir && membros.length > 0}
					<span class="dica">Marque quem vai mudar de subgrupo</span>
				{/if}
			</div>

			{#if membros.length === 0}
				<div class="vazio">
					<p>Este subgrupo ainda não tem integrantes vinculados.</p>
				</div>
			{:else}
				<ul class="lista-membros">
					{#each membros as m (m.id)}
						<li class="membro-item" class:marcado={selecionados.includes(m.id)}>
							{#if permissoes.podeTransferir}
								<input
									type="checkbox"
									class="marcar"
									checked={selecionados.includes(m.id)}
									onchange={() => alternarSelecao(m.id)}
									aria-label={`Selecionar ${m.nome} para mudar de subgrupo`}
								/>
							{/if}
							<div class="membro-info">
								{#if permissoes.podeVerPessoas}
									<a class="nome" href={`/pessoas/${m.id}`}>{m.nome}</a>
								{:else}
									<strong>{m.nome}</strong>
								{/if}
								{#if m.funcao}<span class="funcao">{m.funcao}</span>{/if}
								{#if m.whatsapp}
									<span class="contato">
										<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
											<path
												d="M3.5 2.5h2.2l1 2.8-1.4 1.1a8.5 8.5 0 0 0 4.3 4.3l1.1-1.4 2.8 1v2.2a1 1 0 0 1-1 1A10 10 0 0 1 2.5 3.5a1 1 0 0 1 1-1z"
												fill="none"
												stroke="currentColor"
												stroke-width="1.3"
												stroke-linejoin="round"
											/>
										</svg>
										{m.whatsapp}
									</span>
								{/if}
							</div>
							<span class="status-chip chip-{m.status || 'visitante'}">
								{rotuloStatus(m.status)}
							</span>
						</li>
					{/each}
				</ul>

				{#if selecionados.length > 0}
					<section class="painel mover" aria-labelledby="titulo-mover">
						<h2 id="titulo-mover">
							Mover {selecionados.length}
							{selecionados.length === 1 ? 'pessoa' : 'pessoas'}
						</h2>
						<div class="campo-texto">
							<label for="destino">Para qual subgrupo</label>
							<select id="destino" bind:value={destino}>
								<option value="" disabled>Escolha o subgrupo</option>
								{#each destinos as g (g.id)}
									<option value={g.id}>{g.name}</option>
								{/each}
								{#if permissoes.podeTirarDeTodos}
									<option value={SEM_PG}>Tirar de todos os subgrupos</option>
								{/if}
							</select>
						</div>
						<div class="campo-texto">
							<label for="motivo-mover">Motivo (opcional, fica no histórico)</label>
							<textarea
								id="motivo-mover"
								bind:value={motivo}
								rows="2"
								maxlength="500"
								placeholder="Ex.: reorganização do semestre"
							></textarea>
						</div>
						<div class="botoes">
							<Botao carregando={movendo} desabilitado={!destino} onclick={mover}>Mover</Botao>
							<Botao variante="texto" desabilitado={movendo} onclick={() => (selecionados = [])}>
								Desmarcar todos
							</Botao>
						</div>
					</section>
				{/if}
			{/if}

			{#if movimentacao.length > 0}
				<h2>Chegadas e saídas recentes</h2>
				<ul class="movimentos">
					{#each movimentacao as mv (mv.id)}
						<li>
							<span class="sinal sinal-{mv.tipo}" aria-hidden="true">
								{mv.tipo === 'chegou' ? '→' : '←'}
							</span>
							<div>
								<span><strong>{mv.pessoa.nome}</strong> {descreverMovimento(mv)}</span>
								<span class="detalhe">
									{data(mv.em)}{#if mv.por}&nbsp;· por {mv.por}{/if}{#if mv.origem === 'ia'}&nbsp;·
										sugestão da IA aceita{/if}
								</span>
								{#if mv.motivo}<span class="motivo">{mv.motivo}</span>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</main>

<style>
	.voltar {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.topo {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		margin: 0;
	}

	.arquivado {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
		border: 1px solid var(--cor-linha);
	}

	.botoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		margin-top: var(--esp-2);
	}

	.painel {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
	}

	/* O painel de mover fica à vista enquanto se marca a lista inteira. */
	.mover {
		border-color: var(--cor-marca);
		position: sticky;
		/* Acima da barra inferior do celular (variável da Moldura; 0 no desktop). */
		bottom: calc(var(--altura-barra, 0px) + env(safe-area-inset-bottom) + var(--esp-3));
		box-shadow: 0 6px 24px color-mix(in srgb, var(--cor-texto) 14%, transparent);
	}

	.confirmar {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-4);
		border: 1px solid var(--cor-erro);
		border-radius: var(--raio-lg);
		background: var(--cor-erro-suave);
	}

	.campo-texto {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-texto label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	select,
	textarea {
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		/* 16px evita o zoom automático do Safari no iPhone. */
		font-size: 16px;
		font-family: inherit;
	}

	select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
	}

	textarea {
		padding: var(--esp-2) var(--esp-3);
		resize: vertical;
	}

	select:focus-visible,
	textarea:focus-visible {
		border-color: var(--cor-foco);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-foco) 24%, transparent);
		outline: none;
	}

	.grupo-resumo {
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie-2);
		border-radius: var(--raio);
		border: 1px solid var(--cor-linha);
	}

	.contagem {
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-texto);
	}

	h2 {
		font-size: var(--texto-lg);
	}

	.cabecalho-secao {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.dica {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.lista-membros {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.membro-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.membro-item.marcado {
		border-color: var(--cor-marca);
		background: var(--cor-marca-suave);
	}

	.marcar {
		flex: none;
		width: 22px;
		height: 22px;
		accent-color: var(--cor-marca);
		cursor: pointer;
	}

	.membro-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.membro-info strong,
	.nome {
		font-size: var(--texto-base);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.nome {
		color: var(--cor-texto);
		text-decoration: underline;
		text-decoration-color: var(--cor-linha-forte);
		text-underline-offset: 3px;
	}

	.funcao {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-marca);
	}

	.contato {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-1);
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.status-chip {
		flex: none;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		font-size: var(--texto-xs);
		font-weight: 700;
	}

	.chip-visitante {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
		border: 1px solid var(--cor-linha);
	}

	.chip-recorrente {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
		border: 1px solid var(--cor-marca);
	}

	.chip-membro,
	.chip-conselheiro,
	.chip-lider {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border: 1px solid var(--cor-sucesso);
	}

	.movimentos {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.movimentos li {
		display: flex;
		gap: var(--esp-3);
		align-items: flex-start;
		font-size: var(--texto-sm);
	}

	.movimentos li > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.sinal {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: var(--raio-cheio);
		font-weight: 700;
	}

	.sinal-chegou {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.sinal-saiu {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.detalhe {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.motivo {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		font-style: italic;
	}

	.vazio,
	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.vazio p,
	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}
</style>
