import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { consent, person, personRole, personStatusHistory } from '../../src/lib/server/db/schema';
import type { Actor } from '../../src/lib/server/policy/policy';
import { loadActor } from '../../src/lib/server/policy/actor';
import {
	atualizarPessoa,
	autocadastrarVisitante,
	criarPessoa,
	listarPessoas,
	removerPessoa,
	RegimeRestrito,
	verPessoa
} from '../../src/lib/server/modules/pessoas/pessoas';
import { mudarEstagio } from '../../src/lib/server/modules/pessoas/status';
import {
	consentimentosDe,
	registrarConsentimento
} from '../../src/lib/server/modules/pessoas/consentimento';
import { criarVinculo, vinculosDe } from '../../src/lib/server/modules/pessoas/relacoes';
import {
	duplicatasVisiveis,
	mensagemDeDuplicata,
	procurarPossiveisDuplicatas
} from '../../src/lib/server/modules/pessoas/duplicidade';
import { PolicyDenied } from '../../src/lib/server/policy/policy';

let ctx: BancoDeTeste;
let lider: Actor;
let membro: Actor;

/** Cria uma pessoa direto no banco e lhe dá um papel, para montar atores. */
async function pessoaCom(papel: string): Promise<Actor> {
	const [p] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: `Ator ${papel} ${Math.random()}` })
		.returning({ id: person.id });

	await ctx.db.insert(personRole).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: papel === 'lider' ? 'global' : 'self',
		scopeId: null
	});

	const actor = await loadActor(ctx.db, p!.id);
	if (!actor) throw new Error('ator não carregou');
	return actor;
}

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
	lider = await pessoaCom('lider');
	membro = await pessoaCom('membro');
});

afterAll(async () => {
	await ctx.fechar();
});

describe('cadastro progressivo (RN-05)', () => {
	it('cria pessoa só com o nome', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Beatriz Almeida',
			birthDate: null,
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const detalhe = await verPessoa(ctx.db, lider, id);
		expect(detalhe?.fullName).toBe('Beatriz Almeida');
	});

	it('atribui o estágio padrão e já grava a primeira linha do histórico (RN-04)', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Carlos Eduardo Pinto',
			birthDate: '1998-04-10',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const detalhe = await verPessoa(ctx.db, lider, id);
		expect(detalhe?.statusId).toBe(ctx.estagios.visitante);

		const historico = await ctx.db
			.select()
			.from(personStatusHistory)
			.where(eq(personStatusHistory.personId, id));

		expect(historico).toHaveLength(1);
		expect(historico[0]!.fromStatusId).toBeNull();
		expect(historico[0]!.toStatusId).toBe(ctx.estagios.visitante);
	});

	it('a coluna gerada de busca acompanha o nome, sem acento', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Ângela Conceição',
			birthDate: null,
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const [linha] = await ctx.db
			.select({ n: person.fullNameNormalized })
			.from(person)
			.where(eq(person.id, id));

		expect(linha!.n).toBe('angela conceicao');
	});
});

