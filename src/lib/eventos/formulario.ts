/**
 * Lógica pura do formulário de evento (criar e editar).
 *
 * Fica fora do componente para ser testável sem navegador. A validação aqui é
 * só cortesia: quem decide é o servidor (`src/lib/server/eventos/regras.ts`),
 * e as mensagens precisam bater com as dele para a pessoa não ver duas versões
 * do mesmo erro.
 */

/** `confirma`: a resposta conta como "vou"? (ver `$shared/rsvp`). */
export type OpcaoRsvp = { key: string; label: string; confirma?: boolean };

export type DadosFormulario = {
	title: string;
	eventTypeId: string;
	/** '' = equipe toda (sem PG). */
	groupId: string;
	/** Valor de `<input type="datetime-local">`, na hora local do aparelho. */
	inicio: string;
	fim: string;
	location: string;
	/** '' = padrão (quem cria) ao criar; sem responsável ao editar. */
	responsiblePersonId: string;
	description: string;
	rsvpEnabled: boolean;
	rsvpOptions: OpcaoRsvp[];
};

export type ErrosFormulario = Partial<Record<keyof DadosFormulario, string>>;

/** As mesmas opções que o banco põe quando o evento é criado sem nenhuma. */
export const OPCOES_PADRAO: OpcaoRsvp[] = [
	{ key: 'confirmado', label: 'Confirmado' },
	{ key: 'talvez', label: 'Talvez' },
	{ key: 'nao_vou', label: 'Não vou' },
	{ key: 'atrasado', label: 'Chegarei atrasado' },
	{ key: 'convidado', label: 'Vou levar convidado' }
];

const dois = (n: number) => String(n).padStart(2, '0');

/** ISO (UTC) → valor de `datetime-local` na hora local. '' se não houver data. */
export function paraInputLocal(iso: string | Date | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return (
		`${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}` +
		`T${dois(d.getHours())}:${dois(d.getMinutes())}`
	);
}

/** Valor de `datetime-local` (hora local) → ISO em UTC. null se vazio ou inválido. */
export function deInputLocal(valor: string): string | null {
	if (!valor) return null;
	const d = new Date(valor);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Chave estável para uma opção nova, derivada do rótulo: "Vou de carona" →
 * `vou_de_carona`. A chave é o que fica gravado nas respostas; o rótulo pode
 * mudar depois sem quebrar o histórico.
 */
export function gerarChave(rotulo: string, existentes: readonly string[]): string {
	const base =
		rotulo
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40) || 'opcao';

	let chave = base;
	for (let n = 2; existentes.includes(chave); n++) chave = `${base}_${n}`;
	return chave;
}

export function validar(
	dados: DadosFormulario,
	contexto: { podeSemGrupo: boolean }
): ErrosFormulario {
	const erros: ErrosFormulario = {};

	if (!dados.title.trim()) erros.title = 'Dê um nome ao evento.';
	if (!dados.eventTypeId) erros.eventTypeId = 'Escolha o tipo do evento.';
	if (!dados.groupId && !contexto.podeSemGrupo) {
		erros.groupId = 'Escolha o subgrupo deste evento.';
	}

	const inicio = deInputLocal(dados.inicio);
	if (!inicio) erros.inicio = 'Informe quando o evento começa.';

	const fim = deInputLocal(dados.fim);
	if (dados.fim && !fim) erros.fim = 'Data de término inválida.';
	if (inicio && fim && fim <= inicio) {
		erros.fim = 'O término do evento deve ser posterior ao início.';
	}

	if (dados.rsvpEnabled) {
		const rotulos = dados.rsvpOptions.map((o) => o.label.trim());
		if (rotulos.length === 0) {
			erros.rsvpOptions = 'O evento precisa de pelo menos uma opção de resposta.';
		} else if (rotulos.some((r) => !r)) {
			erros.rsvpOptions = 'Toda opção de resposta precisa de um texto.';
		} else if (new Set(rotulos.map((r) => r.toLowerCase())).size !== rotulos.length) {
			erros.rsvpOptions = 'Há opções de resposta repetidas.';
		}
	}

	return erros;
}

/**
 * Corpo para a API. Ao criar, campos vazios são omitidos (o servidor aplica
 * os padrões). Ao editar, vazio vira `null`, que é como se apaga um campo.
 */
export function paraApi(dados: DadosFormulario, modo: 'criar' | 'editar'): Record<string, unknown> {
	const vazio = modo === 'criar' ? undefined : null;
	const texto = (v: string) => (v.trim() ? v.trim() : vazio);

	return {
		title: dados.title.trim(),
		eventTypeId: dados.eventTypeId,
		groupId: dados.groupId || vazio,
		startsAt: deInputLocal(dados.inicio),
		endsAt: deInputLocal(dados.fim) ?? vazio,
		location: texto(dados.location),
		description: texto(dados.description),
		responsiblePersonId: dados.responsiblePersonId || vazio,
		rsvpEnabled: dados.rsvpEnabled,
		// Sem confirmação e sem opções: não mexe nas opções guardadas (o servidor
		// exige ao menos uma, e elas voltam a valer se a confirmação for religada).
		rsvpOptions:
			dados.rsvpOptions.length > 0
				? dados.rsvpOptions.map((o) => ({
						key: o.key,
						label: o.label.trim(),
						...(o.confirma !== undefined && { confirma: o.confirma })
					}))
				: undefined
	};
}
