<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Aba = 'minhas' | 'escala' | 'tipos';

	let aba = $state<Aba>('minhas');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	let podeGerenciar = $state(false);
	let minhasEscalas = $state<any[]>([]);
	let tipos = $state<any[]>([]);
	let eventos = $state<any[]>([]);
	let pessoas = $state<any[]>([]);
	let eventoSelecionadoId = $state('');
	let escalaEvento = $state<any[]>([]);

	// Formulário: novo tipo de responsabilidade (RN-16 / RF-07.6)
	let novoTipoNome = $state('');
	let novoTipoDescricao = $state('');
	let novoTipoIntervalo = $state('14');
	let salvandoTipo = $state(false);

	// Formulário: atribuição manual (RN-17 / RF-07.2)
	let respSelecionadaId = $state('');
	let pessoaSelecionadaId = $state('');
	let obsEscala = $state('');
	let salvandoEscala = $state(false);

	// Geração e confirmação de proposta (RN-18 / RF-07.4)
	let gerandoProposta = $state(false);
	let confirmandoProposta = $state(false);

	type SugestaoSubstituto = {
		personId: string;
		nome: string;
		respeitaIntervalo: boolean;
		rsvp: 'confirmado' | 'talvez' | 'nao_vou' | null;
		carga90Dias: number;
		frequencia90d: number;
		justificativa: string;
	};

	// Troca de responsável (RF-07.5)
	let trocandoId = $state<string | null>(null);
	let substitutoId = $state('');
	let motivoTroca = $state('');
	let salvandoTroca = $state(false);
	let substitutosSugeridos = $state<SugestaoSubstituto[]>([]);
	let carregandoSubstitutos = $state(false);

	const STATUS_ROTULO: Record<string, string> = {
		proposta: 'Proposta (pendente)',
		confirmada: 'Confirmada',
		trocada: 'Trocada',
		cumprida: 'Cumprida'
	};

	const propostasPendentes = $derived(escalaEvento.filter((item) => item.status === 'proposta'));

	const escalaAtiva = $derived(escalaEvento.filter((item) => item.status !== 'trocada'));

	const eventoAtual = $derived(eventos.find((e) => e.id === eventoSelecionadoId) ?? null);

	onMount(async () => {
		const eventoParam = page.url.searchParams.get('eventoId');
		if (eventoParam) {
			eventoSelecionadoId = eventoParam;
			aba = 'escala';
		}
		await carregarTudo();
	});

	async function carregarTudo() {
		carregando = true;
		erro = undefined;
		try {
			const [resMinhas, resTipos, resEventos] = await Promise.all([
				api.get('/api/escalas/minhas'),
				api.get('/api/responsabilidades'),
				api.get('/api/eventos')
			]);

			if (resMinhas.ok) {
				const d = await resMinhas.json();
				minhasEscalas = d.escalas ?? [];
			}

			if (resTipos.ok) {
				const d = await resTipos.json();
				tipos = d.responsabilidades ?? [];
				podeGerenciar = Boolean(d.podeGerenciar);
				if (!respSelecionadaId && tipos.length > 0) {
					respSelecionadaId = tipos[0].id;
				}
			}

			if (resEventos.ok) {
				const d = await resEventos.json();
				eventos = d.eventos ?? [];
				if (!eventoSelecionadoId && eventos.length > 0) {
					eventoSelecionadoId = eventos[0].id;
				}
			}

			if (podeGerenciar) {
				const resPessoas = await api.get('/api/pessoas');
				if (resPessoas.ok) {
					const d = await resPessoas.json();
					pessoas = d.pessoas ?? [];
					if (!pessoaSelecionadaId && pessoas.length > 0) {
						pessoaSelecionadaId = pessoas[0].id;
					}
				}
			}

			if (eventoSelecionadoId) {
				await carregarEscalaDoEvento(eventoSelecionadoId);
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Tente novamente quando a conexão voltar.'
					: 'Não foi possível carregar responsabilidades e escalas.';
		} finally {
			carregando = false;
		}
	}

	async function carregarEscalaDoEvento(eventoId: string) {
		if (!eventoId) {
			escalaEvento = [];
			return;
		}
		try {
			const res = await api.get(`/api/escalas?eventoId=${encodeURIComponent(eventoId)}`);
			if (res.ok) {
				const d = await res.json();
				escalaEvento = d.escalas ?? [];
			}
		} catch {
			erro = 'Erro ao carregar a escala deste encontro.';
		}
	}

	async function criarTipo() {
		if (!novoTipoNome.trim()) return;
		salvandoTipo = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const intervalo = Math.max(0, Number.parseInt(novoTipoIntervalo, 10) || 0);
			const res = await api.post('/api/responsabilidades', {
				nome: novoTipoNome.trim(),
				descricao: novoTipoDescricao.trim() || undefined,
				intervaloMinimoDias: intervalo
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Responsabilidade criada.';
				novoTipoNome = '';
				novoTipoDescricao = '';
				novoTipoIntervalo = '14';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível criar a responsabilidade.';
			}
		} catch {
			erro = 'Erro ao salvar responsabilidade.';
		} finally {
			salvandoTipo = false;
		}
	}

	async function desativarTipo(id: string) {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.delete(`/api/responsabilidades/${id}`);
			if (res.ok) {
				mensagem = 'Responsabilidade desativada.';
				await carregarTudo();
			} else {
				const d = await res.json().catch(() => ({}));
				erro = d.erro ?? 'Não foi possível desativar.';
			}
		} catch {
			erro = 'Erro ao desativar responsabilidade.';
		}
	}

	async function atribuirManual() {
		if (!eventoSelecionadoId || !respSelecionadaId || !pessoaSelecionadaId) {
			erro = 'Selecione evento, responsabilidade e pessoa.';
			return;
		}
		salvandoEscala = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/escalas', {
				eventoId: eventoSelecionadoId,
				responsabilidadeId: respSelecionadaId,
				personId: pessoaSelecionadaId,
				observacoes: obsEscala.trim() || undefined
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Pessoa atribuída à escala.';
				obsEscala = '';
				await carregarEscalaDoEvento(eventoSelecionadoId);
			} else {
				erro = d.erro ?? 'Não foi possível atribuir na escala.';
			}
		} catch {
			erro = 'Erro ao salvar escala.';
		} finally {
			salvandoEscala = false;
		}
	}

	async function gerarProposta() {
		if (!eventoSelecionadoId) return;
		gerandoProposta = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/escalas/gerar', {
				eventoId: eventoSelecionadoId
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Proposta gerada para revisão.';
				await carregarEscalaDoEvento(eventoSelecionadoId);
			} else {
				erro = d.erro ?? 'Não foi possível gerar proposta de escala.';
			}
		} catch {
			erro = 'Erro ao gerar proposta de escala.';
		} finally {
			gerandoProposta = false;
		}
	}

	async function decidirProposta(propostaId: string, descartarTodos: boolean) {
		confirmandoProposta = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/escalas/confirmar', {
				propostaId,
				descartarTodos
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? (descartarTodos ? 'Proposta descartada.' : 'Proposta confirmada.');
				await carregarEscalaDoEvento(eventoSelecionadoId);
			} else {
				erro = d.erro ?? 'Não foi possível atualizar a proposta.';
			}
		} catch {
			erro = 'Erro ao confirmar proposta.';
		} finally {
			confirmandoProposta = false;
		}
	}

	async function atualizarItemEscala(id: string, acao: 'confirmar' | 'cumprida') {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.patch(`/api/escalas/${id}`, { acao });
			if (res.ok) {
				mensagem = acao === 'confirmar' ? 'Atribuição confirmada.' : 'Marcada como cumprida.';
				await carregarEscalaDoEvento(eventoSelecionadoId);
			} else {
				const d = await res.json().catch(() => ({}));
				erro = d.erro ?? 'Não foi possível atualizar.';
			}
		} catch {
			erro = 'Erro ao atualizar escala.';
		}
	}

	async function abrirTroca(item: any) {
		if (trocandoId === item.id) {
			trocandoId = null;
			substitutosSugeridos = [];
			carregandoSubstitutos = false;
			return;
		}
		trocandoId = item.id;
		substitutoId = pessoas.find((p) => p.id !== item.personId)?.id ?? '';
		motivoTroca = '';
		substitutosSugeridos = [];
		carregandoSubstitutos = true;
		try {
			const res = await api.get(`/api/escalas/${item.id}/substitutos`);
			if (res.ok && trocandoId === item.id) {
				const d = await res.json();
				substitutosSugeridos = d.substitutos ?? [];
				if (substitutosSugeridos.length > 0) {
					substitutoId = substitutosSugeridos[0]!.personId;
				}
			}
		} catch {
			// Mantém seleção manual no campo caso a sugestão falhe
		} finally {
			if (trocandoId === item.id) {
				carregandoSubstitutos = false;
			}
		}
	}

	async function confirmarTroca(id: string) {
		if (!substitutoId) {
			erro = 'Escolha quem vai assumir a responsabilidade.';
			return;
		}
		salvandoTroca = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.patch(`/api/escalas/${id}`, {
				acao: 'trocar',
				novoPersonId: substitutoId,
				motivo: motivoTroca.trim() || undefined
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Troca registrada com histórico preservado.';
				trocandoId = null;
				substitutoId = '';
				motivoTroca = '';
				substitutosSugeridos = [];
				await carregarEscalaDoEvento(eventoSelecionadoId);
			} else {
				erro = d.erro ?? 'Não foi possível registrar a troca.';
			}
		} catch {
			erro = 'Erro ao registrar troca.';
		} finally {
			salvandoTroca = false;
		}
	}

	async function removerItemEscala(id: string) {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.delete(`/api/escalas/${id}`);
			if (res.ok) {
				mensagem = 'Atribuição removida.';
				await carregarEscalaDoEvento(eventoSelecionadoId);
			} else {
				const d = await res.json().catch(() => ({}));
				erro = d.erro ?? 'Não foi possível remover.';
			}
		} catch {
			erro = 'Erro ao remover atribuição.';
		}
	}

	function compartilharEscalaWhatsapp() {
		if (!eventoAtual || escalaAtiva.length === 0) return;
		const linhas = [
			`*Escala — ${eventoAtual.title}*`,
			`Data: ${formatarData(eventoAtual.startsAt)}`,
			eventoAtual.location ? `Local: ${eventoAtual.location}` : null,
			'',
			...escalaAtiva.map(
				(e) =>
					`• ${e.responsabilidadeNome}: ${e.pessoaNome}${e.status === 'proposta' ? ' (proposta)' : ''}`
			)
		].filter((l) => l !== null);

		window.open(
			`https://wa.me/?text=${encodeURIComponent(linhas.join('\n'))}`,
			'_blank',
			'noopener,noreferrer'
		);
	}

	function formatarData(data: string | null) {
		if (!data) return 'Data não definida';
		return new Date(data).toLocaleDateString('pt-BR', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Responsabilidades e escalas · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<header>
			<h1>Responsabilidades</h1>
			<p class="sub">
				Acompanhe suas escalas, organize funções de cada encontro e revise sugestões antes de
				confirmar.
			</p>
		</header>

		<div class="abas" role="tablist" aria-label="Seções de responsabilidades">
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'minhas'}
				class="aba"
				class:ativa={aba === 'minhas'}
				onclick={() => (aba = 'minhas')}
			>
				Minhas ({minhasEscalas.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'escala'}
				class="aba"
				class:ativa={aba === 'escala'}
				onclick={() => (aba = 'escala')}
			>
				Escala por encontro
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'tipos'}
				class="aba"
				class:ativa={aba === 'tipos'}
				onclick={() => (aba = 'tipos')}
			>
				Tipos ({tipos.length})
			</button>
		</div>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando responsabilidades…</p>
			</div>
		{:else if aba === 'minhas'}
			<section class="painel" aria-label="Minhas responsabilidades">
				{#if minhasEscalas.length === 0}
					<div class="vazio">
						<Marca tamanho={40} />
						<h2>Nenhuma responsabilidade atribuída</h2>
						<p>Quando você for escalado para um encontro, suas funções aparecem aqui.</p>
					</div>
				{:else}
					<ul class="lista">
						{#each minhasEscalas as item (item.id)}
							<li class="item">
								<div class="item-info">
									<strong>{item.responsabilidadeNome}</strong>
									<a href={`/eventos/${item.eventId}`} class="link-evento">
										{item.eventoTitulo}
									</a>
									<span class="meta">
										{formatarData(item.eventoInicio)}
										{#if item.eventoLocal}
											· {item.eventoLocal}{/if}
									</span>
									{#if item.observacoes}
										<span class="meta">{item.observacoes}</span>
									{/if}
								</div>
								<span class="chip chip-{item.status}">
									{STATUS_ROTULO[item.status] ?? item.status}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{:else if aba === 'escala'}
			<section class="painel" aria-label="Escala por encontro">
				{#if eventos.length === 0}
					<div class="vazio">
						<h2>Nenhum encontro cadastrado</h2>
						<p>Crie um encontro primeiro para montar a escala de responsabilidades.</p>
					</div>
				{:else}
					<div class="campo-select">
						<label for="seletor-evento">Encontro</label>
						<select
							id="seletor-evento"
							bind:value={eventoSelecionadoId}
							onchange={() => carregarEscalaDoEvento(eventoSelecionadoId)}
						>
							{#each eventos as ev (ev.id)}
								<option value={ev.id}>
									{ev.title} — {formatarData(ev.startsAt)}
								</option>
							{/each}
						</select>
					</div>

					{#if podeGerenciar}
						<div class="acoes-linha">
							<Botao variante="secundario" carregando={gerandoProposta} onclick={gerarProposta}>
								Gerar sugestão de escala
							</Botao>
							{#if escalaAtiva.length > 0}
								<Botao variante="texto" onclick={compartilharEscalaWhatsapp}>
									Enviar no WhatsApp
								</Botao>
							{/if}
						</div>
					{:else if escalaAtiva.length > 0}
						<div class="acoes-linha">
							<Botao variante="secundario" onclick={compartilharEscalaWhatsapp}>
								Compartilhar escala no WhatsApp
							</Botao>
						</div>
					{/if}

					{#if propostasPendentes.length > 0 && podeGerenciar}
						{@const propostaId = propostasPendentes[0]?.propostaId}
						<div class="caixa-revisao" role="region" aria-label="Revisão de proposta de escala">
							<strong>Proposta aguardando revisão ({propostasPendentes.length})</strong>
							<p>
								Escalas geradas nunca viram oficiais sozinhas. Revise os nomes abaixo e confirme ou
								descarte.
							</p>
							{#if propostaId}
								<div class="acoes-linha">
									<Botao
										carregando={confirmandoProposta}
										onclick={() => decidirProposta(propostaId, false)}
									>
										Confirmar proposta
									</Botao>
									<Botao
										variante="destrutivo"
										desabilitado={confirmandoProposta}
										onclick={() => decidirProposta(propostaId, true)}
									>
										Descartar proposta
									</Botao>
								</div>
							{/if}
						</div>
					{/if}

					{#if escalaAtiva.length === 0}
						<p class="texto-vazio">Nenhuma responsabilidade definida ainda para este encontro.</p>
					{:else}
						<ul class="lista">
							{#each escalaAtiva as item (item.id)}
								<li class="item item-vertical">
									<div class="item-topo">
										<div class="item-info">
											<strong>{item.responsabilidadeNome}</strong>
											<span class="pessoa">{item.pessoaNome}</span>
											{#if item.observacoes}
												<span class="meta">{item.observacoes}</span>
											{/if}
										</div>
										<span class="chip chip-{item.status}">
											{STATUS_ROTULO[item.status] ?? item.status}
										</span>
									</div>

									{#if podeGerenciar}
										<div class="acoes-item">
											{#if item.status === 'proposta'}
												<Botao
													variante="texto"
													onclick={() => atualizarItemEscala(item.id, 'confirmar')}
												>
													Confirmar
												</Botao>
											{/if}
											{#if item.status === 'confirmada'}
												<Botao
													variante="texto"
													onclick={() => atualizarItemEscala(item.id, 'cumprida')}
												>
													Marcar cumprida
												</Botao>
											{/if}
											<Botao variante="texto" onclick={() => abrirTroca(item)}>Trocar</Botao>
											<Botao variante="destrutivo" onclick={() => removerItemEscala(item.id)}>
												Remover
											</Botao>
										</div>

										{#if trocandoId === item.id}
											<form
												class="form-troca"
												onsubmit={(e) => {
													e.preventDefault();
													confirmarTroca(item.id);
												}}
											>
												<div class="sugestoes-substituto" aria-live="polite">
													<span class="sugestoes-titulo">Substitutos sugeridos</span>
													{#if carregandoSubstitutos}
														<span class="meta">Calculando melhores opções…</span>
													{:else if substitutosSugeridos.length === 0}
														<span class="meta">Nenhuma sugestão disponível para este encontro.</span
														>
													{:else}
														<div class="lista-sugestoes" role="list">
															{#each substitutosSugeridos as sug (sug.personId)}
																<button
																	type="button"
																	class="sugestao-btn"
																	class:selecionada={substitutoId === sug.personId}
																	aria-pressed={substitutoId === sug.personId}
																	onclick={() => (substitutoId = sug.personId)}
																>
																	<span class="sugestao-topo">
																		<strong>{sug.nome}</strong>
																		{#if sug.rsvp === 'confirmado'}
																			<span class="chip chip-confirmada">Confirmado</span>
																		{:else if sug.rsvp === 'talvez'}
																			<span class="chip chip-proposta">Talvez</span>
																		{/if}
																	</span>
																	<span class="meta">{sug.justificativa}</span>
																</button>
															{/each}
														</div>
													{/if}
												</div>

												<div class="campo-select">
													<label for={`sub-${item.id}`}>Substituir por</label>
													<select id={`sub-${item.id}`} bind:value={substitutoId}>
														{#each substitutosSugeridos.filter((s) => !pessoas.some((p) => p.id === s.personId)) as s (s.personId)}
															<option value={s.personId}>{s.nome}</option>
														{/each}
														{#each pessoas.filter((p) => p.id !== item.personId) as p (p.id)}
															<option value={p.id}>{p.nome}</option>
														{/each}
													</select>
												</div>
												<Campo
													id={`motivo-${item.id}`}
													rotulo="Motivo (opcional)"
													bind:valor={motivoTroca}
												/>
												<div class="acoes-linha">
													<Botao tipo="submit" carregando={salvandoTroca}>Salvar troca</Botao>
													<Botao
														variante="texto"
														onclick={() => {
															trocandoId = null;
															substitutosSugeridos = [];
														}}
													>
														Cancelar
													</Botao>
												</div>
											</form>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if podeGerenciar && tipos.length > 0 && pessoas.length > 0}
						<section class="subsecao">
							<h2>Atribuir manualmente</h2>
							<form
								class="form-bloco"
								onsubmit={(e) => {
									e.preventDefault();
									atribuirManual();
								}}
							>
								<div class="campo-select">
									<label for="resp-manual">Responsabilidade</label>
									<select id="resp-manual" bind:value={respSelecionadaId}>
										{#each tipos as t (t.id)}
											<option value={t.id}>{t.nome}</option>
										{/each}
									</select>
								</div>

								<div class="campo-select">
									<label for="pessoa-manual">Pessoa</label>
									<select id="pessoa-manual" bind:value={pessoaSelecionadaId}>
										{#each pessoas as p (p.id)}
											<option value={p.id}>{p.nome}</option>
										{/each}
									</select>
								</div>

								<Campo id="obs-escala" rotulo="Observação (opcional)" bind:valor={obsEscala} />

								<Botao tipo="submit" largura="cheia" carregando={salvandoEscala}>
									Adicionar à escala
								</Botao>
							</form>
						</section>
					{/if}
				{/if}
			</section>
		{:else}
			<section class="painel" aria-label="Tipos de responsabilidade">
				{#if tipos.length === 0}
					<div class="vazio">
						<h2>Nenhum tipo cadastrado</h2>
						<p>Cadastre funções como Mensagem, Música, Lanche, Organização ou Recepção.</p>
					</div>
				{:else}
					<ul class="lista">
						{#each tipos as t (t.id)}
							<li class="item">
								<div class="item-info">
									<strong>{t.nome}</strong>
									{#if t.descricao}
										<span class="meta">{t.descricao}</span>
									{/if}
									<span class="meta">
										Intervalo mínimo: {t.intervaloMinimoDias}
										{t.intervaloMinimoDias === 1 ? 'dia' : 'dias'}
									</span>
								</div>
								{#if podeGerenciar}
									<Botao variante="destrutivo" onclick={() => desativarTipo(t.id)}>Desativar</Botao>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if podeGerenciar}
					<section class="subsecao">
						<h2>Novo tipo de responsabilidade</h2>
						<form
							class="form-bloco"
							onsubmit={(e) => {
								e.preventDefault();
								criarTipo();
							}}
						>
							<Campo id="novo-tipo-nome" rotulo="Nome" bind:valor={novoTipoNome} obrigatorio />
							<Campo
								id="novo-tipo-desc"
								rotulo="Descrição (opcional)"
								bind:valor={novoTipoDescricao}
							/>
							<Campo
								id="novo-tipo-intervalo"
								rotulo="Intervalo mínimo entre repetições (dias)"
								ajuda="Usado pela geração de escala para evitar sobrecarga."
								inputmode="numeric"
								bind:valor={novoTipoIntervalo}
							/>
							<Botao tipo="submit" largura="cheia" carregando={salvandoTipo}>
								Criar responsabilidade
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

	.painel {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
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

	.campo-select select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
	}

	.acoes-linha {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.caixa-revisao {
		padding: var(--esp-4);
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
		border: 1px solid var(--cor-aviso);
		border-radius: var(--raio);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.caixa-revisao p {
		font-size: var(--texto-sm);
		color: var(--cor-texto);
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
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.item-vertical {
		flex-direction: column;
		align-items: stretch;
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
		gap: 2px;
		min-width: 0;
	}

	.link-evento {
		font-size: var(--texto-sm);
		font-weight: 600;
	}

	.pessoa {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto);
	}

	.meta {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.acoes-item {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1);
		padding-top: var(--esp-2);
		border-top: 1px solid var(--cor-linha);
	}

	.form-troca {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.sugestoes-substituto {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.sugestoes-titulo {
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-texto-2);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.lista-sugestoes {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.sugestao-btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		width: 100%;
		text-align: left;
		padding: var(--esp-2) var(--esp-3);
		min-height: var(--toque-min);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio-sm);
		color: var(--cor-texto);
		cursor: pointer;
	}

	.sugestao-btn.selecionada {
		background: var(--cor-marca-suave);
		border-color: var(--cor-marca);
	}

	.sugestao-topo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-2);
		width: 100%;
		font-size: var(--texto-sm);
	}

	.chip {
		flex: none;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.chip-proposta {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.chip-confirmada,
	.chip-cumprida {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.subsecao {
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.subsecao h2 {
		font-size: var(--texto-lg);
	}

	.form-bloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.texto-vazio {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
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
