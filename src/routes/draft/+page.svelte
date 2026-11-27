<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import RadarAtributos from '$ui/RadarAtributos.svelte';
	import ResumoAtributos from '$lib/pessoas/ResumoAtributos.svelte';
	import EditorAtributos from '$lib/pessoas/EditorAtributos.svelte';
	import { api } from '$lib/api';
	import {
		ATRIBUTOS,
		FOCOS_DRAFT,
		ROTULO_FOCO_DRAFT,
		ROTULO_LATERALIDADE,
		atributosCompletos,
		calcularEquilibrioTimes,
		calcularMediasTime,
		formatarAltura,
		formatarMedia,
		formatarNota,
		formatarPeso,
		mediaAtributos,
		mensagemWhatsAppDraft,
		urlWhatsAppDraft,
		type AtributosPessoa,
		type ChaveAtributo,
		type EquilibrioDraft,
		type FocoDraft,
		type TimeDraftCalculado
	} from '$shared/atributos';

	type PerfilItem = {
		id: string;
		nome: string;
		estagio: string;
		grupo: { id: string; nome: string } | null;
		ehLider: boolean;
		podeEditar: boolean;
		atributos: AtributosPessoa;
	};

	type SessaoSalva = {
		id: string;
		titulo: string;
		observacao: string | null;
		foco: FocoDraft;
		times: Array<{ nome: string; membros: Array<{ personId: string; nome: string }> }>;
		criadoPor: string | null;
		criadoEm: string;
	};

	type Aba = 'perfis' | 'montar' | 'salvos';
	type Ordenacao = 'nome' | 'media' | ChaveAtributo;

	const ROTULO_ESTAGIO: Record<string, string> = {
		visitante: 'Visitante',
		recorrente: 'Recorrente',
		membro: 'Membro Eagles',
		conselheiro: 'Membro Eagles',
		lider: 'Membro Eagles'
	};

	const ehMembroAtivo = (estagio: string) =>
		estagio === 'membro' || estagio === 'conselheiro' || estagio === 'lider';

	let aba = $state<Aba>('perfis');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	let perfis = $state<PerfilItem[]>([]);
	let subgrupos = $state<Array<{ id: string; nome: string }>>([]);
	let podeAvaliar = $state(false);
	let podeSalvarDraft = $state(false);
	let podeAbrirFicha = $state(false);
	let sessoes = $state<SessaoSalva[]>([]);

	// Filtros da aba Perfis
	let busca = $state('');
	let filtroGrupo = $state('todos');
	let filtroEstagio = $state<'membros' | 'todos'>('membros');
	let ordenacao = $state<Ordenacao>('nome');
	let expandidoId = $state<string | null>(null);
	let editandoId = $state<string | null>(null);
	let compararIds = $state<string[]>([]);

	// Estado da aba Montar Draft
	let selecionadosDraft = $state<string[]>([]);
	let buscaDraft = $state('');
	let quantidadeTimes = $state(2);
	let nomesTimes = $state<string[]>(['Time 1', 'Time 2']);
	let focoDraft = $state<FocoDraft>('equilibrado');
	let sugerindo = $state(false);
	let erroDraft = $state<string | undefined>(undefined);
	let timesMontados = $state<TimeDraftCalculado[]>([]);
	let tituloDraft = $state('');
	let observacaoDraft = $state('');
	let salvandoDraft = $state(false);
	let copiadoId = $state<string | null>(null);
	let confirmandoRemocaoId = $state<string | null>(null);
	let removendoId = $state<string | null>(null);

	const perfilPorId = $derived(new Map(perfis.map((p) => [p.id, p])));

	const temMembrosAtivos = $derived(perfis.some((p) => ehMembroAtivo(p.estagio)));

	const perfisFiltrados = $derived.by(() => {
		const termo = busca
			.trim()
			.toLocaleLowerCase('pt-BR')
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '');

		const lista = perfis.filter((p) => {
			if (filtroEstagio === 'membros' && temMembrosAtivos && !ehMembroAtivo(p.estagio)) {
				return false;
			}
			if (filtroGrupo === '__sem__' && p.grupo !== null) return false;
			if (filtroGrupo !== 'todos' && filtroGrupo !== '__sem__' && p.grupo?.id !== filtroGrupo) {
				return false;
			}
			if (termo) {
				const nomeNorm = p.nome
					.toLocaleLowerCase('pt-BR')
					.normalize('NFD')
					.replace(/\p{Diacritic}/gu, '');
				const pontosNorm = (p.atributos.pontosFortes ?? '')
					.toLocaleLowerCase('pt-BR')
					.normalize('NFD')
					.replace(/\p{Diacritic}/gu, '');
				if (!nomeNorm.includes(termo) && !pontosNorm.includes(termo)) return false;
			}
			return true;
		});

		return [...lista].sort((a, b) => {
			if (ordenacao === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
			const va = ordenacao === 'media' ? a.atributos.media : a.atributos[ordenacao];
			const vb = ordenacao === 'media' ? b.atributos.media : b.atributos[ordenacao];
			if (va === null && vb === null) return a.nome.localeCompare(b.nome, 'pt-BR');
			if (va === null) return 1;
			if (vb === null) return -1;
			if (vb !== va) return vb - va;
			return a.nome.localeCompare(b.nome, 'pt-BR');
		});
	});

	const perfisParaComparar = $derived(
		compararIds.map((id) => perfilPorId.get(id)).filter((p): p is PerfilItem => Boolean(p))
	);

	const totalAvaliados = $derived(perfisFiltrados.filter((p) => p.atributos.completo).length);
	const mediaEquipe = $derived.by(() => {
		const medias = perfisFiltrados
			.map((p) => p.atributos.media)
			.filter((m): m is number => m !== null);
		if (medias.length === 0) return null;
		return Math.round((medias.reduce((a, b) => a + b, 0) / medias.length) * 10) / 10;
	});

	const candidatosDraft = $derived.by(() => {
		const termo = buscaDraft
			.trim()
			.toLocaleLowerCase('pt-BR')
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '');
		if (!termo) return perfis;
		return perfis.filter((p) =>
			p.nome
				.toLocaleLowerCase('pt-BR')
				.normalize('NFD')
				.replace(/\p{Diacritic}/gu, '')
				.includes(termo)
		);
	});

	const equilibrioAtual = $derived<EquilibrioDraft | null>(
		timesMontados.length >= 2 ? calcularEquilibrioTimes(timesMontados) : null
	);

	const textoWhatsAppAtual = $derived(
		timesMontados.length >= 2
			? mensagemWhatsAppDraft(tituloDraft, timesMontados, observacaoDraft)
			: ''
	);

	onMount(carregar);

	async function carregar() {
		carregando = true;
		erro = undefined;
		try {
			const [resPerfis, resSessoes] = await Promise.all([
				api.get('/api/draft/perfis'),
				api.get('/api/draft/sessoes')
			]);
			const dPerfis = await resPerfis.json().catch(() => ({}));
			if (!resPerfis.ok) {
				erro = dPerfis.erro ?? 'Não foi possível carregar o Draft.';
				return;
			}
			perfis = dPerfis.perfis ?? [];
			subgrupos = dPerfis.subgrupos ?? [];
			podeAvaliar = Boolean(dPerfis.podeAvaliar);
			podeSalvarDraft = Boolean(dPerfis.podeSalvarDraft);
			podeAbrirFicha = Boolean(dPerfis.podeAbrirFicha);

			if (resSessoes.ok) {
				const dSessoes = await resSessoes.json().catch(() => ({}));
				sessoes = dSessoes.sessoes ?? [];
			}

			// Pré-seleciona membros ativos na aba Montar para poupar toques.
			if (selecionadosDraft.length === 0) {
				const ativos = perfis.filter((p) => ehMembroAtivo(p.estagio)).map((p) => p.id);
				selecionadosDraft = ativos.length >= 2 ? ativos : perfis.map((p) => p.id);
			}
		} catch {
			erro = 'Sem conexão. Não foi possível carregar o Draft.';
		} finally {
			carregando = false;
		}
	}

	function alternarComparar(id: string) {
		if (compararIds.includes(id)) {
			compararIds = compararIds.filter((x) => x !== id);
			return;
		}
		if (compararIds.length >= 3) {
			mensagem = 'Você pode comparar até 3 pessoas ao mesmo tempo.';
			return;
		}
		compararIds = [...compararIds, id];
	}

	function atualizarQuantidadeTimes(novoTotal: number) {
		quantidadeTimes = Math.max(2, Math.min(8, novoTotal));
		const atual = [...nomesTimes];
		while (atual.length < quantidadeTimes) {
			atual.push(`Time ${atual.length + 1}`);
		}
		nomesTimes = atual.slice(0, quantidadeTimes);
	}

	function alternarSelecionadoDraft(id: string) {
		if (selecionadosDraft.includes(id)) {
			selecionadosDraft = selecionadosDraft.filter((x) => x !== id);
		} else {
			selecionadosDraft = [...selecionadosDraft, id];
		}
	}

	function selecionarMembrosAtivos() {
		selecionadosDraft = perfis.filter((p) => ehMembroAtivo(p.estagio)).map((p) => p.id);
	}

	function selecionarAvaliados() {
		selecionadosDraft = perfis.filter((p) => p.atributos.completo).map((p) => p.id);
	}

	function selecionarSubgrupo(grupoId: string) {
		const idsGrupo = perfis.filter((p) => p.grupo?.id === grupoId).map((p) => p.id);
		selecionadosDraft = [...new Set([...selecionadosDraft, ...idsGrupo])];
	}

	async function sugerirTimes() {
		erroDraft = undefined;
		mensagem = undefined;
		if (selecionadosDraft.length < quantidadeTimes) {
			erroDraft = `Selecione pelo menos ${quantidadeTimes} pessoas para dividir em ${quantidadeTimes} times.`;
			return;
		}

		sugerindo = true;
		try {
			const res = await api.post('/api/draft/sugerir', {
				participantesIds: selecionadosDraft,
				quantidadeTimes,
				nomesTimes: nomesTimes.map((n, i) => n.trim() || `Time ${i + 1}`),
				foco: focoDraft
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erroDraft = d.erro ?? 'Não foi possível gerar os times.';
				return;
			}
			timesMontados = d.times ?? [];
		} catch {
			erroDraft = 'Sem conexão. Não foi possível sugerir os times.';
		} finally {
			sugerindo = false;
		}
	}

	function moverPessoaDeTime(origemIdx: number, personId: string, destinoIdx: number) {
		if (origemIdx === destinoIdx) return;
		const origem = timesMontados[origemIdx];
		const destino = timesMontados[destinoIdx];
		if (!origem || !destino) return;
		const pessoa = origem.membros.find((m) => m.personId === personId);
		if (!pessoa) return;

		timesMontados = timesMontados.map((time, idx) => {
			if (idx !== origemIdx && idx !== destinoIdx) return time;
			const novosMembros =
				idx === origemIdx
					? time.membros.filter((m) => m.personId !== personId)
					: [...time.membros, pessoa].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
			return {
				...time,
				membros: novosMembros,
				totalMembros: novosMembros.length,
				medias: calcularMediasTime(novosMembros)
			};
		});
	}

	async function salvarDraftAtual() {
		erroDraft = undefined;
		mensagem = undefined;
		const titulo = tituloDraft.trim();
		if (titulo.length < 2) {
			erroDraft = 'Dê um título curto para salvar o draft (ex.: Draft Gincana de Maio).';
			return;
		}
		if (timesMontados.some((t) => t.membros.length === 0)) {
			erroDraft = 'Cada time precisa ter pelo menos 1 pessoa antes de salvar.';
			return;
		}

		salvandoDraft = true;
		try {
			const res = await api.post('/api/draft/sessoes', {
				titulo,
				observacao: observacaoDraft.trim() || null,
				foco: focoDraft,
				times: timesMontados.map((t) => ({
					nome: t.nome,
					membros: t.membros.map((m) => ({ personId: m.personId, nome: m.nome }))
				}))
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erroDraft = d.erro ?? 'Não foi possível salvar o draft.';
				return;
			}
			mensagem = 'Draft salvo no histórico da equipe.';
			const resSessoes = await api.get('/api/draft/sessoes');
			if (resSessoes.ok) {
				const dSessoes = await resSessoes.json().catch(() => ({}));
				sessoes = dSessoes.sessoes ?? [];
			}
		} catch {
			erroDraft = 'Sem conexão. O draft não foi salvo.';
		} finally {
			salvandoDraft = false;
		}
	}

	function carregarSessaoNoEditor(s: SessaoSalva) {
		tituloDraft = s.titulo;
		observacaoDraft = s.observacao ?? '';
		focoDraft = s.foco;
		quantidadeTimes = Math.max(2, Math.min(8, s.times.length));
		nomesTimes = s.times.map((t) => t.nome);
		selecionadosDraft = s.times.flatMap((t) => t.membros.map((m) => m.personId));
		timesMontados = s.times.map((t) => {
			const membros = t.membros.map((m) => {
				const atual = perfilPorId.get(m.personId);
				const a = atual?.atributos;
				const notas = {
					fisico: a?.fisico ?? null,
					biblico: a?.biblico ?? null,
					mental: a?.mental ?? null,
					coordenacaoMotora: a?.coordenacaoMotora ?? null
				};
				return {
					personId: m.personId,
					nome: atual?.nome ?? m.nome,
					...notas,
					media: mediaAtributos(notas),
					alturaCm: a?.alturaCm ?? null,
					pontosFortes: a?.pontosFortes ?? null,
					semAvaliacao: !atributosCompletos(notas)
				};
			});
			return {
				nome: t.nome,
				membros,
				totalMembros: membros.length,
				medias: calcularMediasTime(membros)
			};
		});
		aba = 'montar';
	}

	async function removerSessao(id: string) {
		removendoId = id;
		erro = undefined;
		try {
			const res = await api.delete(`/api/draft/sessoes/${id}`);
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível remover o draft.';
				return;
			}
			sessoes = sessoes.filter((s) => s.id !== id);
			confirmandoRemocaoId = null;
			mensagem = 'Draft removido.';
		} catch {
			erro = 'Sem conexão. Nada foi removido.';
		} finally {
			removendoId = null;
		}
	}

	async function copiarTexto(texto: string, chave: string) {
		try {
			await navigator.clipboard.writeText(texto);
			copiadoId = chave;
			setTimeout(() => {
				if (copiadoId === chave) copiadoId = null;
			}, 2500);
		} catch {
			mensagem = 'Não foi possível copiar automaticamente. Use o botão do WhatsApp.';
		}
	}

	function dataCurta(iso: string) {
		return new Date(iso).toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Draft · Eagles</title>
</svelte:head>

<main class="conteudo largo">
	<div class="pilha">
		<header class="topo">
			<h1>Draft e atributos</h1>
			<p class="sub">
				Perfis em 4 eixos (Físico, Bíblico, Mental e Coordenação Motora) para conhecer os pontos
				fortes da equipe e montar times equilibrados.
			</p>
		</header>

		{#if erro}<Aviso tom="erro">{erro}</Aviso>{/if}
		{#if mensagem}<Aviso tom="sucesso">{mensagem}</Aviso>{/if}

		<!-- Navegação por abas -->
		<div class="abas" role="tablist" aria-label="Seções do Draft">
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'perfis'}
				class="aba"
				class:ativa={aba === 'perfis'}
				onclick={() => (aba = 'perfis')}
			>
				Perfis ({perfis.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'montar'}
				class="aba"
				class:ativa={aba === 'montar'}
				onclick={() => (aba = 'montar')}
			>
				Montar times
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'salvos'}
				class="aba"
				class:ativa={aba === 'salvos'}
				onclick={() => (aba = 'salvos')}
			>
				Salvos ({sessoes.length})
			</button>
		</div>

		{#if carregando}
			<div class="estado">
				<Marca tamanho={44} />
				<p>Carregando perfis do Draft…</p>
			</div>
		{:else if !erro}
			{#if aba === 'perfis'}
				<!-- Indicadores rápidos -->
				<section class="indicadores" aria-label="Resumo dos perfis">
					<div class="indicador">
						<span class="rotulo">Na lista</span>
						<strong>{perfisFiltrados.length}</strong>
						<span class="detalhe">{filtroEstagio === 'membros' ? 'membros ativos' : 'pessoas'}</span
						>
					</div>
					<div class="indicador">
						<span class="rotulo">Avaliados (4 eixos)</span>
						<strong>{totalAvaliados}</strong>
						<span class="detalhe">de {perfisFiltrados.length}</span>
					</div>
					<div class="indicador">
						<span class="rotulo">Média geral</span>
						<strong>{formatarMedia(mediaEquipe)}</strong>
						<span class="detalhe">escala 0 a 10</span>
					</div>
				</section>

				<!-- Filtros -->
				<div class="filtros">
					<div class="campo-busca">
						<Campo
							id="busca-perfis"
							rotulo="Buscar por nome ou ponto forte"
							placeholder="Ex.: Ana, corrida, memória bíblica…"
							autocomplete="off"
							bind:valor={busca}
						/>
					</div>

					<div class="linha-filtros">
						<div class="campo-select">
							<label for="filtro-estagio">Mostrar</label>
							<select id="filtro-estagio" bind:value={filtroEstagio}>
								<option value="membros">Membros Eagles</option>
								<option value="todos">Todos (inclui recorrentes e visitantes)</option>
							</select>
						</div>

						{#if subgrupos.length > 0}
							<div class="campo-select">
								<label for="filtro-grupo">Subgrupo</label>
								<select id="filtro-grupo" bind:value={filtroGrupo}>
									<option value="todos">Todos os subgrupos</option>
									{#each subgrupos as g (g.id)}
										<option value={g.id}>{g.nome}</option>
									{/each}
									<option value="__sem__">Sem subgrupo</option>
								</select>
							</div>
						{/if}

						<div class="campo-select">
							<label for="ordenacao-perfis">Ordenar por</label>
							<select id="ordenacao-perfis" bind:value={ordenacao}>
								<option value="nome">Ordem alfabética</option>
								<option value="media">Média geral</option>
								{#each ATRIBUTOS as a (a.chave)}
									<option value={a.chave}>{a.rotulo}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>

				<!-- Comparador lado a lado (quando 2 ou 3 pessoas estão selecionadas) -->
				{#if perfisParaComparar.length > 0}
					<section class="comparador" aria-labelledby="titulo-comparar">
						<div class="cabecalho-bloco">
							<div>
								<h2 id="titulo-comparar">
									Comparando {perfisParaComparar.length}
									{perfisParaComparar.length === 1 ? 'pessoa' : 'pessoas'}
								</h2>
								<p class="sub">
									{#if perfisParaComparar.length === 1}
										Selecione mais 1 ou 2 pessoas abaixo para sobrepor os radares.
									{:else}
										Cada traço tem cor e padrão diferentes para leitura clara.
									{/if}
								</p>
							</div>
							<Botao variante="texto" onclick={() => (compararIds = [])}>Limpar</Botao>
						</div>

						{#if perfisParaComparar.length >= 2}
							<div class="grade-comparador">
								<RadarAtributos
									tamanho={248}
									titulo="Comparação de atributos"
									series={perfisParaComparar.map((p) => ({
										rotulo: p.nome.split(' ')[0] ?? p.nome,
										notas: p.atributos
									}))}
								/>

								<div class="tabela-wrap">
									<table class="tabela-comp">
										<thead>
											<tr>
												<th scope="col">Critério</th>
												{#each perfisParaComparar as p (p.id)}
													<th scope="col">{p.nome.split(' ')[0]}</th>
												{/each}
											</tr>
										</thead>
										<tbody>
											{#each ATRIBUTOS as a (a.chave)}
												<tr>
													<th scope="row">{a.rotulo}</th>
													{#each perfisParaComparar as p (p.id)}
														<td>{formatarNota(p.atributos[a.chave])}</td>
													{/each}
												</tr>
											{/each}
											<tr class="destaque-linha">
												<th scope="row">Média geral</th>
												{#each perfisParaComparar as p (p.id)}
													<td><strong>{formatarMedia(p.atributos.media)}</strong></td>
												{/each}
											</tr>
											<tr>
												<th scope="row">Altura</th>
												{#each perfisParaComparar as p (p.id)}
													<td>{formatarAltura(p.atributos.alturaCm) ?? '—'}</td>
												{/each}
											</tr>
											<tr>
												<th scope="row">Peso</th>
												{#each perfisParaComparar as p (p.id)}
													<td>{formatarPeso(p.atributos.pesoKg) ?? '—'}</td>
												{/each}
											</tr>
											<tr>
												<th scope="row">Dominante</th>
												{#each perfisParaComparar as p (p.id)}
													<td>
														{p.atributos.lateralidade
															? ROTULO_LATERALIDADE[p.atributos.lateralidade]
															: '—'}
													</td>
												{/each}
											</tr>
											<tr>
												<th scope="row">Camiseta</th>
												{#each perfisParaComparar as p (p.id)}
													<td>{p.atributos.tamanhoCamiseta ?? '—'}</td>
												{/each}
											</tr>
										</tbody>
									</table>
								</div>
							</div>
						{/if}
					</section>
				{/if}

				<!-- Lista de perfis -->
				{#if perfisFiltrados.length === 0}
					<div class="estado">
						<Marca tamanho={40} />
						<p>Nenhuma pessoa encontrada com esses filtros.</p>
					</div>
				{:else}
					<ul class="lista-perfis">
						{#each perfisFiltrados as p (p.id)}
							{@const expandido = expandidoId === p.id}
							{@const editando = editandoId === p.id}
							{@const comparando = compararIds.includes(p.id)}
							<li class="perfil-linha">
								<div class="perfil-topo">
									<div class="perfil-id">
										<div class="nome-linha">
											<strong>{p.nome}</strong>
											{#if p.ehLider}<span class="chip">Líder</span>{/if}
										</div>
										<span class="detalhe">
											{ROTULO_ESTAGIO[p.estagio] ?? p.estagio} · {p.grupo?.nome ?? 'Sem subgrupo'}
										</span>
									</div>

									<div class="nota-media" class:sem-nota={p.atributos.media === null}>
										<span class="rotulo-media">Média</span>
										<strong>{formatarMedia(p.atributos.media)}</strong>
									</div>
								</div>

								<!-- 4 atributos em grade compacta -->
								<div class="grade-4" aria-label={`Atributos de ${p.nome}`}>
									{#each ATRIBUTOS as a (a.chave)}
										{@const val = p.atributos[a.chave]}
										<div class="celula-attr">
											<span class="sigla">{a.sigla}</span>
											<strong>{formatarNota(val)}</strong>
											<div class="mini-trilho" aria-hidden="true">
												{#if val !== null}
													<div style={`width: ${val * 10}%`}></div>
												{/if}
											</div>
										</div>
									{/each}
								</div>

								<!-- Dados complementares resumidos -->
								{#if p.atributos.alturaCm || p.atributos.pesoKg || p.atributos.lateralidade || p.atributos.tamanhoCamiseta || p.atributos.pontosFortes}
									<div class="tags-complemento">
										{#if p.atributos.alturaCm}
											<span class="tag">{formatarAltura(p.atributos.alturaCm)}</span>
										{/if}
										{#if p.atributos.pesoKg}
											<span class="tag">{formatarPeso(p.atributos.pesoKg)}</span>
										{/if}
										{#if p.atributos.lateralidade}
											<span class="tag">{ROTULO_LATERALIDADE[p.atributos.lateralidade]}</span>
										{/if}
										{#if p.atributos.tamanhoCamiseta}
											<span class="tag">Camiseta {p.atributos.tamanhoCamiseta}</span>
										{/if}
										{#if p.atributos.pontosFortes}
											<span class="pontos-texto">{p.atributos.pontosFortes}</span>
										{/if}
									</div>
								{/if}

								<div class="acoes-card">
									<Botao
										variante="texto"
										onclick={() => {
											expandidoId = expandido ? null : p.id;
											if (editando) editandoId = null;
										}}
									>
										{expandido ? 'Ocultar perfil' : 'Ver perfil'}
									</Botao>

									<Botao
										variante={comparando ? 'secundario' : 'texto'}
										onclick={() => alternarComparar(p.id)}
									>
										{comparando ? 'Comparando ✓' : 'Comparar'}
									</Botao>

									{#if p.podeEditar}
										<Botao
											variante="secundario"
											onclick={() => {
												editandoId = editando ? null : p.id;
												if (!editando) expandidoId = null;
											}}
										>
											{editando ? 'Fechar edição' : 'Avaliar'}
										</Botao>
									{/if}

									{#if podeAbrirFicha}
										<a href={`/pessoas/${p.id}`} class="link-ficha">Ficha</a>
									{/if}
								</div>

								{#if expandido && !editando}
									<div class="painel-expandido">
										<ResumoAtributos nome={p.nome} atributos={p.atributos} compacto />
									</div>
								{/if}

								{#if editando}
									<div class="painel-expandido">
										<EditorAtributos
											pessoaId={p.id}
											pessoaNome={p.nome}
											inicial={p.atributos}
											onSalvo={(atributosAtualizados, msg) => {
												perfis = perfis.map((item) =>
													item.id === p.id ? { ...item, atributos: atributosAtualizados } : item
												);
												mensagem = `${p.nome.split(' ')[0]}: ${msg}`;
												editandoId = null;
											}}
											onCancelar={() => (editandoId = null)}
										/>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{:else if aba === 'montar'}
				{#if erroDraft}<Aviso tom="erro">{erroDraft}</Aviso>{/if}

				<section class="bloco-draft" aria-labelledby="titulo-participantes">
					<div class="cabecalho-bloco">
						<div>
							<h2 id="titulo-participantes">1. Quem entra no Draft</h2>
							<p class="sub">{selecionadosDraft.length} selecionado(s) de {perfis.length}</p>
						</div>
					</div>

					<div class="atalhos-selecao">
						<Botao variante="secundario" onclick={selecionarMembrosAtivos}>Membros ativos</Botao>
						<Botao variante="secundario" onclick={selecionarAvaliados}>Só avaliados</Botao>
						{#each subgrupos as g (g.id)}
							<Botao variante="texto" onclick={() => selecionarSubgrupo(g.id)}>+ {g.nome}</Botao>
						{/each}
						<Botao variante="texto" onclick={() => (selecionadosDraft = [])}>Limpar</Botao>
					</div>

					<Campo
						id="busca-draft"
						rotulo="Filtrar participantes"
						placeholder="Digite o nome…"
						autocomplete="off"
						bind:valor={buscaDraft}
					/>

					<div class="grade-selecao" role="group" aria-label="Participantes do Draft">
						{#each candidatosDraft as p (p.id)}
							{@const marcado = selecionadosDraft.includes(p.id)}
							<label class="item-selecao" class:marcado>
								<input
									type="checkbox"
									checked={marcado}
									onchange={() => alternarSelecionadoDraft(p.id)}
								/>
								<span class="sel-texto">
									<strong>{p.nome}</strong>
									<small>
										{p.atributos.media !== null
											? `Média ${formatarMedia(p.atributos.media)} · FIS ${formatarNota(p.atributos.fisico)} · BIB ${formatarNota(p.atributos.biblico)} · MEN ${formatarNota(p.atributos.mental)} · MOT ${formatarNota(p.atributos.coordenacaoMotora)}`
											: 'Ainda sem notas (entra com peso neutro)'}
									</small>
								</span>
							</label>
						{/each}
					</div>
				</section>

				<section class="bloco-draft" aria-labelledby="titulo-config">
					<h2 id="titulo-config">2. Configurar times</h2>

					<div class="linha-filtros">
						<div class="campo-select">
							<label for="qtd-times">Quantidade de times</label>
							<select
								id="qtd-times"
								value={quantidadeTimes}
								onchange={(e) => atualizarQuantidadeTimes(Number(e.currentTarget.value))}
							>
								{#each [2, 3, 4, 5, 6, 7, 8] as n (n)}
									<option value={n}>{n} times</option>
								{/each}
							</select>
						</div>

						<div class="campo-select">
							<label for="foco-draft">Critério de equilíbrio</label>
							<select id="foco-draft" bind:value={focoDraft}>
								{#each FOCOS_DRAFT as f (f)}
									<option value={f}>{ROTULO_FOCO_DRAFT[f]}</option>
								{/each}
							</select>
						</div>
					</div>

					<div class="nomes-times">
						{#each nomesTimes as _, idx (idx)}
							<Campo
								id={`nome-time-${idx}`}
								rotulo={`Nome do time ${idx + 1}`}
								maxlength="40"
								bind:valor={nomesTimes[idx]}
							/>
						{/each}
					</div>

					<div>
						<Botao carregando={sugerindo} onclick={sugerirTimes}>Sugerir times equilibrados</Botao>
					</div>
				</section>

				{#if timesMontados.length >= 2 && equilibrioAtual}
					<section class="bloco-draft" aria-labelledby="titulo-resultado">
						<div class="cabecalho-bloco">
							<div>
								<h2 id="titulo-resultado">3. Times sugeridos e ajuste manual</h2>
								<p class="sub">{equilibrioAtual.resumo}</p>
							</div>
							<span class={`selo-eq eq-${equilibrioAtual.nivel}`}>
								{equilibrioAtual.nivel === 'excelente'
									? 'Equilíbrio excelente'
									: equilibrioAtual.nivel === 'bom'
										? 'Bom equilíbrio'
										: 'Revisar equilíbrio'}
							</span>
						</div>

						<div class="diff-eixos" aria-label="Diferença máxima entre times por atributo">
							{#each ATRIBUTOS as a (a.chave)}
								<span>
									{a.sigla}: Δ {formatarMedia(equilibrioAtual.diferencas[a.chave])}
								</span>
							{/each}
						</div>

						<div class="grade-times">
							{#each timesMontados as time, tIdx (tIdx)}
								<article class="time-card" aria-labelledby={`time-titulo-${tIdx}`}>
									<div class="time-topo">
										<div>
											<h3 id={`time-titulo-${tIdx}`}>{time.nome}</h3>
											<span class="detalhe">
												{time.totalMembros}
												{time.totalMembros === 1 ? 'pessoa' : 'pessoas'}
												{#if time.medias.alturaCm}· altura média {formatarAltura(
														time.medias.alturaCm
													)}{/if}
											</span>
										</div>
										<div class="nota-media">
											<span class="rotulo-media">Média</span>
											<strong>{formatarMedia(time.medias.geral)}</strong>
										</div>
									</div>

									<div class="medias-time">
										{#each ATRIBUTOS as a (a.chave)}
											<span>{a.sigla} <strong>{formatarMedia(time.medias[a.chave])}</strong></span>
										{/each}
									</div>

									{#if time.membros.length === 0}
										<p class="sub">Time vazio. Mova alguém para cá.</p>
									{:else}
										<ul class="membros-time">
											{#each time.membros as m (m.personId)}
												<li>
													<div class="membro-info">
														<strong>{m.nome}</strong>
														<small>
															{m.media !== null
																? `Média ${formatarMedia(m.media)} · ${formatarNota(m.fisico)}/${formatarNota(m.biblico)}/${formatarNota(m.mental)}/${formatarNota(m.coordenacaoMotora)}`
																: 'Sem notas'}
														</small>
													</div>
													<label class="mover-select">
														<span class="visualmente-oculto">Mover {m.nome} para outro time</span>
														<select
															value={tIdx}
															onchange={(e) =>
																moverPessoaDeTime(tIdx, m.personId, Number(e.currentTarget.value))}
														>
															{#each timesMontados as dest, dIdx (dIdx)}
																<option value={dIdx}>{dest.nome}</option>
															{/each}
														</select>
													</label>
												</li>
											{/each}
										</ul>
									{/if}
								</article>
							{/each}
						</div>

						<!-- Salvar e compartilhar -->
						<div class="exportar-box">
							<h3>Compartilhar ou salvar</h3>
							<p class="sub">
								O texto do WhatsApp leva só o nome dos times e das pessoas (sem notas individuais ou
								dados pessoais).
							</p>
							<div class="linha-filtros">
								<Campo
									id="titulo-draft"
									rotulo="Título do Draft"
									maxlength="120"
									placeholder="Ex.: Draft Gincana de Maio"
									bind:valor={tituloDraft}
								/>
								<Campo
									id="obs-draft-sessao"
									rotulo="Observação (opcional)"
									maxlength="500"
									placeholder="Ex.: Provas no sábado às 15h"
									bind:valor={observacaoDraft}
								/>
							</div>

							<div class="acoes-exportar">
								<Botao href={urlWhatsAppDraft(textoWhatsAppAtual)} target="_blank" rel="noopener">
									Enviar no WhatsApp
								</Botao>
								<Botao
									variante="secundario"
									onclick={() => copiarTexto(textoWhatsAppAtual, 'atual')}
								>
									{copiadoId === 'atual' ? 'Texto copiado' : 'Copiar texto'}
								</Botao>
								{#if podeSalvarDraft}
									<Botao
										variante="secundario"
										carregando={salvandoDraft}
										onclick={salvarDraftAtual}
									>
										Salvar Draft
									</Botao>
								{/if}
							</div>
						</div>
					</section>
				{/if}
			{:else}
				<!-- Aba Salvos -->
				{#if sessoes.length === 0}
					<div class="estado">
						<Marca tamanho={44} />
						<h2>Nenhum Draft salvo ainda</h2>
						<p>
							{podeSalvarDraft
								? 'Monte os times na aba “Montar times” e salve aqui para toda a equipe consultar.'
								: 'Quando a liderança ou os conselheiros salvarem um Draft, os times aparecerão aqui.'}
						</p>
						<Botao variante="secundario" onclick={() => (aba = 'montar')}
							>Ir para Montar times</Botao
						>
					</div>
				{:else}
					<ul class="lista-salvos">
						{#each sessoes as s (s.id)}
							{@const textoZap = mensagemWhatsAppDraft(s.titulo, s.times, s.observacao)}
							<li class="salvo-card">
								<div class="cabecalho-bloco">
									<div>
										<h2>{s.titulo}</h2>
										<p class="detalhe">
											{dataCurta(s.criadoEm)} · {ROTULO_FOCO_DRAFT[s.foco] ??
												s.foco}{#if s.criadoPor}
												· por {s.criadoPor}{/if}
										</p>
									</div>
								</div>

								{#if s.observacao}
									<p class="sub">{s.observacao}</p>
								{/if}

								<div class="grade-times-salvos">
									{#each s.times as t (t.nome)}
										<div class="time-salvo">
											<strong>{t.nome} ({t.membros.length})</strong>
											<ul>
												{#each t.membros as m (m.personId)}
													<li>{m.nome}</li>
												{/each}
											</ul>
										</div>
									{/each}
								</div>

								<div class="acoes-card">
									<Botao
										href={urlWhatsAppDraft(textoZap)}
										target="_blank"
										rel="noopener"
										variante="secundario"
									>
										WhatsApp
									</Botao>
									<Botao variante="texto" onclick={() => copiarTexto(textoZap, s.id)}>
										{copiadoId === s.id ? 'Copiado' : 'Copiar'}
									</Botao>
									<Botao variante="texto" onclick={() => carregarSessaoNoEditor(s)}>
										Abrir no editor
									</Botao>
									{#if podeSalvarDraft}
										{#if confirmandoRemocaoId === s.id}
											<Botao
												variante="destrutivo"
												carregando={removendoId === s.id}
												onclick={() => removerSessao(s.id)}
											>
												Confirmar remoção
											</Botao>
											<Botao variante="texto" onclick={() => (confirmandoRemocaoId = null)}>
												Cancelar
											</Botao>
										{:else}
											<Botao variante="texto" onclick={() => (confirmandoRemocaoId = s.id)}>
												Remover
											</Botao>
										{/if}
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		{/if}
	</div>
</main>

<style>
	.topo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub {
		margin: 0;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}

	h2 {
		font-size: var(--texto-lg);
		margin: 0;
	}

	h3 {
		font-size: var(--texto-base);
		margin: 0;
	}

	.abas {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		border-bottom: 1px solid var(--cor-linha);
		padding-bottom: var(--esp-2);
	}

	.aba {
		min-height: var(--toque-min);
		padding: 0 var(--esp-4);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie);
		color: var(--cor-texto-2);
		font-family: inherit;
		font-size: var(--texto-sm);
		font-weight: 700;
		cursor: pointer;
	}

	.aba.ativa {
		border-color: var(--cor-marca);
		background: var(--cor-marca);
		color: var(--cor-sobre-marca);
	}

	.aba:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.indicadores {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
		gap: var(--esp-3);
	}

	.indicador {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.indicador .rotulo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
	}

	.indicador strong {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-2xl);
		color: var(--cor-texto);
	}

	.detalhe {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.filtros {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.linha-filtros {
		display: grid;
		gap: var(--esp-3);
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

	select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	select:focus-visible {
		border-color: var(--cor-foco);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-foco) 24%, transparent);
		outline: none;
	}

	.cabecalho-bloco {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	/* --- Comparador -------------------------------------------------------- */

	.comparador {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-marca);
		border-radius: var(--raio-lg);
	}

	.grade-comparador {
		display: grid;
		gap: var(--esp-4);
		align-items: center;
	}

	@media (min-width: 48rem) {
		.grade-comparador {
			grid-template-columns: auto 1fr;
		}
	}

	.tabela-wrap {
		overflow-x: auto;
	}

	.tabela-comp {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--texto-sm);
	}

	.tabela-comp th,
	.tabela-comp td {
		padding: var(--esp-2);
		text-align: left;
		border-bottom: 1px solid var(--cor-linha);
	}

	.tabela-comp thead th {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-weight: 700;
	}

	.tabela-comp tbody th {
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.destaque-linha {
		background: var(--cor-superficie-2);
	}

	/* --- Lista de perfis --------------------------------------------------- */

	.lista-perfis,
	.lista-salvos {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.perfil-linha,
	.salvo-card {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.perfil-topo,
	.time-topo {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--esp-3);
	}

	.perfil-id {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.nome-linha {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
	}

	.chip {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 1px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.nota-media {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.rotulo-media {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-weight: 600;
	}

	.nota-media strong {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-xl);
		color: var(--cor-marca);
		line-height: 1.1;
	}

	.nota-media.sem-nota strong {
		color: var(--cor-texto-3);
	}

	.grade-4 {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--esp-2);
	}

	.celula-attr {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: var(--esp-2);
		background: var(--cor-superficie-2);
		border-radius: var(--raio-sm);
	}

	.celula-attr .sigla {
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-texto-3);
	}

	.celula-attr strong {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-base);
		color: var(--cor-texto);
	}

	.mini-trilho {
		height: 4px;
		background: var(--cor-superficie-3);
		border-radius: var(--raio-cheio);
		overflow: hidden;
	}

	.mini-trilho div {
		height: 100%;
		background: var(--cor-marca);
	}

	.tags-complemento {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
		font-size: var(--texto-xs);
	}

	.tag {
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
		font-weight: 600;
	}

	.pontos-texto {
		color: var(--cor-texto-2);
		overflow-wrap: anywhere;
	}

	.acoes-card,
	.acoes-exportar,
	.atalhos-selecao {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
	}

	.link-ficha {
		margin-left: auto;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
		padding: 0 var(--esp-2);
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-marca);
	}

	.painel-expandido {
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	/* --- Montar Draft ------------------------------------------------------ */

	.bloco-draft {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.grade-selecao {
		display: grid;
		gap: var(--esp-2);
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		max-height: 360px;
		overflow-y: auto;
		padding: 2px;
	}

	.item-selecao {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-2);
		padding: var(--esp-2) var(--esp-3);
		min-height: var(--toque-min);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		cursor: pointer;
	}

	.item-selecao.marcado {
		border-color: var(--cor-marca);
		background: var(--cor-marca-suave);
	}

	.item-selecao input {
		width: 20px;
		height: 20px;
		margin-top: 2px;
		flex: none;
		accent-color: var(--cor-marca);
	}

	.sel-texto {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.sel-texto strong {
		font-size: var(--texto-sm);
		color: var(--cor-texto);
	}

	.sel-texto small {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.nomes-times {
		display: grid;
		gap: var(--esp-3);
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
	}

	.selo-eq {
		padding: 4px 10px;
		border-radius: var(--raio-cheio);
		font-size: var(--texto-xs);
		font-weight: 700;
		white-space: nowrap;
	}

	.eq-excelente {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border: 1px solid var(--cor-sucesso);
	}

	.eq-bom {
		background: var(--cor-superficie-2);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
	}

	.eq-atencao {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
		border: 1px solid var(--cor-aviso);
	}

	.diff-eixos {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-texto-2);
	}

	.diff-eixos span {
		padding: 2px 8px;
		border-radius: var(--raio-sm);
		background: var(--cor-superficie-2);
	}

	.grade-times {
		display: grid;
		gap: var(--esp-3);
	}

	@media (min-width: 48rem) {
		.grade-times {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.time-card {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.medias-time {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2) var(--esp-3);
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie-2);
		border-radius: var(--raio-sm);
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.medias-time strong {
		color: var(--cor-texto);
	}

	.membros-time {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.membros-time li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-2);
		padding-top: var(--esp-2);
		border-top: 1px solid var(--cor-linha);
	}

	.membros-time li:first-child {
		padding-top: 0;
		border-top: 0;
	}

	.membro-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.membro-info strong {
		font-size: var(--texto-sm);
	}

	.membro-info small {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.mover-select select {
		min-height: var(--toque-min);
		max-width: 140px;
		font-size: 14px;
		padding: 0 var(--esp-2);
	}

	.exportar-box {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.grade-times-salvos {
		display: grid;
		gap: var(--esp-3);
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	}

	.time-salvo {
		padding: var(--esp-3);
		background: var(--cor-superficie-2);
		border-radius: var(--raio-sm);
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		font-size: var(--texto-sm);
	}

	.time-salvo ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--cor-texto-2);
	}

	.estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.estado p {
		margin: 0;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		max-width: 40ch;
	}

	.visualmente-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
