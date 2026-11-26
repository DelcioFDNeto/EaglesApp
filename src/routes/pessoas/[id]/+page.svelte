<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Estagio = 'visitante' | 'recorrente' | 'membro';
	type Dados = {
		dataNascimento: string | null;
		idade: number | null;
		telefone: string | null;
		whatsapp: string | null;
		email: string | null;
		relacionamento: string | null;
		irmaos: string | null;
		vinculosFamiliares: string | null;
		observacoes: string | null;
	};

	const ROTULO: Record<string, string> = {
		visitante: 'Visitante',
		recorrente: 'Participante recorrente',
		membro: 'Membro Eagles'
	};

	/** O que muda no acesso, dito antes de confirmar. */
	function efeitoNoAcesso(de: string, para: Estagio): string | null {
		if (para === 'membro') return 'Passa a ver o grupo, as escalas e o próprio financeiro.';
		if (de === 'membro' || de === 'conselheiro' || de === 'lider') {
			return 'Perde o acesso de membro: volta a ver só os eventos.';
		}
		return null;
	}

	const pessoaId = page.params.id ?? '';

	let pessoa = $state<any>(null);
	let permissoes = $state<{ podeEditar: boolean; estagiosPermitidos: Estagio[] }>({
		podeEditar: false,
		estagiosPermitidos: []
	});
	let historico = $state<any[]>([]);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	// Jornada
	let destino = $state<Estagio | null>(null);
	let motivo = $state('');
	let movendo = $state(false);

	// Edição
	let editando = $state(false);
	let salvando = $state(false);
	let erroEdicao = $state<string | undefined>(undefined);
	let campoComErro = $state<string | null>(null);
	let form = $state({
		nome: '',
		dataNascimento: '',
		telefone: '',
		whatsapp: '',
		email: '',
		relacionamento: '',
		irmaos: '',
		vinculosFamiliares: '',
		observacoes: ''
	});

	onMount(carregar);

	async function carregar() {
		erro = undefined;
		try {
			const res = await api.get(`/api/pessoas/${pessoaId}`);
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível carregar a pessoa.';
				return;
			}
			pessoa = d.pessoa;
			permissoes = d.permissoes;
			historico = d.historico ?? [];
		} catch {
			erro = 'Sem conexão. Não foi possível carregar a pessoa.';
		} finally {
			carregando = false;
		}
	}

	function abrirEdicao() {
		const dados: Dados = pessoa.dados;
		form = {
			nome: pessoa.nome,
			dataNascimento: dados.dataNascimento ?? '',
			telefone: dados.telefone ?? '',
			whatsapp: dados.whatsapp ?? '',
			email: dados.email ?? '',
			relacionamento: dados.relacionamento ?? '',
			irmaos: dados.irmaos ?? '',
			vinculosFamiliares: dados.vinculosFamiliares ?? '',
			observacoes: dados.observacoes ?? ''
		};
		erroEdicao = undefined;
		campoComErro = null;
		mensagem = undefined;
		editando = true;
	}

	async function salvar(e: SubmitEvent) {
		e.preventDefault();
		salvando = true;
		erroEdicao = undefined;
		campoComErro = null;

		// Menor: só nome e nascimento vão para o servidor (os demais nem aparecem).
		const corpo = pessoa.ehMenor
			? { nome: form.nome, dataNascimento: form.dataNascimento || null }
			: {
					...form,
					dataNascimento: form.dataNascimento || null
				};

		try {
			const res = await api.patch(`/api/pessoas/${pessoaId}`, corpo);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem;
				editando = false;
				await carregar();
			} else {
				erroEdicao = d.erro ?? 'Não foi possível salvar.';
				campoComErro = d.campo ?? null;
			}
		} catch {
			erroEdicao = 'Sem conexão. Nada foi salvo.';
		} finally {
			salvando = false;
		}
	}

	async function mover() {
		if (!destino) return;
		movendo = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post(`/api/pessoas/${pessoaId}/estagio`, {
				estagio: destino,
				motivo: motivo.trim() || null
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem;
				destino = null;
				motivo = '';
				await carregar();
			} else {
				erro = d.erro ?? 'Não foi possível mudar o estágio.';
			}
		} catch {
			erro = 'Sem conexão. O estágio não mudou.';
		} finally {
			movendo = false;
		}
	}

	function data(iso: string | null, comHora = false) {
		if (!iso) return '';
		const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
		return d.toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			...(comHora && { hour: '2-digit', minute: '2-digit' })
		});
	}

	const linhasDados = $derived.by((): Array<[string, string | null]> => {
		const d: Dados | null = pessoa?.dados ?? null;
		if (!d) return [];
		return [
			['Nascimento', d.dataNascimento ? `${data(d.dataNascimento)} (${d.idade} anos)` : null],
			['WhatsApp', d.whatsapp],
			['Telefone', d.telefone],
			['E-mail', d.email],
			['Relacionamento', d.relacionamento],
			['Irmãos', d.irmaos],
			['Vínculos familiares', d.vinculosFamiliares],
			['Observações', d.observacoes]
		];
	});

	const erroDe = (campo: string) => (campoComErro === campo ? erroEdicao : undefined);
