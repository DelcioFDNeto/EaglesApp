<script lang="ts">
	import { tick } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import {
		gerarChave,
		paraApi,
		validar,
		type DadosFormulario,
		type ErrosFormulario
	} from './formulario';
	import { opcaoConfirma } from '$shared/rsvp';

	export type OpcoesFormulario = {
		podeSemGrupo: boolean;
		tipos: Array<{ id: string; name: string; slug?: string }>;
		grupos: Array<{ id: string; name: string }>;
		pessoas: Array<{ id: string; nome: string }>;
	};

	let {
		modo,
		inicial,
		opcoes,
		chavesComResposta = [],
		salvando = false,
		erroServidor = undefined,
		voltarHref,
		onsalvar
	}: {
		modo: 'criar' | 'editar';
		inicial: DadosFormulario;
		opcoes: OpcoesFormulario;
		/** Opções de resposta que já têm respostas: o rótulo muda, mas não saem. */
		chavesComResposta?: string[];
		salvando?: boolean;
		erroServidor?: string;
		voltarHref: string;
		onsalvar: (corpo: Record<string, unknown>) => void;
	} = $props();

	// O formulário é montado uma vez com os dados já carregados; daí em diante
	// o estado é dele. (A página só o renderiza depois de ter `inicial`.)
	function copiaInicial(): DadosFormulario {
		// Cada opção chega com o "conta como vou" já resolvido, para a caixa mostrar o real.
		return {
			...inicial,
			rsvpOptions: inicial.rsvpOptions.map((o) => ({ ...o, confirma: opcaoConfirma(o) }))
		};
	}

	let dados = $state<DadosFormulario>(copiaInicial());
	let erros = $state<ErrosFormulario>({});
	let novaOpcao = $state('');
	let formEl: HTMLFormElement | undefined = $state();

	const comResposta = $derived(new Set(chavesComResposta));

	function adicionarOpcao() {
		const rotulo = novaOpcao.trim();
		if (!rotulo) return;
		const chave = gerarChave(
			rotulo,
			dados.rsvpOptions.map((o) => o.key)
		);
		dados.rsvpOptions.push({ key: chave, label: rotulo, confirma: opcaoConfirma({ key: chave }) });
		novaOpcao = '';
	}

	function removerOpcao(chave: string) {
		dados.rsvpOptions = dados.rsvpOptions.filter((o) => o.key !== chave);
	}

	async function enviar(e: SubmitEvent) {
		e.preventDefault();
		erros = validar(dados, { podeSemGrupo: opcoes.podeSemGrupo });
		if (Object.keys(erros).length > 0) {
			await tick();
			formEl?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
			return;
		}
		onsalvar(paraApi(dados, modo));
	}
</script>

