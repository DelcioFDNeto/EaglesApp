<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';
	import { extrairCodigoCheckin, gerarSvgQr } from '$lib/eventos/qrcode';

	interface BarcodeDetectorResultado {
		rawValue?: string;
	}
	interface BarcodeDetectorInstancia {
		detect(fonte: HTMLVideoElement): Promise<BarcodeDetectorResultado[]>;
	}
	interface BarcodeDetectorCtor {
		new (opcoes?: { formats?: string[] }): BarcodeDetectorInstancia;
		getSupportedFormats?: () => Promise<string[]>;
	}

	type MeuCheckin = {
		id: string;
		status: string;
		metodo: string;
		registradoEm?: string;
	};

	type QrAtivo = {
		qrCode: string;
		expiresAt: string;
		isActive: boolean;
	};

	let evento = $state<any>(null);
	let inscricoes: any[] = $state([]);
	let presencas: any[] = $state([]);
	/** Chamada: integrantes do PG e quem respondeu, ainda sem registro. */
	let paraChamada: any[] = $state([]);
	/** Quem trocou de resposta (RN-12), para quem cuida do PG. */
	let mudancasDeResposta: any[] = $state([]);
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

	// Check-in opcional por QR Code (RN-14 / RN-29): só aparece quando a flag está ligada.
	let checkinQrAtivo = $state(false);
	let meuCheckin = $state<MeuCheckin | null>(null);
	let qrAtivo = $state<QrAtivo | null>(null);
	let validadeMinutos = $state(120);
	let gerandoQr = $state(false);
	let erroCheckin = $state<string | undefined>(undefined);
	let mensagemCheckin = $state<string | undefined>(undefined);
	let codigoCopiado = $state(false);
	let codigoCheckin = $state('');
	let enviandoCheckin = $state(false);
	let suportaCameraQr = $state(false);
	let escaneandoCamera = $state(false);
	let videoEl = $state<HTMLVideoElement | null>(null);

	let cameraStream: MediaStream | null = null;
	let timerScan: ReturnType<typeof setTimeout> | null = null;
	let timerCopiado: ReturnType<typeof setTimeout> | null = null;

	const OPCOES_VALIDADE_QR = [
		{ minutos: 30, rotulo: '30 minutos' },
		{ minutos: 120, rotulo: '2 horas' },
		{ minutos: 240, rotulo: '4 horas' }
	] as const;

	const qrExpirado = $derived(
		qrAtivo ? new Date(qrAtivo.expiresAt).getTime() <= Date.now() : false
	);

	function conteudoQrCode(codigo: string): string {
		if (typeof window !== 'undefined' && evento?.id) {
			const link = `${window.location.origin}/eventos/${evento.id}?checkin=${encodeURIComponent(codigo)}`;
			if (new TextEncoder().encode(link).length <= 250) {
				return link;
			}
		}
		return codigo;
	}

	const qrSvg = $derived.by(() => {
		if (!qrAtivo) return '';
		try {
			return gerarSvgQr(conteudoQrCode(qrAtivo.qrCode), 240);
		} catch {
			return gerarSvgQr(qrAtivo.qrCode, 240);
		}
	});

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
				checkinQrAtivo = Boolean(data.checkinQrAtivo);
				meuCheckin = data.meuCheckin ?? null;
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

		const [, resEscalas] = await Promise.allSettled([
			carregarPresencas(eventoId),
			api.get(`/api/escalas?eventoId=${encodeURIComponent(eventoId)}`),
			checkinQrAtivo && evento?.status !== 'cancelled' && permissoesEvento.podeRegistrarPresenca
				? carregarQrAtivo(eventoId)
				: Promise.resolve()
		]);

		if (resEscalas.status === 'fulfilled' && resEscalas.value.ok) {
			const dataEscalas = await resEscalas.value.json();
			escalas = (dataEscalas.escalas ?? []).filter((e: any) => e.status !== 'trocada');
		}

		carregando = false;
	}

	async function carregarQrAtivo(eventoId = evento?.id) {
		if (!eventoId) return;
		try {
			const res = await api.get(`/api/eventos/${eventoId}/checkin`);
			if (res.ok) {
				const data = await res.json();
				qrAtivo = {
					qrCode: data.qrCode,
					expiresAt: data.expiresAt,
					isActive: Boolean(data.isActive)
				};
			} else if (res.status === 404) {
				qrAtivo = null;
			}
		} catch {
			// Offline ou indisponível: mantém o estado atual sem bloquear o evento.
		}
	}

	async function gerarQrCode() {
		if (!evento?.id) return;
		gerandoQr = true;
		erroCheckin = undefined;
		mensagemCheckin = undefined;
		codigoCopiado = false;
		try {
			const res = await api.post(`/api/eventos/${evento.id}/checkin`, {
				expiresInMinutes: validadeMinutos
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				qrAtivo = {
					qrCode: data.qrCode,
					expiresAt: data.expiresAt,
					isActive: Boolean(data.isActive)
				};
				mensagemCheckin = 'QR Code pronto para uso.';
			} else {
				erroCheckin = data.erro ?? 'Não foi possível gerar o QR Code.';
			}
		} catch {
			erroCheckin = 'Sem conexão. Não foi possível gerar o QR Code.';
		} finally {
			gerandoQr = false;
		}
	}

	async function copiarCodigoQr() {
		if (!qrAtivo?.qrCode) return;
		erroCheckin = undefined;
		try {
			await navigator.clipboard.writeText(qrAtivo.qrCode);
			codigoCopiado = true;
			if (timerCopiado) clearTimeout(timerCopiado);
			timerCopiado = setTimeout(() => {
				codigoCopiado = false;
			}, 2500);
		} catch {
			erroCheckin = 'Não foi possível copiar automaticamente. Selecione o código abaixo.';
		}
	}

	function pararCamera() {
		if (timerScan) {
			clearTimeout(timerScan);
			timerScan = null;
		}
		if (cameraStream) {
			for (const track of cameraStream.getTracks()) {
				track.stop();
			}
			cameraStream = null;
		}
		if (videoEl) {
			videoEl.srcObject = null;
		}
		escaneandoCamera = false;
	}

	async function iniciarCamera() {
		if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
		const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
			.BarcodeDetector;
		if (!Detector) return;

		erroCheckin = undefined;
		mensagemCheckin = undefined;
		escaneandoCamera = true;
		await tick();

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' } },
				audio: false
			});

			// Usuário pode ter fechado a câmera enquanto a permissão estava aberta.
			if (!escaneandoCamera) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}

			cameraStream = stream;
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
			}

			const detector = new Detector({ formats: ['qr_code'] });

			const lerQuadro = async () => {
				if (!escaneandoCamera || !videoEl) return;
				try {
					if (videoEl.readyState >= 2) {
						const achados = await detector.detect(videoEl);
						const valor = achados[0]?.rawValue;
						if (valor) {
							pararCamera();
							const codigo = extrairCodigoCheckin(valor);
							codigoCheckin = codigo;
							await confirmarCheckin(codigo);
							return;
						}
					}
				} catch {
					// Quadro inválido ou câmera reiniciando; tenta o próximo.
				}
				if (escaneandoCamera) {
					timerScan = setTimeout(lerQuadro, 220);
				}
			};

			timerScan = setTimeout(lerQuadro, 250);
		} catch {
			pararCamera();
			erroCheckin =
				'Não foi possível abrir a câmera. Verifique a permissão ou digite o código abaixo.';
		}
	}

	async function confirmarCheckin(entrada = codigoCheckin) {
		if (!evento?.id) return;
		const codigo = extrairCodigoCheckin(entrada);
		if (!codigo) {
			erroCheckin = 'Informe o código de check-in do encontro.';
			return;
		}

		enviandoCheckin = true;
		erroCheckin = undefined;
		mensagemCheckin = undefined;
		try {
			const res = await api.post(`/api/eventos/${evento.id}/checkin-scan`, {
				qrCode: codigo
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				meuCheckin = {
					id: 'self',
					status: 'present',
					metodo: 'qr_code',
					registradoEm: new Date().toISOString()
				};
				mensagemCheckin = data.mensagem ?? 'Check-in realizado com sucesso.';
				codigoCheckin = '';
				await carregarPresencas();
			} else {
				erroCheckin = data.erro ?? 'Não foi possível confirmar o check-in.';
			}
		} catch {
			erroCheckin = 'Sem conexão. Tente novamente ou avise quem está fazendo a chamada.';
		} finally {
			enviandoCheckin = false;
		}
	}

	/** Só a presença: cada toque na chamada não recarrega o evento inteiro. */
	async function carregarPresencas(eventoId = evento?.id) {
		if (!eventoId) return;
		const [resPresencas, resRelatorio] = await Promise.allSettled([
			api.get(`/api/eventos/${eventoId}/presenca`),
			permissoesEvento.podeVerRelatorio
				? api.get(`/api/eventos/${eventoId}/relatorio-presenca`)
				: Promise.resolve(null)
		]);
		if (resPresencas.status === 'fulfilled' && resPresencas.value.ok) {
			const d = await resPresencas.value.json();
			presencas = d.presencas ?? [];
			paraChamada = d.paraChamada ?? [];
			resumoPresenca = d.resumo ?? null;
		}
		if (resRelatorio.status === 'fulfilled' && resRelatorio.value?.ok) {
			const r = await resRelatorio.value.json();
			mudancasDeResposta = r.mudancasDeResposta ?? [];
		}
	}

	onMount(() => {
		const checkinParam = page.url.searchParams.get('checkin');
		if (checkinParam) {
			codigoCheckin = extrairCodigoCheckin(checkinParam);
		}

		if (
			typeof window !== 'undefined' &&
			typeof navigator !== 'undefined' &&
			Boolean(navigator.mediaDevices?.getUserMedia) &&
			'BarcodeDetector' in window
		) {
			const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
				.BarcodeDetector;
			if (Detector?.getSupportedFormats) {
				Detector.getSupportedFormats()
					.then((formatos) => {
						suportaCameraQr = formatos.includes('qr_code');
					})
					.catch(() => {
						suportaCameraQr = true;
					});
			} else {
				suportaCameraQr = true;
			}
		}

		carregarEvento();

		return () => {
			pararCamera();
			if (timerCopiado) clearTimeout(timerCopiado);
		};
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
				await carregarPresencas();
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível registrar presença.';
			}
		} catch {
			erro = 'Sem conexão. A presença não foi registrada.';
		} finally {
			salvandoPresencaId = null;
		}
	}

	async function desfazerPresenca(personId: string) {
		if (!evento?.id) return;
		salvandoPresencaId = personId;
		erro = undefined;
		try {
			const res = await api.delete(`/api/eventos/${evento.id}/presenca`, {
				body: JSON.stringify({ personId })
			});
			if (res.ok) {
				await carregarPresencas();
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível desfazer.';
			}
		} catch {
			erro = 'Sem conexão. Nada foi desfeito.';
		} finally {
			salvandoPresencaId = null;
		}
	}

	function dataHora(iso: string) {
		return new Date(iso).toLocaleDateString('pt-BR', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
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
					{#if evento.grupoNome}
						<span class="status status-completed">{evento.grupoNome}</span>
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

			{#if checkinQrAtivo && evento.status !== 'cancelled'}
				<section class="secao" aria-labelledby="titulo-checkin-qr">
					<div class="cabecalho-checkin">
						<h2 id="titulo-checkin-qr">Check-in por QR Code</h2>
						<p class="sub">Opcional: quem não usar o app entra na chamada normalmente.</p>
					</div>

					{#if erroCheckin}
						<Aviso tom="erro">{erroCheckin}</Aviso>
					{/if}
					{#if mensagemCheckin}
						<Aviso tom="sucesso">{mensagemCheckin}</Aviso>
					{/if}

					{#if permissoesEvento.podeRegistrarPresenca}
						<div class="bloco-checkin">
							<div class="controles-qr">
								<div class="campo-validade">
									<label for="validade-qr">Validade do QR Code</label>
									<select id="validade-qr" bind:value={validadeMinutos}>
										{#each OPCOES_VALIDADE_QR as opcao (opcao.minutos)}
											<option value={opcao.minutos}>{opcao.rotulo}</option>
										{/each}
									</select>
								</div>
								<Botao variante="primario" carregando={gerandoQr} onclick={gerarQrCode}>
									{qrAtivo ? 'Gerar novo QR Code' : 'Gerar QR Code'}
								</Botao>
							</div>

							{#if qrAtivo}
								{#if qrExpirado}
									<Aviso tom="aviso">
										Este QR Code expirou. Gere um novo código para liberar novos check-ins.
									</Aviso>
								{/if}

								<div class="qr-apresentacao">
									<div class="qr-moldura">
										{@html qrSvg}
									</div>
									<p class="qr-validade">
										{qrExpirado ? 'Expirou em' : 'Válido até'}
										{formatarData(qrAtivo.expiresAt)}
									</p>
								</div>

								<div class="qr-codigo-linha">
									<code class="qr-codigo-texto">{qrAtivo.qrCode}</code>
									<Botao variante="secundario" onclick={copiarCodigoQr}>
										{codigoCopiado ? 'Código copiado' : 'Copiar código'}
									</Botao>
								</div>
							{/if}
						</div>
					{/if}

					<div class="bloco-checkin">
						{#if meuCheckin}
							<Aviso
								tom="sucesso"
								titulo={meuCheckin.metodo === 'qr_code'
									? 'Presença registrada por QR Code'
									: 'Presença registrada'}
							>
								{#if meuCheckin.status === 'late'}
									Presença registrada com atraso neste encontro.
								{:else if meuCheckin.registradoEm}
									Confirmado em {formatarData(meuCheckin.registradoEm)}.
								{:else}
									Sua presença neste encontro já está confirmada.
								{/if}
							</Aviso>
						{:else}
							{#if suportaCameraQr}
								{#if escaneandoCamera}
									<div class="camera-previa">
										<video
											bind:this={videoEl}
											playsinline
											muted
											aria-label="Prévia da câmera para leitura do QR Code"
										></video>
										<Botao variante="texto" largura="cheia" onclick={pararCamera}>
											Fechar câmera
										</Botao>
									</div>
								{:else}
									<Botao variante="secundario" largura="cheia" onclick={iniciarCamera}>
										Escanear com a câmera
									</Botao>
								{/if}
							{:else}
								<p class="sub">
									Aponte a câmera do celular para o QR Code do encontro ou informe o código abaixo.
								</p>
							{/if}

							<form
								class="form-checkin"
								onsubmit={(e) => {
									e.preventDefault();
									confirmarCheckin();
								}}
							>
								<div class="campo-extra">
									<label for="codigo-checkin">Ou digite/cole o código do encontro</label>
									<input
										id="codigo-checkin"
										type="text"
										bind:value={codigoCheckin}
										placeholder="eagles-checkin-..."
										autocomplete="off"
										autocapitalize="off"
										spellcheck="false"
									/>
								</div>
								<Botao
									tipo="submit"
									largura="cheia"
									carregando={enviandoCheckin}
									desabilitado={!codigoCheckin.trim()}
								>
									Confirmar check-in
								</Botao>
							</form>
						{/if}
					</div>
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

					{#if permissoesEvento.podeRegistrarPresenca && paraChamada.length > 0}
						<div class="subbloco">
							<h3>Chamada</h3>
							<p class="subitem">
								{#if evento.groupId}
									Integrantes do subgrupo e quem respondeu. Marque quem veio: depois da chamada,
									quem é do subgrupo e não foi marcado conta como falta neste encontro.
								{:else}
									Membros ativos dos Eagles e quem respondeu. Marque quem veio: depois da chamada,
									quem é membro ativo e não foi marcado conta como falta neste encontro.
								{/if}
							</p>
							<ul class="lista">
								{#each paraChamada as p (p.id)}
									<li class="item item-acoes">
										<div class="item-info">
											<strong>{p.nome}</strong>
											<span class="subitem">
												{p.rsvpOption ? `Respondeu: ${rotuloOpcao(p.rsvpOption)}` : 'Não respondeu'}
											</span>
										</div>
										<div class="botoes-presenca">
											<Botao
												variante="primario"
												carregando={salvandoPresencaId === p.id}
												onclick={() => registrarPresenca(p.id, 'present')}
												aria-label={`${p.nome} veio`}
											>
												Veio
											</Botao>
											<Botao
												variante="secundario"
												desabilitado={salvandoPresencaId === p.id}
												onclick={() => registrarPresenca(p.id, 'late')}
												aria-label={`${p.nome} chegou atrasado(a)`}
											>
												Atrasou
											</Botao>
											<Botao
												variante="texto"
												desabilitado={salvandoPresencaId === p.id}
												onclick={() => registrarPresenca(p.id, 'absent')}
												aria-label={`${p.nome} faltou`}
											>
												Faltou
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
									{#if permissoesEvento.podeRegistrarPresenca}
										<Botao
											variante="texto"
											desabilitado={salvandoPresencaId === p.personId}
											onclick={() => desfazerPresenca(p.personId)}
											aria-label={`Desfazer o registro de ${p.nome}`}
										>
											Desfazer
										</Botao>
									{/if}
								</li>
							{/each}
						</ul>
					{:else if !carregando}
						<p class="texto-vazio">Nenhuma presença registrada ainda.</p>
					{/if}

					{#if mudancasDeResposta.length > 0}
						<details class="mudancas">
							<summary>
								{mudancasDeResposta.length}
								{mudancasDeResposta.length === 1
									? 'pessoa mudou de resposta'
									: 'pessoas mudaram de resposta'}
							</summary>
							<ul class="lista">
								{#each mudancasDeResposta as m (m.personId)}
									<li class="item">
										<div class="item-info">
											<strong>{m.nome}</strong>
											<span class="subitem">
												{m.respostas
													.map((r: any) => `${rotuloOpcao(r.option)} (${dataHora(r.em)})`)
													.join(' → ')}
											</span>
										</div>
									</li>
								{/each}
							</ul>
						</details>
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

	.cabecalho-checkin {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.cabecalho-checkin h2 {
		font-size: var(--texto-lg);
	}

	.bloco-checkin {
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.controles-qr {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--esp-3);
	}

	.campo-validade {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		flex: 1;
		min-width: 150px;
	}

	.campo-validade label {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.campo-validade select {
		min-height: var(--toque-min);
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	.campo-validade select:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.qr-apresentacao {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-2);
	}

	/* Fundo branco fixo mesmo no tema escuro para leitura confiável pela câmera. */
	.qr-moldura {
		background: #ffffff;
		padding: var(--esp-3);
		border-radius: var(--raio);
		border: 1px solid var(--cor-linha);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.qr-moldura :global(svg) {
		display: block;
		width: min(240px, 100%);
		height: auto;
	}

	.qr-validade {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-align: center;
	}

	.qr-codigo-linha {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
	}

	.qr-codigo-texto {
		flex: 1;
		min-width: 180px;
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie-2);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-sm);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: var(--texto-xs);
		word-break: break-all;
		user-select: all;
	}

	.camera-previa {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.camera-previa video {
		width: 100%;
		max-height: 320px;
		object-fit: cover;
		border-radius: var(--raio);
		border: 1px solid var(--cor-linha-forte);
		background: #000000;
	}

	.form-checkin {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.form-checkin .campo-extra {
		margin-bottom: 0;
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
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-2);
	}

	@media (min-width: 560px) {
		.resumo-presenca {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
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

	.mudancas summary {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-marca);
		cursor: pointer;
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
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
