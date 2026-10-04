/**
 * Destino de retorno seguro, para "confirme sua senha e volte para onde estava".
 *
 * O destino vem da URL (`?voltar=`), e a URL é de quem a escreve. Sem esta
 * checagem, um link como `/conta/confirmar?voltar=https://golpe.example`
 * usaria a tela de senha DOS EAGLES para mandar alguém a um site falso logo
 * depois de digitar a senha — o momento exato em que a pessoa confia.
 *
 * Aceita só caminhos internos. Recusa, entre outros:
 *   - esquema explícito         `https://…`, `javascript:…`
 *   - protocolo relativo        `//golpe.example` (o navegador trata como outro site)
 *   - barra invertida           `/\golpe.example` (alguns navegadores a viram em `//`)
 *   - caracteres de controle    quebra de linha, tabulação
 */
export function destinoInterno(valor: string | null | undefined, padrao = '/inicio'): string {
	if (!valor) return padrao;
	if (!valor.startsWith('/')) return padrao;
	if (valor.startsWith('//') || valor.startsWith('/\\')) return padrao;
	if (/[\u0000-\u001f\u007f\\]/.test(valor)) return padrao;
	return valor;
}