<form bind:this={formEl} class="formulario" onsubmit={enviar} novalidate>
	{#if erroServidor}
		<Aviso tom="erro">{erroServidor}</Aviso>
	{/if}

	<Campo
		id="titulo"
		rotulo="Nome do evento"
		bind:valor={dados.title}
		erro={erros.title}
		obrigatorio
		maxlength="200"
		placeholder="Ex.: PG de quinta-feira"
	/>

	<div class="campo-select">
		<label for="tipo">Tipo <span class="obrigatorio" aria-hidden="true">*</span></label>
		<select
			id="tipo"
			bind:value={dados.eventTypeId}
			aria-required="true"
			aria-invalid={erros.eventTypeId ? 'true' : undefined}
			aria-describedby={erros.eventTypeId ? 'tipo-erro' : undefined}
		>
			<option value="" disabled>Escolha o tipo</option>
			{#each opcoes.tipos as t (t.id)}
				<option value={t.id}>{t.name}</option>
			{/each}
		</select>
		{#if erros.eventTypeId}<p id="tipo-erro" class="erro" role="alert">{erros.eventTypeId}</p>{/if}
		{#if opcoes.tipos.length === 0}
			<p class="ajuda">
				Ainda não há tipos de evento. <a href="/eventos/tipos">Cadastre o primeiro</a>.
			</p>
		{/if}
	</div>

	<div class="campo-select">
		<label for="grupo">
			Subgrupo
			{#if !opcoes.podeSemGrupo}<span class="obrigatorio" aria-hidden="true">*</span>{/if}
		</label>
		<select
			id="grupo"
			bind:value={dados.groupId}
			aria-required={!opcoes.podeSemGrupo || undefined}
			aria-invalid={erros.groupId ? 'true' : undefined}
			aria-describedby={erros.groupId ? 'grupo-erro' : 'grupo-ajuda'}
		>
			{#if opcoes.podeSemGrupo}
				<option value="">Equipe toda (sem subgrupo)</option>
			{:else}
				<option value="" disabled>Escolha o subgrupo</option>
			{/if}
			{#each opcoes.grupos as g (g.id)}
				<option value={g.id}>{g.name}</option>
			{/each}
		</select>
		{#if erros.groupId}
			<p id="grupo-erro" class="erro" role="alert">{erros.groupId}</p>
		{:else}
			<p id="grupo-ajuda" class="ajuda">
				Opcional. Deixe em “Equipe toda” para PGs e encontros abertos a todos os Eagles.
			</p>
		{/if}
	</div>

	<div class="duas-colunas">
		<Campo
			id="inicio"
			tipo="datetime-local"
			rotulo="Começa"
			bind:valor={dados.inicio}
			erro={erros.inicio}
			obrigatorio
		/>
		<Campo
			id="fim"
			tipo="datetime-local"
			rotulo="Termina"
			bind:valor={dados.fim}
			erro={erros.fim}
			ajuda="Opcional."
		/>
	</div>

	<Campo
		id="local"
		rotulo="Local"
		bind:valor={dados.location}
		maxlength="200"
		placeholder="Ex.: Casa da Ana, salão da igreja"
	/>

	<div class="campo-select">
		<label for="responsavel">Responsável</label>
		<select id="responsavel" bind:value={dados.responsiblePersonId}>
			<option value="">{modo === 'criar' ? 'Você (padrão)' : 'Sem responsável'}</option>
			{#each opcoes.pessoas as p (p.id)}
				<option value={p.id}>{p.nome}</option>
			{/each}
		</select>
	</div>

	<div class="campo-select">
		<label for="descricao">Descrição</label>
		<textarea
			id="descricao"
			bind:value={dados.description}
			rows="3"
			maxlength="2000"
			placeholder="O que vai acontecer, o que levar, recados…"
		></textarea>
	</div>

	<fieldset class="rsvp">
		<legend>Confirmação de presença</legend>

		<label class="alternar">
			<input type="checkbox" bind:checked={dados.rsvpEnabled} />
			<span>Pedir que as pessoas respondam se vão</span>
		</label>

		{#if dados.rsvpEnabled}
			<p class="ajuda" id="opcoes-ajuda">
				As respostas que as pessoas podem escolher. Uma opção que já tem respostas pode mudar de
				texto, mas não pode ser removida.
			</p>

			<ul class="opcoes" aria-describedby="opcoes-ajuda">
				{#each dados.rsvpOptions as opcao, i (opcao.key)}
					<li class="opcao">
						<div class="opcao-linha">
							<label class="visualmente-oculto" for={`opcao-${i}`}>Opção {i + 1}</label>
							<input
								id={`opcao-${i}`}
								type="text"
								bind:value={opcao.label}
								maxlength="80"
								aria-invalid={erros.rsvpOptions && !opcao.label.trim() ? 'true' : undefined}
							/>
							{#if comResposta.has(opcao.key)}
								<span class="tem-resposta">Tem respostas</span>
							{:else}
								<button
									type="button"
									class="remover"
									onclick={() => removerOpcao(opcao.key)}
									aria-label={`Remover a opção ${opcao.label || i + 1}`}
								>
									<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
										<path
											d="M4 4l8 8M12 4l-8 8"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
										/>
									</svg>
								</button>
							{/if}
						</div>
						<label class="conta-como">
							<input type="checkbox" bind:checked={opcao.confirma} />
							<span>Conta como “vou”</span>
						</label>
					</li>
				{/each}
			</ul>

			<div class="nova-opcao">
				<label class="visualmente-oculto" for="nova-opcao">Nova opção de resposta</label>
				<input
					id="nova-opcao"
					type="text"
					bind:value={novaOpcao}
					maxlength="80"
					placeholder="Ex.: Vou de carona"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							adicionarOpcao();
						}
					}}
				/>
				<Botao variante="secundario" onclick={adicionarOpcao} desabilitado={!novaOpcao.trim()}>
					Adicionar
				</Botao>
			</div>

			{#if erros.rsvpOptions}
				<p class="erro" role="alert">{erros.rsvpOptions}</p>
			{/if}
		{/if}
	</fieldset>

	<div class="acoes">
		<Botao tipo="submit" largura="cheia" carregando={salvando}>
			{modo === 'criar' ? 'Criar evento' : 'Salvar alterações'}
		</Botao>
		<Botao variante="texto" largura="cheia" href={voltarHref}>Voltar sem salvar</Botao>
	</div>
</form>

<style>
	.formulario {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.duas-colunas {
		display: grid;
		gap: var(--esp-4);
	}

	@media (min-width: 480px) {
		.duas-colunas {
			grid-template-columns: 1fr 1fr;
		}
	}

	.campo-select {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label,
	legend {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.obrigatorio {
		color: var(--cor-marca);
		margin-left: 2px;
	}

	select,
	textarea,
	.opcao-linha input,
	.nova-opcao input {
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		/* 16px evita o zoom automático do Safari no iPhone. */
		font-size: 16px;
		font-family: inherit;
		transition:
			border-color var(--transicao),
			box-shadow var(--transicao);
	}

	select,
	.opcao-linha input,
	.nova-opcao input {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
	}

	textarea {
		padding: var(--esp-2) var(--esp-3);
		resize: vertical;
	}

	select:focus-visible,
	textarea:focus-visible,
	input[type='text']:focus-visible {
		border-color: var(--cor-foco);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-foco) 24%, transparent);
		outline: none;
	}

	[aria-invalid='true'] {
		border-color: var(--cor-erro);
	}

	.ajuda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.erro {
		font-size: var(--texto-sm);
		font-weight: 500;
		color: var(--cor-erro);
	}

	.rsvp {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
		min-width: 0;
	}

	legend {
		padding: 0 var(--esp-1);
	}

	.alternar {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		font-size: var(--texto-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.alternar input {
		width: 20px;
		height: 20px;
		accent-color: var(--cor-marca);
		flex: none;
	}

	.opcoes {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.opcao {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.conta-como {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: 32px;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		cursor: pointer;
		align-self: flex-start;
	}

	.conta-como input {
		width: 18px;
		height: 18px;
		accent-color: var(--cor-marca);
	}

	.opcao-linha,
	.nova-opcao {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.opcao-linha input,
	.nova-opcao input {
		flex: 1;
		min-width: 0;
	}

	.remover {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: var(--toque-min);
		height: var(--toque-min);
		background: none;
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		color: var(--cor-texto-2);
		cursor: pointer;
	}

	@media (hover: hover) {
		.remover:hover {
			color: var(--cor-erro);
			border-color: var(--cor-erro);
		}
	}

	.tem-resposta {
		flex: none;
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
		max-width: 9ch;
		text-align: center;
		line-height: 1.2;
	}

	.acoes {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}
</style>
