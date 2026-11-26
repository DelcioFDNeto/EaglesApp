<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	let evento = $state<any>(null);
	let inscricoes: any[] = $state([]);
	let presencas: any[] = $state([]);
	let inscritosSemPresenca: any[] = $state([]);
	let escalas: any[] = $state([]);
	let resumoPresenca = $state<any>(null);
	let permissoesEvento = $state({
		podeGerenciarEvento: false,
		podeRegistrarPresenca: false,
		podeVerRelatorio: false,
		podeGerenciarEscala: false
	});

	let carregando = $state(true);
	let salvandoRsvp = $state(false);
	let salvandoPresencaId = $state<string | null>(null);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);
	let minhaInscricao = $state<any>(null);
	let editandoRsvp = $state(false);
	let selecionandoOpcao = $state('');
	let qtdConvidados = $state(0);
	let notasInscricao = $state('');

	// Cancelar / reativar (só quem gerencia o evento vê os botões; o servidor confere).
	let confirmandoCancelamento = $state(false);
	let motivoCancelamento = $state('');
	let mudandoStatus = $state(false);

	const STATUS_EVENTO: Record<string, string> = {
		scheduled: 'Agendado',
		ongoing: 'Em andamento',
		completed: 'Concluído',
		cancelled: 'Cancelado'
	};

	const STATUS_PRESENCA: Record<string, string> = {
		present: 'Presente',
		absent: 'Ausente',
		late: 'Atrasado'
	};

	const METODO_PRESENCA: Record<string, string> = {
		manual: 'Manual',
		qr_code: 'QR Code',
		self: 'Pelo app'
	};

	const STATUS_ESCALA: Record<string, string> = {
		proposta: 'Proposta',
		confirmada: 'Confirmada',
		trocada: 'Trocada',
		cumprida: 'Cumprida'
	};

	async function carregarEvento() {
		const eventoId = page.params.id ?? '';
		if (!eventoId) {
			erro = 'Evento não identificado.';
			carregando = false;
			return;
		}

		carregando = true;
		erro = undefined;
		try {
			const res = await api.get(`/api/eventos/${eventoId}`);
			if (res.ok) {
				const data = await res.json();
				evento = data.evento;
				inscricoes = data.inscricoes ?? [];
				minhaInscricao = data.minhaInscricao ?? null;
				if (data.permissoesEvento) {
					permissoesEvento = data.permissoesEvento;
				}
				if (minhaInscricao) {
					selecionandoOpcao = minhaInscricao.option ?? '';
					qtdConvidados = minhaInscricao.guests ?? 0;
					notasInscricao = minhaInscricao.notes ?? '';
				}
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível carregar o evento.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os dados do evento podem estar desatualizados.'
					: 'Erro ao carregar o evento.';
		}

		const [resPresencas, resEscalas] = await Promise.allSettled([
			api.get(`/api/eventos/${eventoId}/presenca`),
			api.get(`/api/escalas?eventoId=${encodeURIComponent(eventoId)}`)
		]);

		if (resPresencas.status === 'fulfilled' && resPresencas.value.ok) {
			const dataPresencas = await resPresencas.value.json();
			presencas = dataPresencas.presencas ?? [];
			inscritosSemPresenca = dataPresencas.inscritosSemPresenca ?? [];
			resumoPresenca = dataPresencas.resumo ?? null;
		}

		if (resEscalas.status === 'fulfilled' && resEscalas.value.ok) {
			const dataEscalas = await resEscalas.value.json();
			escalas = (dataEscalas.escalas ?? []).filter((e: any) => e.status !== 'trocada');
		}

		carregando = false;
	}

	onMount(() => {
		carregarEvento();
	});

	async function fazerInscricao() {
		if (!selecionandoOpcao) {
			erro = 'Selecione uma opção de participação.';
			return;
		}
		salvandoRsvp = true;
		erro = undefined;
		mensagem = undefined;

		try {
			const res = await api.post(`/api/eventos/${evento?.id}/inscricoes`, {
				option: selecionandoOpcao,
				guests: selecionandoOpcao === 'convidado' ? qtdConvidados : 0,
				notes: notasInscricao.trim() || undefined
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Participação registrada com sucesso.';
				editandoRsvp = false;
				await carregarEvento();
			} else {
				erro = data.erro ?? 'Não foi possível registrar sua participação.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Tente novamente quando houver conexão.'
					: 'Erro ao registrar participação.';
		} finally {
			salvandoRsvp = false;
		}
	}

	async function registrarPresenca(personId: string, status: 'present' | 'late' | 'absent') {
		if (!evento?.id) return;
		salvandoPresencaId = personId;
		erro = undefined;
		try {
			const res = await api.post(`/api/eventos/${evento.id}/presenca`, {
				personId,
				status,
				registrationMethod: 'manual'
			});
			if (res.ok) {
				await carregarEvento();
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível registrar presença.';
			}
		} catch {
			erro = 'Erro ao registrar presença.';
		} finally {
			salvandoPresencaId = null;
		}
	}

	async function mudarStatus(status: 'cancelled' | 'scheduled') {
		if (!evento?.id) return;
		mudandoStatus = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.patch(`/api/eventos/${evento.id}`, {
				status,
				...(status === 'cancelled' && { motivoCancelamento: motivoCancelamento.trim() || null })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = data.mensagem;
				confirmandoCancelamento = false;
				motivoCancelamento = '';
				await carregarEvento();
			} else {
				erro = data.erro ?? 'Não foi possível mudar o evento.';
			}
		} catch {
			erro = 'Sem conexão. Nada foi alterado; tente de novo.';
		} finally {
			mudandoStatus = false;
		}
	}

	function compartilharWhatsapp() {
		if (!evento) return;
		const linhas = [
			`*${evento.title}*`,
			`Data: ${formatarData(evento.startsAt)}`,
			evento.location ? `Local: ${evento.location}` : null,
			escalas.length > 0
				? `\n*Escala:*\n${escalas.map((e) => `• ${e.responsabilidadeNome}: ${e.pessoaNome}`).join('\n')}`
				: null,
			`\nConfirme presença no Eagles App: ${window.location.href}`
		].filter(Boolean);

		const texto = encodeURIComponent(linhas.join('\n'));
		window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener,noreferrer');
	}

	function formatarData(data: string | null) {
		if (!data) return 'Data não definida';
		return new Date(data).toLocaleDateString('pt-BR', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function rotuloOpcao(key: string) {
		const achada = (evento?.rsvpOptions ?? []).find((o: any) => o.key === key);
		return achada?.label ?? key;
	}
</script>

<svelte:head>
	<title>{evento?.title || 'Evento'} · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/eventos" class="voltar">← Eventos</a>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando && !evento}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando evento…</p>
			</div>
		{:else if evento}
			<header class="cabecalho-evento">
				<div class="badges">
					{#if evento.eventType}
						<span class="tipo" style="--cor: {evento.eventType.color ?? '#A91825'}">
							{evento.eventType.name}
						</span>
					{/if}
					<span class="status status-{evento.status}">
						{STATUS_EVENTO[evento.status] ?? evento.status}
					</span>
				</div>

				<h1>{evento.title}</h1>
				{#if evento.description}<p class="sub">{evento.description}</p>{/if}

				<div class="metas">
					<p class="meta">
						<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
							<rect
								x="2"
								y="3"
								width="12"
								height="11"
								rx="1.5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.3"
							/>
							<path
								d="M5 1.5v3M11 1.5v3M2 6.5h12"
								fill="none"
								stroke="currentColor"
								stroke-width="1.3"
								stroke-linecap="round"
							/>
						</svg>
						{formatarData(evento.startsAt)}
						{#if evento.endsAt}
							— {formatarData(evento.endsAt)}{/if}
					</p>
					{#if evento.location}
						<p class="meta">
							<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
								<path
									d="M8 14s4.5-4.1 4.5-7.5a4.5 4.5 0 1 0-9 0C3.5 9.9 8 14 8 14z"
									fill="none"
									stroke="currentColor"
									stroke-width="1.3"
								/>
								<circle
									cx="8"
									cy="6.5"
									r="1.4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.3"
								/>
							</svg>
							{evento.location}
						</p>
					{/if}
				</div>

				{#if evento.responsavelNome}
					<p class="meta">Responsável: {evento.responsavelNome}</p>
				{/if}

				{#if evento.cancelamento}
					<Aviso tom="aviso" titulo="Evento cancelado">
						{#if evento.cancelamento.motivo}{evento.cancelamento.motivo}.{/if}
						{#if evento.cancelamento.por}
							Cancelado por {evento.cancelamento.por} em
							{formatarData(evento.cancelamento.em)}.
						{/if}
						As respostas de presença continuam guardadas.
					</Aviso>
				{/if}

				<div class="acoes-topo">
					{#if evento.status !== 'cancelled'}
						<Botao variante="secundario" onclick={compartilharWhatsapp}>
							Compartilhar no WhatsApp
						</Botao>
					{/if}
					{#if permissoesEvento.podeGerenciarEvento}
						<Botao variante="secundario" href={`/eventos/${evento.id}/editar`}>Editar</Botao>
						{#if evento.status === 'cancelled'}
							<Botao
								variante="secundario"
								carregando={mudandoStatus}
								onclick={() => mudarStatus('scheduled')}
							>
								Reativar evento
							</Botao>
						{:else if !confirmandoCancelamento}
							<Botao variante="texto" onclick={() => (confirmandoCancelamento = true)}>
								Cancelar evento
							</Botao>
						{/if}
					{/if}
				</div>

				{#if confirmandoCancelamento && evento.status !== 'cancelled'}
					<div class="confirmar-cancelamento" role="group" aria-labelledby="titulo-cancelar">
						<h2 id="titulo-cancelar">Cancelar este evento?</h2>
						<p class="sub">
							Ninguém mais poderá responder. As respostas que já existem ficam guardadas, e você
							pode reativar o evento depois.
						</p>
						<label for="motivo-cancelamento">Motivo (opcional, aparece para todos)</label>
						<textarea
							id="motivo-cancelamento"
							bind:value={motivoCancelamento}
							rows="2"
							maxlength="500"
							placeholder="Ex.: chuva forte, mudamos para a semana que vem"
						></textarea>
						<div class="acoes-rsvp">
							<Botao
								variante="destrutivo"
								largura="cheia"
								carregando={mudandoStatus}
								onclick={() => mudarStatus('cancelled')}
							>
								Cancelar evento
							</Botao>
							<Botao
								variante="texto"
								largura="cheia"
								desabilitado={mudandoStatus}
								onclick={() => (confirmandoCancelamento = false)}
							>
								Manter evento
							</Botao>
						</div>
					</div>
				{/if}
			</header>

			{#if evento.rsvpEnabled && evento.status !== 'cancelled'}
				<section class="bloco-rsvp">
					{#if minhaInscricao && !editandoRsvp}
						<div class="rsvp-confirmado">
							<div>
								<span class="rotulo-pequeno">Sua resposta</span>
								<strong>{rotuloOpcao(minhaInscricao.option)}</strong>
								{#if minhaInscricao.guests > 0}
									<span class="detalhe-rsvp">
										+{minhaInscricao.guests}
										{minhaInscricao.guests === 1 ? 'convidado' : 'convidados'}
									</span>
								{/if}
							</div>
							<Botao variante="texto" onclick={() => (editandoRsvp = true)}>Alterar resposta</Botao>
						</div>
					{:else}
						<h2>Sua participação</h2>
						<form
							onsubmit={(e) => {
								e.preventDefault();
								fazerInscricao();
							}}
						>
							<div class="opcoes-rsvp" role="radiogroup" aria-label="Opções de participação">
								{#each evento.rsvpOptions ?? [] as opcao (opcao.key)}
									<label class="opcao-label" class:selecionada={selecionandoOpcao === opcao.key}>
										<input
											type="radio"
											name="opcao"
											value={opcao.key}
											checked={selecionandoOpcao === opcao.key}
											onchange={() => (selecionandoOpcao = opcao.key)}
										/>
										<span>{opcao.label}</span>
									</label>
								{/each}
							</div>

							{#if selecionandoOpcao === 'convidado'}
								<div class="campo-extra">
									<label for="convidados">Quantos convidados?</label>
									<input
										id="convidados"
										type="number"
										min="0"
										max="50"
										bind:value={qtdConvidados}
									/>
								</div>
							{/if}

							<div class="campo-extra">
								<label for="notas">Observações (opcional)</label>
								<textarea
									id="notas"
									bind:value={notasInscricao}
									placeholder="Ex.: chego 15 min depois, restrição alimentar…"
									rows="2"
								></textarea>
							</div>

							<div class="acoes-rsvp">
								<Botao tipo="submit" largura="cheia" carregando={salvandoRsvp}>
									{minhaInscricao ? 'Atualizar participação' : 'Confirmar participação'}
								</Botao>
								{#if minhaInscricao}
									<Botao variante="texto" largura="cheia" onclick={() => (editandoRsvp = false)}>
										Cancelar
									</Botao>
								{/if}
							</div>
						</form>
					{/if}
				</section>
			{/if}

			<section class="secao">
				<div class="cabecalho-secao">
					<h2>Escala do encontro</h2>
					{#if permissoesEvento.podeGerenciarEscala}
						<a href={`/responsabilidades?eventoId=${evento.id}`} class="link-acao">
							Gerenciar escala
						</a>
					{/if}
				</div>

				{#if escalas.length === 0}
					<p class="texto-vazio">Nenhuma responsabilidade atribuída ainda para este encontro.</p>
				{:else}
					<ul class="lista">
						{#each escalas as esc (esc.id)}
							<li class="item">
								<div class="item-info">
									<strong>{esc.responsabilidadeNome}</strong>
									<span class="subitem">{esc.pessoaNome}</span>
									{#if esc.observacoes}
										<span class="subitem">{esc.observacoes}</span>
									{/if}
								</div>
								<span class="chip chip-escala-{esc.status}">
									{STATUS_ESCALA[esc.status] ?? esc.status}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="secao">
				<div class="cabecalho-secao">
					<h2>Quem respondeu</h2>
					<span class="contador">
						{inscricoes.length}
						{inscricoes.length === 1 ? 'resposta' : 'respostas'}
					</span>
				</div>

				{#if inscricoes.length === 0}
					<p class="texto-vazio">Ninguém respondeu ainda.</p>
				{:else}
					<ul class="lista">
						{#each inscricoes as i (i.id)}
							<li class="item">
								<div class="item-info">
									<strong>{i.person.nome}</strong>
									{#if i.person.whatsapp}
										<span class="subitem">{i.person.whatsapp}</span>
									{/if}
									{#if i.guests > 0}
										<span class="convidados">
											+{i.guests}
											{i.guests === 1 ? 'convidado' : 'convidados'}
										</span>
									{/if}
								</div>
								<span class="chip opcao-{i.option}">{rotuloOpcao(i.option)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if permissoesEvento.podeVerRelatorio || presencas.length > 0}
				<section class="secao">
					<h2>{permissoesEvento.podeVerRelatorio ? 'Presença efetiva' : 'Sua presença'}</h2>

					{#if resumoPresenca}
						<div class="resumo-presenca">
							<div class="stat">
								<span class="stat-valor">{resumoPresenca.totalInscritos}</span>
								<span class="stat-label">Confirmados</span>
							</div>
							<div class="stat">
								<span class="stat-valor">{resumoPresenca.totalPresencas}</span>
								<span class="stat-label">Presentes</span>
							</div>
							<div class="stat">
								<span class="stat-valor">{resumoPresenca.totalAusentes}</span>
								<span class="stat-label">Ausentes</span>
							</div>
							<div class="stat">
								<span class="stat-valor">{resumoPresenca.taxaPresenca}%</span>
								<span class="stat-label">Comparecimento</span>
							</div>
						</div>
					{/if}

					{#if permissoesEvento.podeRegistrarPresenca && inscritosSemPresenca.length > 0}
						<div class="subbloco">
							<h3>Aguardando registro</h3>
							<ul class="lista">
								{#each inscritosSemPresenca as p (p.id)}
									<li class="item item-acoes">
										<div class="item-info">
											<strong>{p.nome}</strong>
											<span class="subitem">RSVP: {rotuloOpcao(p.rsvpOption)}</span>
										</div>
										<div class="botoes-presenca">
											<Botao
												variante="primario"
												carregando={salvandoPresencaId === p.id}
												onclick={() => registrarPresenca(p.id, 'present')}
											>
												Presente
											</Botao>
											<Botao
												variante="secundario"
												desabilitado={salvandoPresencaId === p.id}
												onclick={() => registrarPresenca(p.id, 'late')}
											>
												Atrasou
											</Botao>
										</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if presencas.length > 0}
						<ul class="lista">
							{#each presencas as p (p.id)}
								<li class="item">
									<div class="item-info">
										<strong>{p.nome}</strong>
										<span class="subitem">{METODO_PRESENCA[p.metodo] ?? p.metodo}</span>
									</div>
									<span class="chip status-presenca-{p.status}">
										{STATUS_PRESENCA[p.status] ?? p.status}
									</span>
								</li>
							{/each}
						</ul>
					{:else if !carregando}
						<p class="texto-vazio">Nenhuma presença registrada ainda.</p>
					{/if}
				</section>
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

	.cabecalho-evento {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.tipo {
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-texto);
		background: color-mix(in srgb, var(--cor) 18%, transparent);
		border: 1px solid color-mix(in srgb, var(--cor) 45%, transparent);
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.status {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.status-scheduled {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.status-ongoing {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.status-completed {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.status-cancelled {
		background: var(--cor-erro-suave);
		color: var(--cor-erro);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.metas {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.acoes-topo {
		margin-top: var(--esp-2);
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.confirmar-cancelamento {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-4);
		border: 1px solid var(--cor-erro);
		border-radius: var(--raio-lg);
		background: var(--cor-erro-suave);
	}

	.confirmar-cancelamento h2 {
		font-size: var(--texto-lg);
	}

	.confirmar-cancelamento label {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.confirmar-cancelamento textarea {
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	.bloco-rsvp {
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.rsvp-confirmado {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		flex-wrap: wrap;
	}

	.rsvp-confirmado > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.rotulo-pequeno {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-weight: 600;
	}

	.detalhe-rsvp {
		font-size: var(--texto-xs);
		color: var(--cor-marca);
		font-weight: 600;
	}

	.opcoes-rsvp {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		margin-bottom: var(--esp-3);
	}

	.opcao-label {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		cursor: pointer;
		font-size: var(--texto-sm);
		font-weight: 500;
	}

	.opcao-label.selecionada {
		border-color: var(--cor-marca);
		background: var(--cor-marca-suave);
		color: var(--cor-texto);
	}

	.campo-extra {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		margin-bottom: var(--esp-3);
	}

	.campo-extra label {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.campo-extra input,
	.campo-extra textarea {
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	.campo-extra input {
		min-height: var(--toque-min);
	}

	.acoes-rsvp {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.secao {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.cabecalho-secao {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	.cabecalho-secao h2,
	.secao > h2 {
		font-size: var(--texto-lg);
	}

	.contador {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
	}

	.link-acao {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
	}

	.texto-vazio {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
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

	.item-acoes {
		flex-wrap: wrap;
	}

	.item-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 140px;
	}

	.subitem {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.convidados {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-marca);
	}

	.chip {
		flex: none;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.opcao-confirmado,
	.status-presenca-present,
	.chip-escala-confirmada,
	.chip-escala-cumprida {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.opcao-talvez,
	.opcao-atrasado,
	.status-presenca-late,
	.chip-escala-proposta {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.opcao-nao_vou,
	.status-presenca-absent {
		background: var(--cor-erro-suave);
		color: var(--cor-erro);
	}

	.opcao-convidado {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.resumo-presenca {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: var(--esp-2);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--esp-3) var(--esp-2);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.stat-valor {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-xl);
		font-weight: 800;
	}

	.stat-label {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.subbloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.subbloco h3 {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.botoes-presenca {
		display: flex;
		gap: var(--esp-2);
		flex-wrap: wrap;
	}

	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}
</style>
