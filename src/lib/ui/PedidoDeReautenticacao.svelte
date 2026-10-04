<script lang="ts">
	import { page } from '$app/state';
	import Aviso from './Aviso.svelte';
	import Botao from './Botao.svelte';
	import { REAUTH_WINDOW_MINUTES } from '$shared/sessao';

	/**
	 * Pede a senha ANTES do formulário de uma ação sensível (D-M03-3).
	 *
	 * Pedir depois — ao enviar — jogaria fora o que a pessoa acabou de marcar.
	 * O servidor continua recusando o envio sem reautenticação recente; este
	 * aviso só antecipa a pergunta.
	 */
	let { acao = 'alterar acessos' }: { acao?: string } = $props();

	const voltar = $derived(`${page.url.pathname}${page.url.search}`);
</script>

<Aviso tom="info" titulo="Confirme sua senha para continuar">
	Para {acao}, confirme sua senha. A confirmação vale por {REAUTH_WINDOW_MINUTES} minutos.
</Aviso>
<Botao href="/conta/confirmar?voltar={encodeURIComponent(voltar)}" variante="secundario">
	Confirmar senha
</Botao>
