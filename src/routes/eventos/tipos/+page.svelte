<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Tipo = {
		id: string;
		name: string;
		slug: string;
		description: string | null;
		color: string | null;
		active: boolean;
	};

	const COR_PADRAO = '#A91825';

	let tipos = $state<Tipo[]>([]);
	let podeCriar = $state(false);
	let podeEditar = $state(false);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	let novoNome = $state('');
	let novaCor = $state(COR_PADRAO);
	let erroNome = $state<string | undefined>(undefined);
	let criando = $state(false);

	let editandoId = $state<string | null>(null);
	let edNome = $state('');
	let edCor = $state(COR_PADRAO);
	let edDescricao = $state('');
	let salvandoId = $state<string | null>(null);

	const ativos = $derived(tipos.filter((t) => t.active));
	const inativos = $derived(tipos.filter((t) => !t.active));

	onMount(carregar);

	async function carregar() {
		carregando = true;
		erro = undefined;
		try {
			const res = await api.get('/api/eventos/tipos');
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível carregar os tipos de evento.';
				return;
			}
			tipos = d.tipos ?? [];
			podeCriar = Boolean(d.podeCriarTipos);
			podeEditar = Boolean(d.podeEditarTipos);
		} catch {
			erro = 'Sem conexão. Não foi possível carregar os tipos de evento.';
		} finally {
			carregando = false;
		}
	}

	/** "Ação social" → `acao-social`. O identificador não muda depois de criado. */
	function slugDe(nome: string) {
		return (
			nome
				.normalize('NFD')
				.replace(/[̀-ͯ]/g, '')
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 50) || 'tipo'
		);
	}

	async function criar(e: SubmitEvent) {
		e.preventDefault();
		erroNome = undefined;
		mensagem = undefined;
		const nome = novoNome.trim();
		if (!nome) {
			erroNome = 'Dê um nome ao tipo.';
			return;
		}

		let slug = slugDe(nome);
		for (let n = 2; tipos.some((t) => t.slug === slug); n++) slug = `${slugDe(nome)}-${n}`;

		criando = true;
		try {
			const res = await api.post('/api/eventos/tipos', { name: nome, slug, color: novaCor });
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = `Tipo "${nome}" criado.`;
				novoNome = '';
				novaCor = COR_PADRAO;
				await carregar();
			} else {
				erroNome = d.erro ?? 'Não foi possível criar o tipo.';
			}
		} catch {
			erroNome = 'Sem conexão. O tipo não foi criado.';
		} finally {
			criando = false;
		}
	}

	function abrirEdicao(t: Tipo) {
		editandoId = t.id;
		edNome = t.name;
		edCor = t.color ?? COR_PADRAO;
		edDescricao = t.description ?? '';
	}

	async function salvar(t: Tipo, mudancas: Record<string, unknown>, aviso: string) {
		salvandoId = t.id;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.put(`/api/eventos/tipos/${t.id}`, mudancas);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = aviso;
				editandoId = null;
				await carregar();
			} else {
				erro = d.erro ?? 'Não foi possível salvar o tipo.';
			}
		} catch {
			erro = 'Sem conexão. Nada foi salvo.';
		} finally {
			salvandoId = null;
		}
	}

	function salvarEdicao(e: SubmitEvent, t: Tipo) {
		e.preventDefault();
		if (!edNome.trim()) {
			erro = 'O tipo precisa de um nome.';
			return;
		}
		salvar(
			t,
			{ name: edNome.trim(), color: edCor, description: edDescricao.trim() || null },
			'Tipo atualizado.'
		);
	}
</script>

<svelte:head>
	<title>Tipos de evento · Eagles</title>
</svelte:head>