describe('regime de dados na escrita (RN-30)', () => {
	const semDataDeNascimento = {
		fullName: 'Menor Sem Data',
		birthDate: null,
		phone: '11987654321',
		whatsapp: null,
		email: null,
		relationshipStatus: null,
		joinedAt: null,
		notes: null,
		statusId: null
	};

	it('RECUSA gravar contato quando a idade é desconhecida', async () => {
		await expect(criarPessoa(ctx.db, lider, semDataDeNascimento)).rejects.toThrow(RegimeRestrito);
	});

	it('RECUSA gravar contato de menor de idade', async () => {
		const anoDeMenor = new Date().getFullYear() - 16;
		await expect(
			criarPessoa(ctx.db, lider, {
				...semDataDeNascimento,
				fullName: 'Adolescente Silva',
				birthDate: `${anoDeMenor}-01-01`
			})
		).rejects.toThrow(RegimeRestrito);
	});

	it('a recusa diz QUAIS campos foram bloqueados', async () => {
		try {
			await criarPessoa(ctx.db, lider, {
				...semDataDeNascimento,
				fullName: 'Outro Sem Data',
				notes: 'algo'
			});
			expect.unreachable('deveria ter recusado');
		} catch (erro) {
			expect(erro).toBeInstanceOf(RegimeRestrito);
			expect((erro as RegimeRestrito).campos).toEqual(expect.arrayContaining(['phone', 'notes']));
		}
	});

	it('ACEITA contato de maior de idade sem consentimento registrado', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			...semDataDeNascimento,
			fullName: 'Adulta Ferreira',
			birthDate: '1990-02-02'
		});
		const detalhe = await verPessoa(ctx.db, lider, id);
		expect(detalhe?.sensiveis?.phone).toBe('11987654321');
	});

	it('menor com responsável vinculado E consentimento pode ter contato', async () => {
		const anoDeMenor = new Date().getFullYear() - 17;

		const menorId = await criarPessoa(ctx.db, lider, {
			fullName: 'Jovem Ribeiro',
			birthDate: `${anoDeMenor}-03-03`,
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const responsavelId = await criarPessoa(ctx.db, lider, {
			fullName: 'Marta Ribeiro',
			birthDate: '1980-01-01',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		// Sem o vínculo e o consentimento, continua recusando.
		await expect(atualizarPessoa(ctx.db, lider, menorId, { phone: '11999998888' })).rejects.toThrow(
			RegimeRestrito
		);

		await criarVinculo(ctx.db, lider, {
			pessoaId: responsavelId,
			outraPessoaId: menorId,
			tipo: 'responsavel_legal'
		});

		await registrarConsentimento(ctx.db, {
			personId: menorId,
			kind: 'dados_cadastrais',
			granted: true,
			grantedByPersonId: responsavelId,
			recordedByPersonId: lider.personId,
			evidence: 'Termo assinado em papel',
			teamId: ctx.teamId
		});

		await atualizarPessoa(ctx.db, lider, menorId, { phone: '11999998888' });

		const detalhe = await verPessoa(ctx.db, lider, menorId);
		expect(detalhe?.sensiveis?.phone).toBe('11999998888');
		expect(detalhe?.regime.restrito).toBe(false);
	});
});

describe('consentimento é append-only (ADR 0003)', () => {
	it('revogar cria linha nova e APAGA o contato (RN-34)', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Renata Cardoso',
			birthDate: '1995-05-05',
			phone: '11911112222',
			whatsapp: null,
			email: 'renata@exemplo.test',
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await registrarConsentimento(ctx.db, {
			personId: id,
			kind: 'dados_cadastrais',
			granted: true,
			recordedByPersonId: lider.personId,
			teamId: ctx.teamId
		});

		await registrarConsentimento(ctx.db, {
			personId: id,
			kind: 'dados_cadastrais',
			granted: false,
			recordedByPersonId: lider.personId,
			teamId: ctx.teamId
		});

		const linhas = await ctx.db.select().from(consent).where(eq(consent.personId, id));
		expect(linhas, 'as duas linhas precisam continuar existindo').toHaveLength(2);

		const estado = await consentimentosDe(ctx.db, id);
		expect(estado.dados_cadastrais).toBe(false);

		const detalhe = await verPessoa(ctx.db, lider, id);
		expect(detalhe?.sensiveis?.phone, 'revogar remove o dado, não apenas oculta').toBeNull();
		expect(detalhe?.sensiveis?.email).toBeNull();
	});

	it('o banco RECUSA update numa linha de consentimento', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Imutável Teste',
			birthDate: '1990-01-01',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await registrarConsentimento(ctx.db, {
			personId: id,
			kind: 'foto',
			granted: true,
			teamId: ctx.teamId
		});

		await expect(
			ctx.db.update(consent).set({ granted: false }).where(eq(consent.personId, id))
		).rejects.toThrow(/append-only/i);
	});

	it('o banco RECUSA delete numa linha de consentimento', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Indelével Teste',
			birthDate: '1990-01-01',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await registrarConsentimento(ctx.db, {
			personId: id,
			kind: 'uso_ia',
			granted: true,
			teamId: ctx.teamId
		});

		await expect(ctx.db.delete(consent).where(eq(consent.personId, id))).rejects.toThrow(
			/append-only/i
		);
	});
});