</script>

<svelte:head>
	<title>{pessoa?.nome ?? 'Pessoa'} · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/pessoas" class="voltar">← Pessoas</a>

		{#if erro}<Aviso tom="erro">{erro}</Aviso>{/if}
		{#if mensagem}<Aviso tom="sucesso">{mensagem}</Aviso>{/if}

		{#if carregando}
			<div class="estado">
				<Marca tamanho={44} />
				<p>Carregando…</p>
			</div>
		{:else if pessoa}
			<header class="cabecalho">
				<h1>{pessoa.nome}</h1>
				<div class="chips">
					<span class="chip chip-{pessoa.estagio}"
						>{ROTULO[pessoa.estagio] ?? pessoa.estagioRotulo}</span
					>
					{#if pessoa.lider}<span class="chip">Líder</span>{/if}
				</div>
				<p class="sub">
					{pessoa.grupo ? pessoa.grupo.nome : 'Sem PG'}
					{#if pessoa.dataEntrada}· nos Eagles desde {data(pessoa.dataEntrada)}{/if}
				</p>
			</header>

			<!-- Jornada -->
			{#if permissoes.estagiosPermitidos.length > 0}
				<section class="bloco" aria-labelledby="titulo-jornada">
					<h2 id="titulo-jornada">Caminhada</h2>

					{#if !destino}
						<p class="sub">Mover {pessoa.nome.split(' ')[0]} para:</p>
						<div class="botoes">
							{#each permissoes.estagiosPermitidos as e (e)}
								<Botao variante="secundario" onclick={() => (destino = e)}>{ROTULO[e]}</Botao>
							{/each}
						</div>
					{:else}
						<p>
							De <strong>{ROTULO[pessoa.estagio] ?? pessoa.estagioRotulo}</strong> para
							<strong>{ROTULO[destino]}</strong>.
						</p>
						{#if efeitoNoAcesso(pessoa.estagio, destino)}
							<Aviso tom="info">{efeitoNoAcesso(pessoa.estagio, destino)}</Aviso>
						{/if}
						<div class="campo-texto">
							<label for="motivo">Motivo (opcional, fica no histórico)</label>
							<textarea
								id="motivo"
								bind:value={motivo}
								rows="2"
								maxlength="500"
								placeholder="Ex.: vem ao PG há dois meses"
							></textarea>
						</div>
						<div class="botoes">
							<Botao carregando={movendo} onclick={mover}>Confirmar</Botao>
							<Botao variante="texto" desabilitado={movendo} onclick={() => (destino = null)}>
								Voltar
							</Botao>
						</div>
					{/if}
				</section>
			{/if}

			<!-- Dados -->
			{#if pessoa.dados}
				<section class="bloco" aria-labelledby="titulo-dados">
					<div class="cabecalho-bloco">
						<h2 id="titulo-dados">Dados</h2>
						{#if permissoes.podeEditar && !editando}
							<Botao variante="texto" onclick={abrirEdicao}>Editar</Botao>
						{/if}
					</div>

					{#if pessoa.ehMenor}
						<Aviso tom="info" titulo="Menor de 18 anos">
							Fica só com nome e presença até o responsável dar consentimento (LGPD). O registro de
							consentimento ainda não existe no app.
						</Aviso>
					{/if}

					{#if editando}
						<form class="formulario" onsubmit={salvar} novalidate>
							{#if erroEdicao && !campoComErro}<Aviso tom="erro">{erroEdicao}</Aviso>{/if}

							<Campo
								id="nome"
								rotulo="Nome"
								bind:valor={form.nome}
								erro={erroDe('nome')}
								obrigatorio
								maxlength="120"
							/>
							<Campo
								id="dataNascimento"
								tipo="date"
								rotulo="Data de nascimento"
								bind:valor={form.dataNascimento}
								erro={erroDe('dataNascimento')}
								ajuda="Idade mínima: 16 anos."
							/>

							{#if !pessoa.ehMenor}
								<Campo
									id="whatsapp"
									tipo="tel"
									inputmode="tel"
									rotulo="WhatsApp"
									bind:valor={form.whatsapp}
									erro={erroDe('whatsapp')}
								/>
								<Campo
									id="telefone"
									tipo="tel"
									inputmode="tel"
									rotulo="Telefone"
									bind:valor={form.telefone}
									erro={erroDe('telefone')}
								/>
								<Campo
									id="email"
									tipo="email"
									inputmode="email"
									rotulo="E-mail"
									bind:valor={form.email}
									erro={erroDe('email')}
									ajuda="Contato para falar com a pessoa. O acesso ao app muda pelo convite."
								/>
								<Campo
									id="relacionamento"
									rotulo="Relacionamento"
									bind:valor={form.relacionamento}
									maxlength="80"
									placeholder="Ex.: solteiro(a), namorando, casado(a)"
								/>
								<Campo id="irmaos" rotulo="Irmãos" bind:valor={form.irmaos} maxlength="250" />
								<div class="campo-texto">
									<label for="vinculos">Vínculos familiares na comunidade</label>
									<textarea
										id="vinculos"
										bind:value={form.vinculosFamiliares}
										rows="2"
										maxlength="500"
									></textarea>
								</div>
								<div class="campo-texto">
									<label for="observacoes">Observações</label>
									<textarea
										id="observacoes"
										bind:value={form.observacoes}
										rows="3"
										maxlength="1000"
										aria-describedby="observacoes-ajuda"
									></textarea>
									<p id="observacoes-ajuda" class="ajuda">
										Só quem cuida da pessoa vê. Escreva o que você diria a ela.
									</p>
								</div>
							{/if}

							<div class="botoes">
								<Botao tipo="submit" carregando={salvando}>Salvar</Botao>
								<Botao variante="texto" desabilitado={salvando} onclick={() => (editando = false)}>
									Cancelar
								</Botao>
							</div>
						</form>
					{:else}
						<dl class="dados">
							{#each linhasDados as [rotulo, valor] (rotulo)}
								{#if valor}
									<div class="dado">
										<dt>{rotulo}</dt>
										<dd>{valor}</dd>
									</div>
								{/if}
							{/each}
						</dl>
						{#if !linhasDados.some(([, v]) => v)}
							<p class="sub">
								Nada preenchido ainda. O cadastro é progressivo: complete quando souber.
							</p>
						{/if}
					{/if}
				</section>
			{/if}

			<!-- Histórico -->
			<section class="bloco" aria-labelledby="titulo-historico">
				<h2 id="titulo-historico">Histórico</h2>
				{#if historico.length === 0}
					<p class="sub">Nenhuma mudança registrada ainda.</p>
				{:else}
					<ol class="linha-do-tempo">
						{#each historico as h (h.id)}
							<li>
								<strong>{ROTULO[h.para] ?? h.paraRotulo}</strong>
								<span class="detalhe">
									{#if h.de}de {ROTULO[h.de] ?? h.deRotulo} ·
									{/if}
									{data(h.em, true)}{#if h.por}{' '}· por {h.por}{/if}
								</span>
								{#if h.motivo}<span class="motivo">{h.motivo}</span>{/if}
							</li>
						{/each}
					</ol>
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

	.cabecalho {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.chip {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 10px;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.chip-recorrente {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.chip-membro,
	.chip-conselheiro,
	.chip-lider {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.bloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.bloco h2 {
		font-size: var(--texto-lg);
	}

	.cabecalho-bloco {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	.botoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.formulario {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
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

	textarea:focus-visible {
		border-color: var(--cor-foco);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-foco) 24%, transparent);
		outline: none;
	}

	.ajuda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.dados {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.dado {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.dado dt {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
	}

	.dado dd {
		margin: 0;
		overflow-wrap: anywhere;
		white-space: pre-line;
	}

	.linha-do-tempo {
		list-style: none;
		padding: 0 0 0 var(--esp-4);
		border-left: 2px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.linha-do-tempo li {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.linha-do-tempo li::before {
		content: '';
		position: absolute;
		left: calc(-1 * var(--esp-4) - 6px);
		top: 6px;
		width: 10px;
		height: 10px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca);
		border: 2px solid var(--cor-fundo);
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

	.estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}
</style>