{#snippet linhaTipo(t: Tipo)}
	<li class="tipo" class:inativo={!t.active}>
		{#if editandoId === t.id}
			<form class="edicao" onsubmit={(e) => salvarEdicao(e, t)}>
				<Campo id={`nome-${t.id}`} rotulo="Nome" bind:valor={edNome} maxlength="80" obrigatorio />
				<div class="linha-cor">
					<label for={`cor-${t.id}`}>Cor</label>
					<input id={`cor-${t.id}`} type="color" bind:value={edCor} />
				</div>
				<div class="campo-texto">
					<label for={`desc-${t.id}`}>Descrição</label>
					<textarea id={`desc-${t.id}`} bind:value={edDescricao} rows="2" maxlength="300"
					></textarea>
				</div>
				<div class="botoes">
					<Botao tipo="submit" carregando={salvandoId === t.id}>Salvar</Botao>
					<Botao variante="texto" onclick={() => (editandoId = null)}>Cancelar</Botao>
				</div>
			</form>
		{:else}
			<span class="amostra" style="--cor: {t.color ?? COR_PADRAO}" aria-hidden="true"></span>
			<div class="info">
				<strong>{t.name}</strong>
				{#if t.description}<span class="desc">{t.description}</span>{/if}
				{#if !t.active}<span class="desc">Desativado: não aparece em eventos novos.</span>{/if}
			</div>
			{#if podeEditar}
				<div class="botoes">
					{#if t.active}
						<Botao variante="texto" onclick={() => abrirEdicao(t)}>Editar</Botao>
						<Botao
							variante="texto"
							carregando={salvandoId === t.id}
							onclick={() => salvar(t, { active: false }, `"${t.name}" desativado.`)}
						>
							Desativar
						</Botao>
					{:else}
						<Botao
							variante="secundario"
							carregando={salvandoId === t.id}
							onclick={() => salvar(t, { active: true }, `"${t.name}" reativado.`)}
						>
							Reativar
						</Botao>
					{/if}
				</div>
			{/if}
		{/if}
	</li>
{/snippet}

<main class="conteudo">
	<div class="pilha">
		<a href="/eventos" class="voltar">← Eventos</a>

		<header>
			<h1>Tipos de evento</h1>
			<p class="sub">
				PG (Pequeno Grupo), Outside, viagem… Cada evento tem um tipo, e o tipo dá a cor na agenda.
				Desativar esconde o tipo dos eventos novos sem mexer nos antigos.
			</p>
		</header>

		{#if mensagem}<Aviso tom="sucesso">{mensagem}</Aviso>{/if}
		{#if erro}<Aviso tom="erro">{erro}</Aviso>{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando…</p>
			</div>
		{:else}
			{#if podeCriar}
				<form class="novo" onsubmit={criar} novalidate>
					<h2>Novo tipo</h2>
					<Campo
						id="novo-nome"
						rotulo="Nome"
						bind:valor={novoNome}
						erro={erroNome}
						maxlength="80"
						placeholder="Ex.: Acampamento"
					/>
					<div class="linha-cor">
						<label for="nova-cor">Cor</label>
						<input id="nova-cor" type="color" bind:value={novaCor} />
					</div>
					<Botao tipo="submit" carregando={criando}>Criar tipo</Botao>
				</form>
			{/if}

			{#if tipos.length === 0}
				<div class="vazio">
					<Marca tamanho={44} />
					<h2>Nenhum tipo ainda</h2>
					<p>Crie o primeiro tipo para poder cadastrar eventos.</p>
				</div>
			{:else}
				<ul class="lista">
					{#each ativos as t (t.id)}
						{@render linhaTipo(t)}
					{/each}
				</ul>

				{#if inativos.length > 0}
					<h2 class="titulo-inativos">Desativados</h2>
					<ul class="lista">
						{#each inativos as t (t.id)}
							{@render linhaTipo(t)}
						{/each}
					</ul>
				{/if}
			{/if}

			{#if podeCriar && !podeEditar}
				<p class="sub">
					Você pode criar tipos. Editar e desativar ficam com quem gerencia os eventos da equipe
					toda, porque mudam o que toda a equipe vê.
				</p>
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

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.novo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
	}

	.novo h2,
	.titulo-inativos {
		font-size: var(--texto-lg);
	}

	.linha-cor {
		display: flex;
		align-items: center;
		gap: var(--esp-3);
	}

	.linha-cor label,
	.campo-texto label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	input[type='color'] {
		width: var(--toque-min);
		height: var(--toque-min);
		padding: 2px;
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		cursor: pointer;
	}

	.campo-texto {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	textarea {
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
		resize: vertical;
	}

	.lista {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.tipo {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.tipo.inativo {
		background: var(--cor-superficie-2);
	}

	.tipo.inativo .info strong {
		color: var(--cor-texto-2);
	}

	.amostra {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: var(--raio-cheio);
		background: var(--cor);
	}

	.info {
		flex: 1;
		min-width: 140px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.desc {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.botoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1);
	}

	.edicao {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.carregando,
	.vazio {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}
</style>