describe('jornada (RN-02, RN-03, RN-04)', () => {
	it('mudar de estágio grava o de onde veio, o para onde foi e o motivo', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Jornada Completa',
			birthDate: '1997-07-07',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await mudarEstagio(ctx.db, {
			personId: id,
			paraEstagioId: ctx.estagios.participante_recorrente!,
			porPersonId: lider.personId,
			motivo: 'Vem toda semana',
			teamId: ctx.teamId
		});

		const historico = await ctx.db
			.select()
			.from(personStatusHistory)
			.where(eq(personStatusHistory.personId, id));

		expect(historico).toHaveLength(2);
		const ultima = historico.find((h) => h.toStatusId === ctx.estagios.participante_recorrente);
		expect(ultima?.fromStatusId).toBe(ctx.estagios.visitante);
		expect(ultima?.reason).toBe('Vem toda semana');
	});

	it('mudar para o estágio em que já está não gera linha de histórico', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Sem Movimento',
			birthDate: '1997-07-07',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await mudarEstagio(ctx.db, {
			personId: id,
			paraEstagioId: ctx.estagios.visitante!,
			porPersonId: lider.personId,
			teamId: ctx.teamId
		});

		const historico = await ctx.db
			.select()
			.from(personStatusHistory)
			.where(eq(personStatusHistory.personId, id));

		expect(historico).toHaveLength(1);
	});

	it('o banco RECUSA reescrever o histórico de estágio', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Historico Imutavel',
			birthDate: '1997-07-07',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await expect(
			ctx.db
				.update(personStatusHistory)
				.set({ reason: 'reescrito' })
				.where(eq(personStatusHistory.personId, id))
		).rejects.toThrow(/append-only/i);
	});
});

