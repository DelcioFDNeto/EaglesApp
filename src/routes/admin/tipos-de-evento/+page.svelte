<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import { CORES_DE_GRUPO } from '$shared/grupo';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const cores = CORES_DE_GRUPO.map((c) => ({ valor: c.valor, rotulo: c.rotulo }));
	const errosDe = (tipoId: string) => (form?.tipoId === tipoId ? (form?.erros ?? {}) : {});
</script>

<svelte:head>
	<title>Tipos de evento · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/mais" />

<main class="conteudo">
	<h1>Tipos de evento</h1>
	<p class="legenda">
		O tipo diz o que é o evento. Quem marca “encontro do grupo” é o tipo que o atalho de cada grupo
		usa para criar o encontro semanal — só um pode ter essa marca.
	</p>

	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}
	{#if form?.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}

	<ul class="lista">
		{#each data.tipos as t (t.id)}
			{@const erros = errosDe(t.id)}
			<li class:arquivado={t.arquivado} style={t.cor ? `--cor-tipo: ${t.cor}` : undefined}>
				<div class="cabecalho">
					<span class="ponto" aria-hidden="true"></span>
					<span class="nome">{t.nome}</span>
					{#if t.ehEncontroDoGrupo}<span class="selo">encontro do grupo</span>{/if}
					{#if t.arquivado}<span class="selo">arquivado</span>{/if}
					<span class="usos">{t.eventos} {t.eventos === 1 ? 'evento' : 'eventos'}</span>
				</div>

				<details open={form?.tipoId === t.id && !!form?.erros}>
					<summary>Editar</summary>
					<form method="POST" action="?/salvar" class="formulario" use:enhance>
						<input type="hidden" name="tipoId" value={t.id} />
						<Campo id="nome-{t.id}" name="nome" rotulo="Nome" valor={t.nome} erro={erros.nome} />
						<Seletor
							id="cor-{t.id}"
							name="cor"
							rotulo="Cor"
							opcoes={cores}
							valor={t.cor ?? ''}
							vazio="Sem cor"
							erro={erros.cor}
						/>
						<label class="caixa">
							<input
								type="checkbox"
								name="ehEncontroDoGrupo"
								value="sim"
								checked={t.ehEncontroDoGrupo}
							/>
							<span>É o encontro do grupo</span>
						</label>
						<Botao tipo="submit" variante="secundario">Salvar</Botao>
					</form>
				</details>

				<form method="POST" action="?/arquivar" use:enhance>
					<input type="hidden" name="tipoId" value={t.id} />
					<input type="hidden" name="arquivar" value={t.arquivado ? 'nao' : 'sim'} />
					<Botao tipo="submit" variante="texto">{t.arquivado ? 'Reativar' : 'Arquivar'}</Botao>
				</form>
			</li>
		{/each}
	</ul>

	<section class="cartao" aria-label="Novo tipo">
		<h2>Novo tipo</h2>
		<form method="POST" action="?/criar" class="formulario" use:enhance>
			<Campo
				id="nome"
				rotulo="Nome"
				valor={form?.tipoId === 'novo' ? (form?.valores?.nome ?? '') : ''}
				erro={errosDe('novo').nome}
			/>
			<Seletor id="cor" rotulo="Cor" opcoes={cores} vazio="Sem cor" erro={errosDe('novo').cor} />
			<label class="caixa">
				<input type="checkbox" name="ehEncontroDoGrupo" value="sim" />
				<span>É o encontro do grupo</span>
			</label>
			<Botao tipo="submit">Criar tipo</Botao>
		</form>
	</section>
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

	h1 {
		font-size: var(--texto-2xl);
	}

	h2 {
		font-size: var(--texto-lg);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	.lista {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.lista li {
		padding: var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-left: 4px solid var(--cor-tipo, var(--cor-linha-forte));
		border-radius: var(--raio);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.arquivado {
		opacity: 0.7;
	}

	.cabecalho {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
	}

	.ponto {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--cor-tipo, var(--cor-texto-3));
	}

	.nome {
		font-weight: 700;
	}

	.selo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
		border: 1px solid var(--cor-linha-forte);
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	.usos {
		margin-left: auto;
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	summary {
		cursor: pointer;
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
	}

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.formulario {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.caixa {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		cursor: pointer;
	}

	.caixa input {
		width: 1.15rem;
		height: 1.15rem;
		accent-color: var(--cor-marca);
	}
</style>
