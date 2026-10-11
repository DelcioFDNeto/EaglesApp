<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import AreaDeTexto from '$ui/AreaDeTexto.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import { SITUACOES_DE_RELACIONAMENTO } from '$shared/pessoa';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let enviando = $state(false);

	// Os campos além do nome ficam recolhidos: RN-05 diz que só o nome é
	// obrigatório, e um formulário longo em pé na porta do PG não é preenchido.
	// Se a tentativa anterior trouxe erro ou valor num campo de dentro, abre.
	const temDadoExtra = $derived(
		!!(
			form?.valores &&
			['birthDate', 'phone', 'whatsapp', 'email', 'relationshipStatus', 'notes'].some(
				(c) => form.valores?.[c]
			)
		)
	);

	let expandido = $state(false);
	$effect(() => {
		if (temDadoExtra) expandido = true;
	});

	const valor = (campo: string) => form?.valores?.[campo] ?? '';
	const erroDe = (campo: string) => form?.erros?.[campo];
	const bloqueado = (campo: string) => form?.camposBloqueados?.includes(campo) ?? false;
</script>

<svelte:head>
	<title>Cadastrar pessoa · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/pessoas" titulo="Cadastrar pessoa" />

<main class="conteudo">
	{#if form?.erro}
		<Aviso tom="erro" titulo="Não deu para cadastrar">{form.erro}</Aviso>
	{/if}

	{#if form?.avisoDeDuplicata}
		<Aviso tom="aviso" titulo="Confira antes de continuar">
			{form.avisoDeDuplicata}
			{#if form.duplicatas?.length}
				<ul class="duplicatas">
					{#each form.duplicatas as d (d.id)}
						<li><a href="/pessoas/{d.id}">{d.fullName}</a></li>
					{/each}
				</ul>
			{/if}
		</Aviso>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			enviando = true;
			return async ({ update }) => {
				await update();
				enviando = false;
			};
		}}
	>
		<Campo
			id="fullName"
			rotulo="Nome completo"
			valor={valor('fullName')}
			erro={erroDe('fullName')}
			autocomplete="name"
			obrigatorio
			ajuda="É o único campo obrigatório. O resto você completa depois."
		/>

		{#if data.grupos.length > 0}
			<Seletor
				id="grupoId"
				rotulo="Grupo"
				opcoes={data.grupos}
				valor={valor('grupoId') || data.grupoSugerido}
				erro={erroDe('grupoId')}
				vazio={data.exigeGrupo ? 'Escolha o grupo' : 'Sem grupo por enquanto'}
				obrigatorio={data.exigeGrupo}
				ajuda={data.exigeGrupo
					? 'A pessoa entra no seu grupo — e só assim você continua vendo o cadastro.'
					: undefined}
			/>
		{/if}

		<!--
			`details` nativo: abre e fecha sem JavaScript, mantendo o cadastro
			completo acessível mesmo quando o script não carrega.
		-->
		<details open={expandido}>
			<summary>Adicionar mais informações</summary>

			<div class="extras">
				<Campo
					id="birthDate"
					rotulo="Data de nascimento"
					tipo="date"
					valor={valor('birthDate')}
					erro={erroDe('birthDate')}
					ajuda="Define como o sistema trata os dados desta pessoa."
				/>

				{#if bloqueado('phone') || bloqueado('email')}
					<Aviso tom="info">
						Enquanto a data de nascimento indicar menor de idade sem responsável vinculado, o
						cadastro guarda apenas o nome.
					</Aviso>
				{/if}

				<Campo
					id="phone"
					rotulo="Telefone"
					tipo="tel"
					valor={valor('phone')}
					erro={erroDe('phone')}
					autocomplete="tel"
					inputmode="tel"
				/>

				<Campo
					id="whatsapp"
					rotulo="WhatsApp"
					tipo="tel"
					valor={valor('whatsapp')}
					erro={erroDe('whatsapp')}
					inputmode="tel"
					ajuda="Deixe em branco se for o mesmo do telefone."
				/>

				<Campo
					id="email"
					rotulo="E-mail"
					tipo="email"
					valor={valor('email')}
					erro={erroDe('email')}
					autocomplete="email"
					inputmode="email"
				/>

				<Seletor
					id="relationshipStatus"
					rotulo="Situação de relacionamento"
					valor={valor('relationshipStatus')}
					erro={erroDe('relationshipStatus')}
					opcoes={SITUACOES_DE_RELACIONAMENTO.map((s) => ({ valor: s.valor, rotulo: s.rotulo }))}
					vazio="Prefiro não informar"
				/>

				<Seletor
					id="statusId"
					rotulo="Estágio"
					valor={valor('statusId')}
					erro={erroDe('statusId')}
					opcoes={data.estagios.map((e) => ({ valor: e.valor, rotulo: e.rotulo }))}
					vazio="Começar como visitante"
					ajuda="Dá para mudar a qualquer momento, e a mudança fica registrada."
				/>

				<Campo
					id="joinedAt"
					rotulo="Desde quando participa"
					tipo="date"
					valor={valor('joinedAt')}
					erro={erroDe('joinedAt')}
				/>

				<AreaDeTexto
					id="notes"
					rotulo="Observações"
					valor={valor('notes')}
					erro={erroDe('notes')}
					ajuda="O que ajuda a acolher melhor. Evite anotar o que você não diria à pessoa."
				/>
			</div>
		</details>

		{#if form?.duplicatas}
			<!-- Segundo envio: a pessoa viu o aviso e decidiu continuar. -->
			<input type="hidden" name="confirmar_duplicata" value="sim" />
		{/if}

		<Botao tipo="submit" largura="cheia" carregando={enviando}>
			{form?.duplicatas ? 'Cadastrar mesmo assim' : 'Cadastrar'}
		</Botao>
	</form>
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	details {
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		background: var(--cor-superficie);
	}

	summary {
		padding: var(--esp-3);
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
		cursor: pointer;
	}

	summary:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: -2px;
		border-radius: var(--raio);
	}

	.extras {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
		padding: 0 var(--esp-3) var(--esp-4);
	}

	.duplicatas {
		margin: var(--esp-2) 0 0;
		padding-left: var(--esp-4);
	}

	.duplicatas a {
		color: var(--cor-marca);
	}
</style>