describe('permissões (RN-08, RN-32)', () => {
	it('membro NÃO vê o contato de outra pessoa', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Contato Protegido',
			birthDate: '1993-03-03',
			phone: '11955554444',
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const comoMembro = await verPessoa(ctx.db, membro, id);
		expect(comoMembro?.fullName).toBe('Contato Protegido');
		expect(comoMembro?.sensiveis, 'membro não tem person.view_sensitive').toBeNull();

		const comoLider = await verPessoa(ctx.db, lider, id);
		expect(comoLider?.sensiveis?.phone).toBe('11955554444');
	});

	it('membro vê o PRÓPRIO contato sem precisar de view_sensitive', async () => {
		const detalhe = await verPessoa(ctx.db, membro, membro.personId);
		expect(detalhe?.sensiveis).not.toBeNull();
	});

	it('a listagem esconde o telefone de quem não pode vê-lo', async () => {
		const doMembro = await listarPessoas(ctx.db, membro);
		expect(doMembro.every((p) => p.phone === null)).toBe(true);

		const doLider = await listarPessoas(ctx.db, lider);
		expect(doLider.some((p) => p.phone !== null)).toBe(true);
	});

	it('a data de nascimento exata vai junto com o contato — a idade, não', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Nascimento Protegido',
			birthDate: '1995-06-15',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});
		const comoMembro = await verPessoa(ctx.db, membro, id);
		expect(comoMembro?.birthDate, 'nem na página, nem escondida no HTML').toBeNull();
		expect(comoMembro?.idadeAnos).toBeGreaterThan(20);
		expect((await verPessoa(ctx.db, lider, id))?.birthDate).toBe('1995-06-15');
	});

	it('quem edita sem ver dados sensíveis não os apaga — nem os escreve (varredura)', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Contato Que Fica',
			birthDate: '1990-02-02',
			phone: '11944443333',
			whatsapp: null,
			email: 'fica@eagles.test',
			relationshipStatus: null,
			joinedAt: null,
			notes: 'observação da liderança',
			statusId: null
		});
		// Um papel personalizado possível: edita cadastro, mas não vê contato.
		const editor: Actor = {
			personId: membro.personId,
			teamId: ctx.teamId,
			assignments: [
				{
					roleKey: 'secretaria',
					scopeType: 'global',
					scopeId: null,
					permissions: new Set(['person.view', 'person.update'] as const)
				}
			]
		};

		await atualizarPessoa(ctx.db, editor, id, { fullName: 'Contato Que Ficou' });
		const [gravada] = await ctx.db.select().from(person).where(eq(person.id, id));
		expect(gravada).toMatchObject({
			fullName: 'Contato Que Ficou',
			phone: '11944443333',
			email: 'fica@eagles.test',
			notes: 'observação da liderança',
			birthDate: '1990-02-02'
		});

		await expect(atualizarPessoa(ctx.db, editor, id, { phone: null })).rejects.toThrow(
			PolicyDenied
		);
		await expect(atualizarPessoa(ctx.db, editor, id, { birthDate: '2001-01-01' })).rejects.toThrow(
			PolicyDenied
		);
	});

	it('membro NÃO pode criar pessoa', async () => {
		await expect(
			criarPessoa(ctx.db, membro, {
				fullName: 'Não Deveria Existir',
				birthDate: null,
				phone: null,
				whatsapp: null,
				email: null,
				relationshipStatus: null,
				joinedAt: null,
				notes: null,
				statusId: null
			})
		).rejects.toThrow(PolicyDenied);
	});

	it('membro NÃO pode remover pessoa, e ninguém remove a si mesmo', async () => {
		const id = await criarPessoa(ctx.db, lider, {
			fullName: 'Alvo de Remoção',
			birthDate: null,
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		await expect(removerPessoa(ctx.db, membro, id)).rejects.toThrow(PolicyDenied);
		await expect(removerPessoa(ctx.db, lider, lider.personId)).rejects.toThrow(/próprio cadastro/i);

		await removerPessoa(ctx.db, lider, id);
		expect(await verPessoa(ctx.db, lider, id), 'remoção é lógica e some da leitura').toBeNull();
	});
});

describe('vínculos', () => {
	it('vínculo simétrico é UMA linha, visível dos dois lados', async () => {
		const base = {
			birthDate: '1994-04-04',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		};

		const a = await criarPessoa(ctx.db, lider, { ...base, fullName: 'Irmã Mais Velha' });
		const b = await criarPessoa(ctx.db, lider, { ...base, fullName: 'Irmão Mais Novo' });

		await criarVinculo(ctx.db, lider, { pessoaId: a, outraPessoaId: b, tipo: 'irmao' });

		const deA = await vinculosDe(ctx.db, a);
		const deB = await vinculosDe(ctx.db, b);

		expect(deA).toHaveLength(1);
		expect(deB).toHaveLength(1);
		expect(deA[0]!.outraPessoaNome).toBe('Irmão Mais Novo');
		expect(deB[0]!.outraPessoaNome).toBe('Irmã Mais Velha');
	});

	it('criar o mesmo vínculo duas vezes não duplica', async () => {
		const base = {
			birthDate: '1994-04-04',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		};

		const a = await criarPessoa(ctx.db, lider, { ...base, fullName: 'Cônjuge Um' });
		const b = await criarPessoa(ctx.db, lider, { ...base, fullName: 'Cônjuge Dois' });

		await criarVinculo(ctx.db, lider, { pessoaId: a, outraPessoaId: b, tipo: 'conjuge' });
		// Ordem invertida: a ordenação canônica precisa reconhecer o mesmo par.
		await criarVinculo(ctx.db, lider, { pessoaId: b, outraPessoaId: a, tipo: 'conjuge' });

		expect(await vinculosDe(ctx.db, a)).toHaveLength(1);
	});

	it('o banco RECUSA vincular alguém a si mesmo', async () => {
		const [p] = await ctx.db
			.insert(person)
			.values({ teamId: ctx.teamId, fullName: 'Sozinho Teste' })
			.returning({ id: person.id });

		await expect(
			ctx.db.execute(
				sql`insert into person_relation (id, team_id, person_a, person_b, relation_type)
					values (gen_random_uuid(), ${ctx.teamId}, ${p!.id}, ${p!.id}, 'irmao')`
			)
		).rejects.toThrow();
	});
});

