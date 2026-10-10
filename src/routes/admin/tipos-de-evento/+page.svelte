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
	// Os ramos de `form` têm formatos diferentes; a tela os lê como dicionários.
	const errosDe = (tipoId: string): Record<string, string | undefined> =>
		form?.tipoId === tipoId ? (form?.erros ?? {}) : {};
	const valoresDe = (tipoId: string): Record<string, string> =>
		form?.tipoId === tipoId ? (form?.valores ?? {}) : {};

	const SIGNIFICADOS = [
		{ valor: 'sim', rotulo: 'Vai — conta como confirmação' },
		{ valor: 'talvez', rotulo: 'Talvez' },
		{ valor: 'nao', rotulo: 'Não vai' }
	];
	const SIGNIFICADO_CURTO: Record<string, string> = {
		sim: 'vai',
		talvez: 'talvez',
		nao: 'não vai'
	};
	const ativas = $derived(data.respostas.filter((r) => !r.arquivada));
	const valorDaResposta = (campo: string) => valoresDe('resposta')[campo] ?? '';
</script>

<svelte:head>
	<title>Tipos de evento · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/mais" />

<main class="conteudo">
	<h1>Tipos de evento</h1>
	<p class="legenda">
		O tipo diz o que é o evento. Quem marca “encontro do grupo” é o tipo que o atalho de cada grupo
		usa para criar o encontro semanal — só um pode ter essa marca. Tipo que não conta para a
		frequência (uma reunião de liderança, por exemplo) não entra na conta de ninguém.
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
					{#if !t.contaParaFrequencia}<span class="selo">fora da frequência</span>{/if}
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
						<label class="caixa">
							<input
								type="checkbox"
								name="contaParaFrequencia"
								value="sim"
								checked={t.contaParaFrequencia}
							/>
							<span>Conta para a frequência</span>
						</label>
						<fieldset class="respostas-do-tipo">
							<legend>Respostas oferecidas no “Você vai?”</legend>
							{#each ativas as r (r.id)}
								<label class="caixa">
									<input
										type="checkbox"
										name="respostas"
										value={r.id}
										checked={data.escolhas[t.id]?.includes(r.id)}
									/>
									<span>{r.texto}</span>
								</label>
							{/each}
							{#if erros.respostas}<p class="erro" role="alert">{erros.respostas}</p>{/if}
						</fieldset>
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
				valor={valoresDe('novo').nome ?? ''}
				erro={errosDe('novo').nome}
			/>
			<Seletor id="cor" rotulo="Cor" opcoes={cores} vazio="Sem cor" erro={errosDe('novo').cor} />
			<label class="caixa">
				<input type="checkbox" name="ehEncontroDoGrupo" value="sim" />
				<span>É o encontro do grupo</span>
			</label>
			<label class="caixa">
				<input type="checkbox" name="contaParaFrequencia" value="sim" checked />
				<span>Conta para a frequência</span>
			</label>
			<Botao tipo="submit">Criar tipo</Botao>
		</form>
	</section>

	<section class="cartao" aria-label="Respostas de presença">
		<h2>Respostas de presença</h2>
		<p class="legenda">
			O que cada pessoa pode responder no “Você vai?”. O texto é livre; o significado é o que os
			relatórios contam — renomear “Vou” não muda conta nenhuma.
		</p>
		<ul class="respostas">
			{#each data.respostas as r (r.id)}
				<li class:arquivado={r.arquivada}>
					<span class="nome">{r.texto}</span>
					<span class="selo">{SIGNIFICADO_CURTO[r.significado]}</span>
					{#if r.aceitaConvidados}<span class="selo">aceita convidados</span>{/if}
					{#if r.arquivada}<span class="selo">arquivada</span>{/if}
					<form method="POST" action="?/arquivarResposta" use:enhance>
						<input type="hidden" name="respostaId" value={r.id} />
						<input type="hidden" name="arquivar" value={r.arquivada ? 'nao' : 'sim'} />
						<Botao
							tipo="submit"
							variante="texto"
							aria-label="{r.arquivada ? 'Reativar' : 'Arquivar'} {r.texto}"
						>
							{r.arquivada ? 'Reativar' : 'Arquivar'}
						</Botao>
					</form>
				</li>
			{/each}
		</ul>

		<form method="POST" action="?/criarResposta" class="formulario" use:enhance>
			<h3>Nova resposta</h3>
			<Campo
				id="texto"
				rotulo="Texto"
				valor={valorDaResposta('texto')}
				erro={errosDe('resposta').texto}
				maxlength="40"
			/>
			<Seletor
				id="significado"
				rotulo="Significa"
				opcoes={SIGNIFICADOS}
				valor={valorDaResposta('significado') || 'sim'}
				erro={errosDe('resposta').significado}
			/>
			<label class="caixa">
				<input
					type="checkbox"
					name="aceitaConvidados"
					value="sim"
					checked={valorDaResposta('aceitaConvidados') === 'sim'}
				/>
				<span>Aceita convidados (“levo mais 2”) — só para quem vai</span>
			</label>
			<Botao tipo="submit" variante="secundario">Criar resposta</Botao>
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

	h3 {
		font-size: var(--texto-base);
	}

	.respostas-do-tipo {
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		padding: var(--esp-2) var(--esp-3);
		margin: 0;
		min-width: 0;
	}

	.respostas-do-tipo legend {
		font-size: var(--texto-sm);
		font-weight: 600;
		padding-inline: var(--esp-1);
	}

	.respostas {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.respostas li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-1) var(--esp-2);
		padding-block: var(--esp-1);
		border-top: 1px solid var(--cor-linha);
	}

	.respostas li:first-child {
		border-top: 0;
	}

	.respostas form {
		margin-left: auto;
	}

	.erro {
		font-size: var(--texto-sm);
		color: var(--cor-erro);
	}
</style>
