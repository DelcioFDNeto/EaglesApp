/**
 * Telefone brasileiro como identificador de login e destino do WhatsApp.
 *
 * Uma forma só no banco: DDD + número, só dígitos (10 ou 11), sem o 55.
 * Assim "+55 (91) 99999-0001", "91 99999 0001" e "91999990001" são a mesma
 * pessoa no login — muitos membros entram por telefone, não por e-mail.
 */

/** Só dígitos, sem o código do país. Não valida o tamanho. */
export function normalizarTelefone(valor: string): string {
	const digitos = valor.replace(/\D/g, '');
	return digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
}

/** DDD + número, com 10 (fixo) ou 11 (celular) dígitos. */
export function telefoneValido(valor: string): boolean {
	return /^[1-9]\d\d{8,9}$/.test(normalizarTelefone(valor));
}

/** Link do WhatsApp com a mensagem pronta; sem telefone, abre a escolha de contato. */
export function linkWhatsApp(texto: string, telefone?: string | null): string {
	const destino = telefone ? `55${normalizarTelefone(telefone)}` : '';
	return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
}

/** (91) 99999-0001 — para exibir. */
export function formatarTelefone(valor: string): string {
	const d = normalizarTelefone(valor);
	if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
	if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
	return valor;
}
