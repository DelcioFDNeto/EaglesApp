<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import AreaDeTexto from '$ui/AreaDeTexto.svelte';
	import CamposDoConvite from '../CamposDoConvite.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const valores = $derived<Record<string, string>>(form?.valores ?? data.valores);
	const erros = $derived<Record<string, string | undefined>>(form?.erros ?? {});
	const v = (campo: string) => valores[campo] ?? '';

	let enviando = $state(false);

	const INTERVALOS = [
		{ valor: '1', rotulo: 'Toda semana' },
		{ valor: '2', rotulo: 'A cada 2 semanas' },
		{ valor: '3', rotulo: 'A cada 3 semanas' },
		{ valor: '4', rotulo: 'A cada 4 semanas' }
	];
</script>

<svelte:head>
	<title>Novo evento · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/agenda" />

<main class="conteudo">
	<h1>Novo evento</h1>

	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			enviando = true;
			return async ({ update }) => {
				await update({ reset: false });
				enviando = false;
			};
		}}
	>
		<Seletor
			id="tipoId"
			rotulo="Tipo"
			opcoes={data.tipos}
			valor={v('tipoId')}
			erro={erros.tipoId}
			vazio="Escolha o tipo"
			obrigatorio
		/>

		<Campo id="titulo" rotulo="Título" valor={v('titulo')} erro={erros.titulo} obrigatorio />

		<Seletor
			id="grupoId"
			rotulo="Grupo"
			opcoes={data.grupos}
			valor={v('grupoId')}
			erro={erros.grupoId}
			vazio={data.podeCriarEventoGeral ? 'Nenhum — evento da equipe' : undefined}
			ajuda="O grupo que realiza o evento. Quem cuida do grupo pode editá-lo."
		/>

		<fieldset class="quando">
			<legend>Quando</legend>
			<Campo
				id="data"
				rotulo="Data"
				tipo="date"
				valor={v('data')}
				erro={erros.data}
				min={data.hoje}
				obrigatorio
			/>
			<div class="lado-a-lado">
				<Campo
					id="horaInicio"
					rotulo="Começa"
					tipo="time"
					valor={v('horaInicio')}
					erro={erros.horaInicio}
					obrigatorio
				/>
				<Campo
					id="horaFim"
					rotulo="Termina"
					tipo="time"
					valor={v('horaFim')}
					erro={erros.horaFim}
				/>
			</div>
		</fieldset>

		<fieldset class="recorrencia">
			<legend>Repete?</legend>
			<label class="opcao">
				<input
					type="radio"
					name="recorrencia"
					value="unica"
					checked={v('recorrencia') !== 'semanal'}
				/>
				<span>Acontece uma vez</span>
			</label>
			<label class="opcao">
				<input
					type="radio"
					name="recorrencia"
					value="semanal"
					checked={v('recorrencia') === 'semanal'}
				/>
				<span>Toda semana, no mesmo dia e horário <small>— o encontro do PG</small></span>
			</label>
			<div class="semanal">
				<Seletor
					id="intervaloSemanas"
					rotulo="Frequência"
					opcoes={INTERVALOS}
					valor={v('intervaloSemanas') || '1'}
					erro={erros.intervaloSemanas}
				/>
				<Campo
					id="terminaEm"
					rotulo="Até (opcional)"
					tipo="date"
					valor={v('terminaEm')}
					erro={erros.terminaEm}
					ajuda="Sem data, continua até ser encerrado."
				/>
			</div>
		</fieldset>

		<Campo id="local" rotulo="Local" valor={v('local')} erro={erros.local} />

		<CamposDoConvite
			grupos={data.grupos}
			pessoas={data.pessoas}
			podeConvidarEquipe={data.podeConvidarEquipe}
			valores={form?.convite ?? { convite: 'padrao', grupos: [], pessoas: [] }}
			erro={erros.convite}
		/>

		<!-- `details` nativo: abre e fecha sem JavaScript. -->
		<details open={!!(v('descricao') || v('responsavelId') || v('dataFim'))}>
			<summary>Mais detalhes</summary>
			<div class="extras">
				<AreaDeTexto
					id="descricao"
					rotulo="Descrição"
					valor={v('descricao')}
					erro={erros.descricao}
					linhas={3}
				/>
				<Seletor
					id="responsavelId"
					rotulo="Responsável"
					opcoes={data.pessoas}
					valor={v('responsavelId')}
					erro={erros.responsavelId}
					vazio="Ninguém em especial"
				/>
				<Campo
					id="dataFim"
					rotulo="Termina em outro dia?"
					tipo="date"
					valor={v('dataFim')}
					erro={erros.dataFim}
					ajuda="Para acampamento, retiro: a data do último dia."
				/>
			</div>
		</details>

		{#if data.podePublicar}
			<label class="publicar">
				<input
					type="checkbox"
					name="publicar"
					value="sim"
					checked={form ? v('publicar') === 'sim' : true}
				/>
				<span>
					Publicar agora
					<small>Desmarcado, fica como rascunho — só quem cuida da agenda vê.</small>
				</span>
			</label>
		{/if}

		<Botao tipo="submit" carregando={enviando}>Criar</Botao>
	</form>
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	h1 {
		font-size: var(--texto-2xl);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	legend {
		font-size: var(--texto-sm);
		font-weight: 600;
		margin-bottom: var(--esp-2);
	}

	.lado-a-lado {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-3);
	}

	.recorrencia {
		gap: var(--esp-2);
	}

	.opcao,
	.publicar {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		cursor: pointer;
	}

	.opcao input,
	.publicar input {
		width: 1.15rem;
		height: 1.15rem;
		margin-top: 0.2rem;
		accent-color: var(--cor-marca);
		flex: none;
	}

	.publicar span {
		display: flex;
		flex-direction: column;
		font-weight: 600;
	}

	small {
		font-size: var(--texto-sm);
		font-weight: 400;
		color: var(--cor-texto-3);
	}

	.semanal {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-3);
		padding: var(--esp-3);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		background: var(--cor-superficie-2);
	}

	.opcao:has(input:focus-visible),
	.publicar:has(input:focus-visible) {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	details summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
	}

	.extras {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding-top: var(--esp-2);
	}
</style>