describe('duplicidade avisa, nunca bloqueia (RF-02.6)', () => {
	it('encontra por nome igual, ignorando acento e caixa', async () => {
		await criarPessoa(ctx.db, lider, {
			fullName: 'Luís Fernando Braga',
			birthDate: '1992-02-02',
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const achados = await procurarPossiveisDuplicatas(ctx.db, ctx.teamId, {
			fullName: 'LUIS FERNANDO BRAGA'
		});

		expect(achados).toHaveLength(1);
		expect(achados[0]!.motivo).toBe('nome');
	});

	it('encontra por telefone, mesmo com máscara diferente', async () => {
		await criarPessoa(ctx.db, lider, {
			fullName: 'Telefone Repetido',
			birthDate: '1992-02-02',
			phone: '11933332222',
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			joinedAt: null,
			notes: null,
			statusId: null
		});

		const achados = await procurarPossiveisDuplicatas(ctx.db, ctx.teamId, {
			fullName: 'Outra Pessoa Qualquer',
			phone: '(11) 93333-2222'
		});

		expect(achados.some((a) => a.motivo === 'telefone')).toBe(true);

		// Quem não vê o contato daquela pessoa recebe o aviso, mas não o NOME
		// do dono do número — senão o formulário vira um "de quem é este número?".
		const { visiveis, ocultas } = await duplicatasVisiveis(ctx.db, membro, achados);
		expect(visiveis).toEqual([]);
		expect(ocultas).toBe(1);
		const aviso = mensagemDeDuplicata(visiveis, ocultas);
		expect(aviso).toMatch(/já está no cadastro de outra pessoa/);
		expect(aviso).not.toContain('Telefone Repetido');

		expect((await duplicatasVisiveis(ctx.db, lider, achados)).visiveis).toHaveLength(1);
	});

	it('não acusa duplicata de nomes diferentes', async () => {
		const achados = await procurarPossiveisDuplicatas(ctx.db, ctx.teamId, {
			fullName: 'Nome Absolutamente Inédito Aqui'
		});
		expect(achados).toEqual([]);
	});
});

describe('autocadastro de visitante (RF-02.3)', () => {
	it('cria a pessoa com origem registrada e sem conta de acesso', async () => {
		const { id } = await autocadastrarVisitante(ctx.db, ctx.teamId, {
			fullName: 'Visitante Espontâneo',
			birthDate: '1999-09-09',
			phone: '11922221111',
			nomeDoResponsavel: null,
			telefoneDoResponsavel: null
		});

		const detalhe = await verPessoa(ctx.db, lider, id);
		expect(detalhe?.source).toBe('autocadastro');
		expect(detalhe?.statusId).toBe(ctx.estagios.visitante);
		expect(detalhe?.sensiveis?.phone).toBe('11922221111');
	});

	it('menor de idade NÃO tem o próprio contato guardado', async () => {
		const anoDeMenor = new Date().getFullYear() - 16;

		const { id, ehMenor } = await autocadastrarVisitante(ctx.db, ctx.teamId, {
			fullName: 'Visitante Adolescente',
			birthDate: `${anoDeMenor}-06-06`,
			phone: '11911110000',
			nomeDoResponsavel: 'Responsável Informado',
			telefoneDoResponsavel: '11900001111'
		});

		expect(ehMenor).toBe(true);

		const [linha] = await ctx.db.select().from(person).where(eq(person.id, id));
		expect(linha!.phone, 'menor não informa o próprio contato num formulário público').toBeNull();
		expect(linha!.notes, 'mas o recado sobre o responsável chega ao conselheiro').toMatch(
			/Responsável Informado/
		);
	});
});
