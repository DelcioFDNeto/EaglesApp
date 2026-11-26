<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Aba = 'livro' | 'config';

	let aba = $state<Aba>('livro');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	let escopoVisibilidade = $state<'all' | 'group' | 'own'>('own');
	let permissoes = $state({
		podeLancar: false,
		podeAprovar: false,
		podeEstornar: false,
		podeGerenciarCategorias: false,
		aprovacaoDespesasAtiva: false
	});
	let resumo = $state({
		arrecadadoCents: 0,
		despesasCents: 0,
		saldoCents: 0,
		pendentesAprovacaoCents: 0,
		totalMovimentacoes: 0
	});

	let movimentacoes = $state<any[]>([]);
	let categorias = $state<any[]>([]);
	let regras = $state<any[]>([]);
	let eventos = $state<any[]>([]);
	let grupos = $state<any[]>([]);

	// Filtros
	let filtroTipo = $state('');
	let filtroEventoId = $state('');
	let filtroGrupoId = $state('');

	// Novo lançamento
	let formKind = $state<'entrada' | 'saida'>('entrada');
	let formCategoryId = $state('');
	let formValorReais = $state('');
	let formMetodo = $state<'pix' | 'especie' | 'cartao' | 'transferencia' | 'outro'>('pix');
	let formDescricao = $state('');
	let formEventId = $state('');
	let formGroupId = $state('');
	let formReceiptUrl = $state('');
	let salvandoLancamento = $state(false);

	// Estorno (RN-21)
	let estornandoId = $state<string | null>(null);
	let motivoEstorno = $state('');
	let salvandoEstorno = $state(false);

	// Nova categoria (RF-08.1)
	let novaCatNome = $state('');
	let novaCatSlug = $state('');
	let novaCatKind = $state<'entrada' | 'saida'>('entrada');
	let novaCatDoacao = $state(false);
	let salvandoCat = $state(false);

	// Nova regra de mínimo (RN-22)
	let regraCategoryId = $state('');
	let regraRoleKey = $state('membro');
	let regraValorReais = $state('');
	let regraPeriodo = $state<'mensal' | 'avulso'>('mensal');
	let salvandoRegra = $state(false);

	const categoriasDoTipo = $derived(categorias.filter((c) => c.kind === formKind));
	const categoriasEntradaNaoDoacao = $derived(
		categorias.filter((c) => c.kind === 'entrada' && !c.isDonation)
	);

	const METODO_ROTULO: Record<string, string> = {
		pix: 'PIX',
		especie: 'Espécie',
		cartao: 'Cartão',
		transferencia: 'Transferência',
		outro: 'Outro'
	};

	const ESCOPO_ROTULO: Record<string, string> = {
		all: 'Livro-caixa completo dos Eagles',
		group: 'Movimentações do seu grupo e suas contribuições',
		own: 'Suas contribuições registradas'
	};

	function formatarCentavos(cents: number): string {
		const inteiro = Math.trunc(cents);
		const negativo = inteiro < 0;
		const abs = Math.abs(inteiro);
		const reais = Math.floor(abs / 100);
		const resto = abs % 100;
		return `${negativo ? '-' : ''}R$ ${reais.toLocaleString('pt-BR')},${String(resto).padStart(2, '0')}`;
	}

	function parseReaisParaCentavos(texto: string): number | null {
		const limpo = texto.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
		if (!limpo) return null;
		const norm = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
		if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
		const [r, c = ''] = norm.split('.');
		const total = Number.parseInt(r ?? '0', 10) * 100 + Number.parseInt(c.padEnd(2, '0'), 10);
		return total > 0 ? total : null;
	}

	onMount(() => {
		carregarTudo();
	});

	async function carregarMovimentacoes() {
		const params = new URLSearchParams();
		if (filtroTipo) params.set('tipo', filtroTipo);
		if (filtroEventoId) params.set('eventoId', filtroEventoId);
		if (filtroGrupoId) params.set('grupoId', filtroGrupoId);

		const qs = params.toString();
		const res = await api.get(`/api/financeiro/movimentacoes${qs ? `?${qs}` : ''}`);
		if (res.ok) {
			const d = await res.json();
			escopoVisibilidade = d.escopoVisibilidade ?? 'own';
			if (d.permissoesFinanceiro) permissoes = d.permissoesFinanceiro;
			if (d.resumo) resumo = d.resumo;
			movimentacoes = d.movimentacoes ?? [];
		} else {
			const d = await res.json().catch(() => ({}));
			erro = d.erro ?? 'Você não tem permissão para acessar o financeiro.';
		}
	}

	async function carregarTudo() {
		carregando = true;
		erro = undefined;
		try {
			await carregarMovimentacoes();

			const [resCat, resRegras, resEventos, resGrupos] = await Promise.all([
				api.get('/api/financeiro/categorias'),
				api.get('/api/financeiro/regras'),
				api.get('/api/eventos'),
				api.get('/api/grupos')
			]);

			if (resCat.ok) {
				const d = await resCat.json();
				categorias = d.categorias ?? [];
				const primeira = categorias.find((c) => c.kind === formKind);
				if (!formCategoryId && primeira) formCategoryId = primeira.id;
				const primeiraRegra = categorias.find((c) => c.kind === 'entrada' && !c.isDonation);
				if (!regraCategoryId && primeiraRegra) regraCategoryId = primeiraRegra.id;
			}
			if (resRegras.ok) {
				const d = await resRegras.json();
				regras = d.regras ?? [];
			}
			if (resEventos.ok) {
				const d = await resEventos.json();
				eventos = d.eventos ?? [];
			}
			if (resGrupos.ok) {
				const d = await resGrupos.json();
				grupos = d.grupos ?? [];
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Operações financeiras exigem conexão com a internet.'
					: 'Não foi possível carregar o módulo financeiro.';
		} finally {
			carregando = false;
		}
	}

	async function lancarMovimentacao() {
		const amountCents = parseReaisParaCentavos(formValorReais);
		if (!amountCents) {
			erro = 'Informe um valor válido maior que zero (ex.: 50,00).';
			return;
		}
		if (!formCategoryId) {
			erro = 'Selecione uma categoria.';
			return;
		}
		salvandoLancamento = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/financeiro/movimentacoes', {
				kind: formKind,
				categoryId: formCategoryId,
				amountCents,
				paymentMethod: formMetodo,
				description: formDescricao.trim(),
				eventId: formEventId || null,
				groupId: formGroupId || null,
				receiptUrl: formReceiptUrl.trim() || null
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Movimentação registrada.';
				formValorReais = '';
				formDescricao = '';
				formReceiptUrl = '';
				await carregarMovimentacoes();
			} else {
				erro = d.erro ?? 'Não foi possível registrar a movimentação.';
			}
		} catch {
			erro = 'Erro ao registrar movimentação.';
		} finally {
			salvandoLancamento = false;
		}
	}

	async function confirmarEstorno(id: string) {
		if (motivoEstorno.trim().length < 3) {
			erro = 'Informe o motivo do estorno (mínimo 3 caracteres).';
			return;
		}
		salvandoEstorno = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post(`/api/financeiro/movimentacoes/${id}/estornar`, {
				motivo: motivoEstorno.trim()
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Estorno registrado.';
				estornandoId = null;
				motivoEstorno = '';
				await carregarMovimentacoes();
			} else {
				erro = d.erro ?? 'Não foi possível estornar.';
			}
		} catch {
			erro = 'Erro ao estornar lançamento.';
		} finally {
			salvandoEstorno = false;
		}
	}

	async function decidirAprovacao(id: string, decisao: 'aprovar' | 'rejeitar') {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post(`/api/financeiro/movimentacoes/${id}/aprovar`, {
				decisao,
				motivo: decisao === 'rejeitar' ? 'Rejeitada na revisão' : undefined
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Decisão registrada.';
				await carregarMovimentacoes();
			} else {
				erro = d.erro ?? 'Não foi possível atualizar a aprovação.';
			}
		} catch {
			erro = 'Erro ao aprovar/rejeitar despesa.';
		}
	}

	async function criarCategoria() {
		if (!novaCatNome.trim() || !novaCatSlug.trim()) return;
		salvandoCat = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/financeiro/categorias', {
				name: novaCatNome.trim(),
				slug: novaCatSlug.trim().toLowerCase(),
				kind: novaCatKind,
				isDonation: novaCatKind === 'entrada' && novaCatDoacao
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Categoria criada.';
				novaCatNome = '';
				novaCatSlug = '';
				novaCatDoacao = false;
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível criar a categoria.';
			}
		} catch {
			erro = 'Erro ao criar categoria.';
		} finally {
			salvandoCat = false;
		}
	}

	async function criarRegra() {
		const minAmountCents = parseReaisParaCentavos(regraValorReais);
		if (!regraCategoryId || !minAmountCents) {
			erro = 'Escolha a categoria e um valor mínimo válido.';
			return;
		}
		salvandoRegra = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/financeiro/regras', {
				categoryId: regraCategoryId,
				roleKey: regraRoleKey || null,
				minAmountCents,
				period: regraPeriodo
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Regra de contribuição criada.';
				regraValorReais = '';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível salvar a regra.';
			}
		} catch {
			erro = 'Erro ao salvar regra.';
		} finally {
			salvandoRegra = false;
		}
	}

	async function exportarCsv() {
		erro = undefined;
		try {
			const params = new URLSearchParams();
			if (filtroEventoId) params.set('eventoId', filtroEventoId);
			if (filtroGrupoId) params.set('grupoId', filtroGrupoId);
			const qs = params.toString();
			const res = await api.get(`/api/financeiro/exportar${qs ? `?${qs}` : ''}`);
			if (!res.ok) {
				erro = 'Não foi possível exportar o CSV.';
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'prestacao-de-contas-eagles.csv';
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			erro = 'Erro ao exportar CSV.';
		}
	}

	function compartilharPrestacaoWhatsapp() {
		const titulo = filtroEventoId
			? (eventos.find((e) => e.id === filtroEventoId)?.title ?? 'Eagles')
			: filtroGrupoId
				? (grupos.find((g) => g.id === filtroGrupoId)?.name ?? 'Eagles')
				: 'Eagles';
		const texto = [
			`*Prestação de contas — ${titulo}*`,
			'',
			`• Arrecadado: ${formatarCentavos(resumo.arrecadadoCents)}`,
			`• Despesas: ${formatarCentavos(resumo.despesasCents)}`,
			`• *Saldo: ${formatarCentavos(resumo.saldoCents)}*`,
			`(${resumo.totalMovimentacoes} movimentações confirmadas)`
		].join('\n');
		window.open(
			`https://wa.me/?text=${encodeURIComponent(texto)}`,
			'_blank',
			'noopener,noreferrer'
		);
	}
</script>

<svelte:head>
	<title>Financeiro · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Financeiro</h1>
			<p class="sub">{ESCOPO_ROTULO[escopoVisibilidade]}</p>
		</header>

		{#if permissoes.podeGerenciarCategorias}
			<div class="abas" role="tablist" aria-label="Seções do financeiro">
				<button
					type="button"
					role="tab"
					aria-selected={aba === 'livro'}
					class="aba"
					class:ativa={aba === 'livro'}
					onclick={() => (aba = 'livro')}
				>
					Livro-caixa
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={aba === 'config'}
					class="aba"
					class:ativa={aba === 'config'}
					onclick={() => (aba = 'config')}
				>
					Categorias e regras ({categorias.length})
				</button>
			</div>
		{/if}

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando livro-caixa…</p>
			</div>
		{:else if aba === 'livro'}
			<section class="painel-resumo" aria-label="Resumo financeiro">
				<div class="metrica">
					<span class="rotulo">Arrecadado</span>
					<strong class="valor positivo">{formatarCentavos(resumo.arrecadadoCents)}</strong>
				</div>
				<div class="metrica">
					<span class="rotulo">Despesas</span>
					<strong class="valor">{formatarCentavos(resumo.despesasCents)}</strong>
				</div>
				<div class="metrica destaque-saldo">
					<span class="rotulo">Saldo</span>
					<strong class="valor" class:negativo={resumo.saldoCents < 0}>
						{formatarCentavos(resumo.saldoCents)}
					</strong>
				</div>
			</section>

			{#if resumo.pendentesAprovacaoCents > 0}
				<Aviso tom="aviso">
					Há {formatarCentavos(resumo.pendentesAprovacaoCents)} em despesas aguardando aprovação.
				</Aviso>
			{/if}

			<div class="acoes-linha">
				<Botao variante="secundario" onclick={compartilharPrestacaoWhatsapp}>
					Prestação no WhatsApp
				</Botao>
				<Botao variante="texto" onclick={exportarCsv}>Exportar CSV</Botao>
			</div>

			<div class="filtros">
				<select aria-label="Filtrar por tipo" bind:value={filtroTipo} onchange={carregarMovimentacoes}>
					<option value="">Entradas e saídas</option>
					<option value="entrada">Somente entradas</option>
					<option value="saida">Somente saídas</option>
				</select>
				{#if eventos.length > 0}
					<select
						aria-label="Filtrar por encontro"
						bind:value={filtroEventoId}
						onchange={carregarMovimentacoes}
					>
						<option value="">Todos os encontros</option>
						{#each eventos as ev (ev.id)}
							<option value={ev.id}>{ev.title}</option>
						{/each}
					</select>
				{/if}
				{#if grupos.length > 0}
					<select
						aria-label="Filtrar por grupo"
						bind:value={filtroGrupoId}
						onchange={carregarMovimentacoes}
					>
						<option value="">Todos os grupos</option>
						{#each grupos as g (g.id)}
							<option value={g.id}>{g.name}</option>
						{/each}
					</select>
				{/if}
			</div>

			{#if movimentacoes.length === 0}
				<div class="vazio">
					<Marca tamanho={40} />
					<h2>Nenhuma movimentação encontrada</h2>
					<p>Os lançamentos registrados neste recorte aparecem aqui com histórico imutável.</p>
				</div>
			{:else}
				<ul class="lista">
					{#each movimentacoes as m (m.id)}
						<li class="item">
							<div class="item-topo">
								<div class="item-info">
									<div class="badges">
										<span class="chip chip-{m.kind}">
											{m.kind === 'entrada' ? 'Entrada' : 'Saída'}
										</span>
										<span class="chip chip-neutro">{m.categoryName}</span>
										{#if m.reversesTransactionId}
											<span class="chip chip-estorno">Estorno</span>
										{/if}
										{#if m.jaEstornada}
											<span class="chip chip-estorno">Estornada</span>
										{/if}
										{#if m.status === 'pendente_aprovacao'}
											<span class="chip chip-pendente">Aguardando aprovação</span>
										{:else if m.status === 'rejeitada'}
											<span class="chip chip-rejeitada">Rejeitada</span>
										{/if}
									</div>
									<strong>{m.description}</strong>
									<span class="meta">
										{new Date(m.occurredAt).toLocaleDateString('pt-BR')} ·
										{METODO_ROTULO[m.paymentMethod] ?? m.paymentMethod} ·
										Resp.: {m.responsibleName}
										{#if m.groupName} · {m.groupName}{/if}
										{#if m.eventTitle} · {m.eventTitle}{/if}
									</span>
									{#if m.receiptUrl}
										<a href={m.receiptUrl} target="_blank" rel="noopener noreferrer" class="link-comp">
											Ver comprovante
										</a>
									{/if}
								</div>
								<strong class="valor-linha" class:positivo={m.kind === 'entrada'}>
									{m.kind === 'saida' ? '-' : '+'}{formatarCentavos(m.amountCents)}
								</strong>
							</div>

							{#if (permissoes.podeAprovar && m.status === 'pendente_aprovacao') || (permissoes.podeEstornar && m.status === 'confirmada' && !m.reversesTransactionId && !m.jaEstornada)}
								<div class="acoes-item">
									{#if permissoes.podeAprovar && m.status === 'pendente_aprovacao'}
										<Botao variante="texto" onclick={() => decidirAprovacao(m.id, 'aprovar')}>
											Aprovar despesa
										</Botao>
										<Botao variante="destrutivo" onclick={() => decidirAprovacao(m.id, 'rejeitar')}>
											Rejeitar
										</Botao>
									{/if}
									{#if permissoes.podeEstornar && m.status === 'confirmada' && !m.reversesTransactionId && !m.jaEstornada}
										<Botao
											variante="destrutivo"
											onclick={() => {
												estornandoId = estornandoId === m.id ? null : m.id;
												motivoEstorno = '';
											}}
										>
											Estornar
										</Botao>
									{/if}
								</div>
							{/if}

							{#if estornandoId === m.id}
								<form
									class="form-estorno"
									onsubmit={(e) => {
										e.preventDefault();
										confirmarEstorno(m.id);
									}}
								>
									<p class="aviso-imutavel">
										O lançamento original permanece no histórico e um estorno equivalente será criado.
									</p>
									<Campo
										id={`motivo-${m.id}`}
										rotulo="Motivo do estorno"
										bind:valor={motivoEstorno}
										obrigatorio
									/>
									<div class="acoes-linha">
										<Botao tipo="submit" variante="destrutivo" carregando={salvandoEstorno}>
											Confirmar estorno
										</Botao>
										<Botao variante="texto" onclick={() => (estornandoId = null)}>
											Cancelar
										</Botao>
									</div>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if permissoes.podeLancar && categorias.length > 0}
				<section class="subsecao">
					<h2>Novo lançamento</h2>
					<form
						class="form-bloco"
						onsubmit={(e) => {
							e.preventDefault();
							lancarMovimentacao();
						}}
					>
						<div class="grade-2">
							<div class="campo-select">
								<label for="tx-tipo">Tipo</label>
								<select
									id="tx-tipo"
									bind:value={formKind}
									onchange={() => {
										const primeira = categorias.find((c) => c.kind === formKind);
										formCategoryId = primeira?.id ?? '';
									}}
								>
									<option value="entrada">Entrada</option>
									<option value="saida">Saída / despesa</option>
								</select>
							</div>
							<div class="campo-select">
								<label for="tx-cat">Categoria</label>
								<select id="tx-cat" bind:value={formCategoryId}>
									{#each categoriasDoTipo as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</select>
							</div>
						</div>

						<div class="grade-2">
							<Campo
								id="tx-valor"
								rotulo="Valor (R$)"
								ajuda="Ex.: 45,00"
								inputmode="text"
								bind:valor={formValorReais}
								obrigatorio
							/>
							<div class="campo-select">
								<label for="tx-metodo">Forma de pagamento</label>
								<select id="tx-metodo" bind:value={formMetodo}>
									<option value="pix">PIX</option>
									<option value="especie">Espécie</option>
									<option value="cartao">Cartão</option>
									<option value="transferencia">Transferência</option>
									<option value="outro">Outro</option>
								</select>
							</div>
						</div>

						<Campo id="tx-desc" rotulo="Descrição" bind:valor={formDescricao} obrigatorio />

						<div class="grade-2">
							{#if grupos.length > 0}
								<div class="campo-select">
									<label for="tx-grupo">Grupo / PG (opcional)</label>
									<select id="tx-grupo" bind:value={formGroupId}>
										<option value="">Geral dos Eagles</option>
										{#each grupos as g (g.id)}
											<option value={g.id}>{g.name}</option>
										{/each}
									</select>
								</div>
							{/if}
							{#if eventos.length > 0}
								<div class="campo-select">
									<label for="tx-evento">Encontro (opcional)</label>
									<select id="tx-evento" bind:value={formEventId}>
										<option value="">Nenhum</option>
										{#each eventos as ev (ev.id)}
											<option value={ev.id}>{ev.title}</option>
										{/each}
									</select>
								</div>
							{/if}
						</div>

						<Campo
							id="tx-comp"
							rotulo="Link do comprovante (opcional)"
							bind:valor={formReceiptUrl}
						/>

						<Botao tipo="submit" largura="cheia" carregando={salvandoLancamento}>
							Registrar movimentação
						</Botao>
					</form>
				</section>
			{/if}
		{:else}
			<section class="form-bloco">
				<h2>Categorias configuráveis</h2>
				<ul class="lista">
					{#each categorias as c (c.id)}
						<li class="item">
							<div class="item-topo">
								<div class="item-info">
									<strong>{c.name}</strong>
									<span class="meta">
										{c.kind === 'entrada' ? 'Entrada' : 'Saída'} · #{c.slug}
										{#if c.isDonation} · Doação (sem mínimo){/if}
									</span>
								</div>
							</div>
						</li>
					{/each}
				</ul>

				<section class="subsecao">
					<h3>Nova categoria</h3>
					<form
						class="form-bloco"
						onsubmit={(e) => {
							e.preventDefault();
							criarCategoria();
						}}
					>
						<Campo id="cat-nome" rotulo="Nome" bind:valor={novaCatNome} obrigatorio />
						<Campo id="cat-slug" rotulo="Identificador (slug)" bind:valor={novaCatSlug} obrigatorio />
						<div class="campo-select">
							<label for="cat-kind">Tipo</label>
							<select id="cat-kind" bind:value={novaCatKind}>
								<option value="entrada">Entrada</option>
								<option value="saida">Saída</option>
							</select>
						</div>
						{#if novaCatKind === 'entrada'}
							<label class="check-linha">
								<input type="checkbox" bind:checked={novaCatDoacao} />
								<span>É doação (nunca exige valor mínimo)</span>
							</label>
						{/if}
						<Botao tipo="submit" largura="cheia" carregando={salvandoCat}>
							Criar categoria
						</Botao>
					</form>
				</section>

				{#if categoriasEntradaNaoDoacao.length > 0}
					<section class="subsecao">
						<h3>Valor mínimo de contribuição</h3>
						{#if regras.length > 0}
							<ul class="lista">
								{#each regras as r (r.id)}
									<li class="item">
										<strong>{r.categoryName}</strong>
										<span class="meta">
											Mínimo: {formatarCentavos(r.minAmountCents)} ({r.period})
											{#if r.roleKey} · Papel: {r.roleKey}{/if}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
						<form
							class="form-bloco"
							onsubmit={(e) => {
								e.preventDefault();
								criarRegra();
							}}
						>
							<div class="campo-select">
								<label for="regra-cat">Categoria</label>
								<select id="regra-cat" bind:value={regraCategoryId}>
									{#each categoriasEntradaNaoDoacao as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</select>
							</div>
							<div class="grade-2">
								<div class="campo-select">
									<label for="regra-papel">Papel</label>
									<select id="regra-papel" bind:value={regraRoleKey}>
										<option value="membro">Membro</option>
										<option value="conselheiro">Conselheiro</option>
										<option value="lider">Líder</option>
										<option value="">Todos</option>
									</select>
								</div>
								<Campo
									id="regra-valor"
									rotulo="Valor mínimo (R$)"
									bind:valor={regraValorReais}
									obrigatorio
								/>
							</div>
							<Botao tipo="submit" largura="cheia" carregando={salvandoRegra}>
								Salvar regra
							</Botao>
						</form>
					</section>
				{/if}
			</section>
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

	.abas {
		display: flex;
		gap: var(--esp-1);
		border-bottom: 1px solid var(--cor-linha);
		overflow-x: auto;
	}

	.aba {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
		cursor: pointer;
		white-space: nowrap;
	}

	.aba.ativa {
		color: var(--cor-marca);
		border-bottom-color: var(--cor-marca);
	}

	.painel-resumo {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--esp-2);
	}

	.metrica {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.destaque-saldo {
		background: var(--cor-superficie-2);
		border-color: var(--cor-linha-forte);
	}

	.rotulo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.valor,
	.valor-linha {
		font-family: var(--fonte-titulo);
		font-variant-numeric: tabular-nums;
	}

	.valor {
		font-size: var(--texto-xl);
		font-weight: 800;
	}

	.positivo {
		color: var(--cor-sucesso);
	}

	.negativo {
		color: var(--cor-erro);
	}

	.filtros {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--esp-2);
	}

	.filtros select,
	.campo-select select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		width: 100%;
	}

	.lista {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.item-topo {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	.item-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.valor-linha {
		flex: none;
		font-size: var(--texto-base);
		font-weight: 800;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1);
	}

	.chip {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.chip-entrada {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.chip-saida {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.chip-neutro {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.chip-estorno,
	.chip-pendente {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.chip-rejeitada {
		background: var(--cor-erro-suave);
		color: var(--cor-erro);
	}

	.meta {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.link-comp {
		font-size: var(--texto-xs);
		font-weight: 600;
		align-self: flex-start;
	}

	.acoes-item,
	.acoes-linha {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.acoes-item {
		padding-top: var(--esp-2);
		border-top: 1px solid var(--cor-linha);
	}

	.form-estorno,
	.form-bloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.form-estorno {
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.aviso-imutavel {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.subsecao {
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.subsecao h2,
	.subsecao h3 {
		font-size: var(--texto-lg);
	}

	.campo-select {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.grade-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--esp-3);
	}

	.check-linha {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		font-size: var(--texto-sm);
		cursor: pointer;
	}

	.carregando,
	.vazio {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.carregando p,
	.vazio p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
	}
</style>
