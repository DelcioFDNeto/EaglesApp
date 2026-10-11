import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarBancoDeTeste, criarGrupo, type BancoDeTeste } from './helpers/banco';
import {
	auditLog,
	groupMembership,
	person,
	personRelation,
	personRole,
	smallGroup
} from '../../src/lib/server/db/schema';
import { PolicyDenied, type Actor } from '../../src/lib/server/policy/policy';
import { loadActor } from '../../src/lib/server/policy/actor';
import {
	atualizarPessoa,
	criarPessoa,
	listarPessoas,
	removerPessoa,
	verPessoa
} from '../../src/lib/server/modules/pessoas/pessoas';
import { criarVinculo, removerVinculo } from '../../src/lib/server/modules/pessoas/relacoes';
import { linhaDoTempo } from '../../src/lib/server/modules/pessoas/status';
import { emitirConvite } from '../../src/lib/server/modules/rbac/convites';
import { atribuirPapel } from '../../src/lib/server/modules/rbac/atribuicoes';
import { AcessoRecusado } from '../../src/lib/server/modules/rbac/regras';
import {
	arquivarGrupo,
	atualizarGrupo,
	criarGrupo as criarGrupoPeloServico,
	reativarGrupo,
	verGrupo
} from '../../src/lib/server/modules/grupos/grupos';
import { candidatosParaGrupo, mudarDeGrupo } from '../../src/lib/server/modules/grupos/composicao';
import {
	aplicar,
	lerPlano,
	planejar,
	PlanoDesatualizado
} from '../../src/lib/server/modules/grupos/reorganizacao';
import { GrupoRecusado } from '../../src/lib/server/modules/grupos/regras';
import { dadosDoGrupoSchema } from '../../src/lib/server/modules/grupos/validacao';

/**
 * Módulo 04 — grupos, composição e o grupo como contexto da pessoa.
 *
 * Os cenários usam dois PGs e dois conselheiros, um de cada, porque o defeito
 * que este módulo fecha (G1/G2) só aparece quando existe um "outro grupo"
 * para vazar.
 */

let ctx: BancoDeTeste;
let azul: string;
let verde: string;
let lider: Actor;
let conselheiroAzul: Actor;
let conselheiroVerde: Actor;
let contador = 0;

const VAZIO = {
	birthDate: '1995-05-05',
	phone: null,
	whatsapp: null,
	email: null,
	relationshipStatus: null,
	joinedAt: null,
	notes: null,
	statusId: null
};

async function novaPessoa(
	nome: string,
	opcoes: { grupo?: string; telefone?: string; nascimento?: string | null } = {}
): Promise<string> {
	contador++;
	const [p] = await ctx.db
		.insert(person)
		.values({
			teamId: ctx.teamId,
			fullName: `${nome} ${contador}`,
			phone: opcoes.telefone ?? `1198765${String(contador).padStart(4, '0')}`,
			birthDate: opcoes.nascimento === undefined ? '1995-05-05' : opcoes.nascimento
		})
		.returning({ id: person.id });
	if (opcoes.grupo) {
		await ctx.db.insert(groupMembership).values({ groupId: opcoes.grupo, personId: p!.id });
	}
	return p!.id;
}

async function atorCom(papel: string, escopo: { grupo?: string } = {}): Promise<Actor> {
	const id = await novaPessoa(`Ator ${papel}`);
	await ctx.db.insert(personRole).values({
		personId: id,
		roleId: ctx.papeis[papel]!,
		scopeType: escopo.grupo ? 'group' : papel === 'lider' ? 'global' : 'self',
		scopeId: escopo.grupo ?? null
	});
	const actor = await loadActor(ctx.db, id);
	if (!actor) throw new Error('ator não carregou');
	return actor;
}

async function grupoAtual(personId: string): Promise<string | null> {
	const [v] = await ctx.db
		.select({ g: groupMembership.groupId })
		.from(groupMembership)
		.where(and(eq(groupMembership.personId, personId), isNull(groupMembership.leftAt)));
	return v?.g ?? null;
}

async function vinculosAbertos(): Promise<number> {
	const [l] = await ctx.db
		.select({ n: sql<number>`count(*)` })
		.from(groupMembership)
		.where(isNull(groupMembership.leftAt));
	return Number(l!.n);
}

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
	azul = await criarGrupo(ctx, 'PG Azul');
	verde = await criarGrupo(ctx, 'PG Verde');
	lider = await atorCom('lider');
	conselheiroAzul = await atorCom('conselheiro', { grupo: azul });
	conselheiroVerde = await atorCom('conselheiro', { grupo: verde });
});

afterAll(async () => {
	await ctx.fechar();
});

// ---------------------------------------------------------------------------
// D-M04-2 — garantias do BANCO, sem passar pelo serviço
// ---------------------------------------------------------------------------

describe('RN-06 e RN-07 garantidas pelo banco', () => {
	it('RN-06: recusa um segundo vínculo aberto para a mesma pessoa', async () => {
		const p = await novaPessoa('Dois Grupos', { grupo: azul });
		await expect(
			ctx.db.insert(groupMembership).values({ groupId: verde, personId: p })
		).rejects.toThrow(/um_grupo_ativo|unique|duplicate/i);
	});

	it('RN-07: recusa trocar o grupo de um vínculo', async () => {
		const p = await novaPessoa('Reescrita', { grupo: azul });
		await expect(
			ctx.db.execute(
				sql`update group_membership set group_id = ${verde} where person_id = ${p} and left_at is null`
			)
		).rejects.toThrow(/RN-07/);
	});

	it('RN-07: recusa reabrir ou alterar um vínculo encerrado', async () => {
		const p = await novaPessoa('Encerrada', { grupo: azul });
		await ctx.db.execute(
			sql`update group_membership set left_at = now() where person_id = ${p} and left_at is null`
		);
		await expect(
			ctx.db.execute(sql`update group_membership set left_at = null where person_id = ${p}`)
		).rejects.toThrow(/RN-07/);
		await expect(
			ctx.db.execute(
				sql`update group_membership set left_reason = 'outro motivo' where person_id = ${p}`
			)
		).rejects.toThrow(/RN-07/);
	});

	it('RN-07: recusa apagar vínculo', async () => {
		const p = await novaPessoa('Apagada', { grupo: azul });
		await expect(
			ctx.db.execute(sql`delete from group_membership where person_id = ${p}`)
		).rejects.toThrow(/append-only/i);
	});

	it('saída não antecede a entrada', async () => {
		const p = await novaPessoa('Volta no tempo', { grupo: azul });
		await expect(
			ctx.db.execute(
				sql`update group_membership set left_at = joined_at - interval '1 day' where person_id = ${p}`
			)
		).rejects.toThrow(/saida_depois_da_entrada|check/i);
	});

	it('grupo não se apaga, e só se arquiva vazio', async () => {
		const g = await criarGrupo(ctx, 'PG Lotado');
		await novaPessoa('Moradora', { grupo: g });

		await expect(ctx.db.execute(sql`delete from small_group where id = ${g}`)).rejects.toThrow(
			/append-only/i
		);
		await expect(
			ctx.db.execute(sql`update small_group set archived_at = now() where id = ${g}`)
		).rejects.toThrow(/com pessoas/);
	});

	it('grupo arquivado não recebe pessoas nem responsáveis', async () => {
		const g = await criarGrupo(ctx, 'PG Fechado');
		await ctx.db.execute(sql`update small_group set archived_at = now() where id = ${g}`);
		const p = await novaPessoa('Atrasada');

		await expect(
			ctx.db.insert(groupMembership).values({ groupId: g, personId: p })
		).rejects.toThrow(/arquivado/);
		await expect(
			ctx.db
				.insert(personRole)
				.values({ personId: p, roleId: ctx.papeis.conselheiro!, scopeType: 'group', scopeId: g })
		).rejects.toThrow(/arquivado/);
	});

	it('papel de grupo precisa apontar para um grupo que existe', async () => {
		const p = await novaPessoa('Conselheira do nada');
		await expect(
			ctx.db.insert(personRole).values({
				personId: p,
				roleId: ctx.papeis.conselheiro!,
				scopeType: 'group',
				scopeId: '018f0000-0000-7000-8000-0000000fffff'
			})
		).rejects.toThrow(/foreign key|scope_id/i);
	});

	it('nome repetido entre grupos ativos é recusado, sem diferenciar maiúsculas', async () => {
		await expect(criarGrupo(ctx, 'pg azul')).rejects.toThrow(/nome_ativo|unique|duplicate/i);
	});
});

describe('migração 0005 numa instalação que já tinha conselheiros', () => {
	it('cria grupos "a nomear" para os escopos órfãos em vez de apagar acessos', async () => {
		// Banco novo, migrado só até a 0004 — o estado de qualquer instalação
		// anterior ao M04 —, com um conselheiro apontando para um grupo que não
		// existe. Depois aplica 0005 e 0006, como o deploy faria.
		const pasta = join(process.cwd(), 'src', 'lib', 'server', 'db', 'migrations');
		const banco = new PGlite();
		const aplicarArquivo = async (nome: string) => {
			for (const trecho of readFileSync(join(pasta, nome), 'utf8').split(
				'--> statement-breakpoint'
			)) {
				if (trecho.trim()) await banco.exec(trecho);
			}
		};

		try {
			for (const m of [
				'0000_fundacao.sql',
				'0001_regras_de_banco.sql',
				'0002_pessoas.sql',
				'0003_regras_de_pessoas.sql',
				'0004_rbac.sql'
			]) {
				await aplicarArquivo(m);
			}

			const orfao = '018f0000-0000-7000-8000-00000000a001';
			await banco.exec(`
				insert into team (id, slug, name) values ('018f0000-0000-7000-8000-000000000001', 'eagles', 'Eagles');
				insert into role (id, team_id, key, name, default_scope)
					values ('018f0000-0000-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', 'conselheiro', 'Conselheiro', 'group');
				insert into person (id, team_id, full_name)
					values ('018f0000-0000-7000-8000-000000000003', '018f0000-0000-7000-8000-000000000001', 'Pedro');
				insert into person_role (id, person_id, role_id, scope_type, scope_id)
					values ('018f0000-0000-7000-8000-000000000004', '018f0000-0000-7000-8000-000000000003',
					        '018f0000-0000-7000-8000-000000000002', 'group', '${orfao}');
			`);

			await aplicarArquivo('0005_grupos.sql');
			await aplicarArquivo('0006_regras_de_grupos.sql');

			const grupos = await banco.query<{ id: string; name: string }>(
				'select id, name from small_group'
			);
			expect(grupos.rows).toEqual([{ id: orfao, name: `Grupo a nomear (${orfao})` }]);

			const papeis = await banco.query<{ n: number }>('select count(*)::int as n from person_role');
			expect(papeis.rows[0]!.n, 'o acesso do conselheiro continua lá').toBe(1);
		} finally {
			await banco.close();
		}
	});
});

// ---------------------------------------------------------------------------
// D-M04-4 — o grupo é o contexto da pessoa (lacunas G1 e G2)
// ---------------------------------------------------------------------------

describe('o grupo é o contexto da pessoa', () => {
	let doAzul: string;
	let doVerde: string;
	let semGrupo: string;

	beforeAll(async () => {
		doAzul = await novaPessoa('Membro do Azul', { grupo: azul, telefone: '11911110001' });
		doVerde = await novaPessoa('Membro do Verde', { grupo: verde, telefone: '11922220002' });
		semGrupo = await novaPessoa('Sem Grupo', { telefone: '11933330003' });
	});

	it('G1: conselheiro vê o contato do próprio grupo — e de mais ninguém', async () => {
		expect((await verPessoa(ctx.db, conselheiroAzul, doAzul))?.sensiveis?.phone).toBe(
			'11911110001'
		);
		expect((await verPessoa(ctx.db, conselheiroAzul, doVerde))?.sensiveis).toBeNull();
		expect((await verPessoa(ctx.db, conselheiroAzul, semGrupo))?.sensiveis).toBeNull();
	});

	it('G1: na lista, o telefone é decidido linha a linha', async () => {
		const lista = await listarPessoas(ctx.db, conselheiroAzul, { busca: 'membro do' });
		const telefone = (id: string) => lista.find((p) => p.id === id)?.phone;

		expect(telefone(doAzul)).toBe('11911110001');
		expect(telefone(doVerde)).toBeNull();
	});

	it('o líder continua vendo todos, inclusive quem está sem grupo', async () => {
		expect((await verPessoa(ctx.db, lider, doVerde))?.sensiveis?.phone).toBe('11922220002');
		expect((await verPessoa(ctx.db, lider, semGrupo))?.sensiveis?.phone).toBe('11933330003');
	});

	it('G2: conselheiro edita quem está no próprio grupo', async () => {
		await atualizarPessoa(ctx.db, conselheiroAzul, doAzul, { notes: 'Chegou pelo irmão.' });
		expect((await verPessoa(ctx.db, lider, doAzul))?.sensiveis?.notes).toBe('Chegou pelo irmão.');
	});

	it('G2: e não edita quem está em outro grupo ou sem grupo', async () => {
		await expect(
			atualizarPessoa(ctx.db, conselheiroAzul, doVerde, { notes: 'invasão' })
		).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			atualizarPessoa(ctx.db, conselheiroAzul, semGrupo, { notes: 'invasão' })
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('G2: o convite segue a mesma regra', async () => {
		await expect(
			emitirConvite(ctx.db, conselheiroAzul, doVerde, { reautenticadoRecentemente: true })
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('vínculo é das duas pessoas: não liga alguém do próprio grupo a um menor de outro', async () => {
		const meuMembro = await novaPessoa('Responsável Pretexto', { grupo: azul });
		const menorDeOutroGrupo = await novaPessoa('Menor do Verde', { grupo: verde });
		await expect(
			criarVinculo(ctx.db, conselheiroAzul, {
				pessoaId: meuMembro,
				outraPessoaId: menorDeOutroGrupo,
				tipo: 'responsavel_legal'
			})
		).rejects.toBeInstanceOf(PolicyDenied);
		// Quem cuida dos dois lados, pode.
		await criarVinculo(ctx.db, lider, {
			pessoaId: meuMembro,
			outraPessoaId: menorDeOutroGrupo,
			tipo: 'responsavel_legal'
		});
	});

	it('G6: não apaga vínculo alheio usando uma pessoa do próprio grupo como pretexto', async () => {
		const a = await novaPessoa('Irmã A', { grupo: verde });
		const b = await novaPessoa('Irmã B', { grupo: verde });
		await criarVinculo(ctx.db, lider, { pessoaId: a, outraPessoaId: b, tipo: 'irmao' });
		const [vinculo] = await ctx.db
			.select({ id: personRelation.id })
			.from(personRelation)
			.where(eq(personRelation.personA, a < b ? a : b));

		// A permissão é conferida sobre `doAzul`, que o conselheiro pode editar;
		// o vínculo, porém, é entre duas pessoas do PG Verde.
		await removerVinculo(ctx.db, conselheiroAzul, vinculo!.id, doAzul);

		const restantes = await ctx.db
			.select()
			.from(personRelation)
			.where(eq(personRelation.id, vinculo!.id));
		expect(restantes, 'o vínculo do PG Verde continua lá').toHaveLength(1);
	});
});

describe('cadastro com grupo', () => {
	it('conselheiro precisa cadastrar dentro de um dos próprios grupos', async () => {
		await expect(
			criarPessoa(ctx.db, conselheiroAzul, { ...VAZIO, fullName: 'Sem Destino' })
		).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			criarPessoa(
				ctx.db,
				conselheiroAzul,
				{ ...VAZIO, fullName: 'Destino Alheio' },
				{
					grupoId: verde
				}
			)
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('cadastrada no próprio grupo, a pessoa já entra nele e continua visível', async () => {
		const id = await criarPessoa(
			ctx.db,
			conselheiroAzul,
			{ ...VAZIO, fullName: 'Visitante da Quinta', phone: '11944440004' },
			{ grupoId: azul }
		);

		expect(await grupoAtual(id)).toBe(azul);
		const detalhe = await verPessoa(ctx.db, conselheiroAzul, id);
		expect(detalhe?.grupo?.id).toBe(azul);
		expect(detalhe?.sensiveis?.phone).toBe('11944440004');
	});

	it('grupo arquivado desfaz o cadastro inteiro — nada fica pela metade', async () => {
		const g = await criarGrupo(ctx, 'PG Encerrado');
		await ctx.db.execute(sql`update small_group set archived_at = now() where id = ${g}`);

		await expect(
			criarPessoa(ctx.db, lider, { ...VAZIO, fullName: 'Cadastro Órfão' }, { grupoId: g })
		).rejects.toBeInstanceOf(GrupoRecusado);

		const sobrou = await ctx.db.select().from(person).where(eq(person.fullName, 'Cadastro Órfão'));
		expect(sobrou).toHaveLength(0);
	});

	it('remover o cadastro encerra o vínculo com o grupo — sem apagá-lo', async () => {
		const p = await novaPessoa('De Saída', { grupo: azul });
		await removerPessoa(ctx.db, lider, p);

		expect(await grupoAtual(p)).toBeNull();
		const historico = await ctx.db
			.select()
			.from(groupMembership)
			.where(eq(groupMembership.personId, p));
		expect(historico).toHaveLength(1);
		expect(historico[0]!.leftReason).toBe('Cadastro removido');
	});
});

// ---------------------------------------------------------------------------
// D-M04-3 — composição: permissão nas duas pontas
// ---------------------------------------------------------------------------

describe('composição', () => {
	it('conselheiro coloca no próprio grupo quem está sem grupo', async () => {
		const p = await novaPessoa('Recém-chegada');
		const m = await mudarDeGrupo(ctx.db, conselheiroAzul, { personId: p, paraGrupoId: azul });
		expect(m.de).toBeNull();
		expect(m.para?.id).toBe(azul);
		expect(await grupoAtual(p)).toBe(azul);
	});

	it('conselheiro NÃO transfere para o grupo de outro — e nada muda', async () => {
		const p = await novaPessoa('Quase Transferida', { grupo: azul });
		await expect(
			mudarDeGrupo(ctx.db, conselheiroAzul, { personId: p, paraGrupoId: verde })
		).rejects.toBeInstanceOf(PolicyDenied);
		expect(await grupoAtual(p)).toBe(azul);
	});

	it('conselheiro NÃO tira ninguém de um grupo que não é o seu', async () => {
		const p = await novaPessoa('Do Verde', { grupo: verde });
		await expect(
			mudarDeGrupo(ctx.db, conselheiroAzul, { personId: p, paraGrupoId: azul })
		).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			mudarDeGrupo(ctx.db, conselheiroAzul, { personId: p, paraGrupoId: null })
		).rejects.toBeInstanceOf(PolicyDenied);
		expect(await grupoAtual(p)).toBe(verde);
	});

	it('transferência: encerra e abre no mesmo instante, e a linha do tempo mostra UM fato', async () => {
		const p = await novaPessoa('Transferida', { grupo: azul });
		await mudarDeGrupo(ctx.db, lider, {
			personId: p,
			paraGrupoId: verde,
			motivo: 'Mudou de bairro'
		});

		const vinculos = await ctx.db
			.select()
			.from(groupMembership)
			.where(eq(groupMembership.personId, p));
		const antigo = vinculos.find((v) => v.groupId === azul)!;
		const novo = vinculos.find((v) => v.groupId === verde)!;

		expect(antigo.leftAt).not.toBeNull();
		expect(antigo.leftAt!.getTime()).toBe(novo.joinedAt.getTime());
		expect(antigo.leftReason).toBe('Mudou de bairro');
		expect(novo.leftAt).toBeNull();

		const grupos = (await linhaDoTempo(ctx.db, p)).filter((i) => i.tipo === 'grupo');
		expect(grupos[0]).toMatchObject({ de: 'PG Azul', para: 'PG Verde', motivo: 'Mudou de bairro' });
	});

	it('retirar do grupo aparece como saída na linha do tempo', async () => {
		const p = await novaPessoa('Saiu', { grupo: azul });
		await mudarDeGrupo(ctx.db, conselheiroAzul, { personId: p, paraGrupoId: null });

		expect(await grupoAtual(p)).toBeNull();
		const [ultimo] = (await linhaDoTempo(ctx.db, p)).filter((i) => i.tipo === 'grupo');
		expect(ultimo).toMatchObject({ de: 'PG Azul', para: null });
	});

	it('mover para onde a pessoa já está é recusado com explicação', async () => {
		const p = await novaPessoa('Parada', { grupo: azul });
		await expect(
			mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: azul })
		).rejects.toMatchObject({ motivo: 'sem_mudanca' });
	});

	it('cada movimento é auditado (RN-28)', async () => {
		const p = await novaPessoa('Auditada', { grupo: azul });
		await mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: verde });

		const registros = await ctx.db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.entityId, p), eq(auditLog.action, 'group.membro_transferido')));
		expect(registros).toHaveLength(1);
	});

	it('a tela de colocar só oferece quem o conselheiro pode tirar de onde está', async () => {
		const livre = await novaPessoa('Livre');
		const presa = await novaPessoa('Presa no Verde', { grupo: verde });

		const ids = (await candidatosParaGrupo(ctx.db, conselheiroAzul, azul)).map((c) => c.personId);
		expect(ids).toContain(livre);
		expect(ids).not.toContain(presa);

		const doLider = (await candidatosParaGrupo(ctx.db, lider, azul)).map((c) => c.personId);
		expect(doLider).toContain(presa);
	});
});

// ---------------------------------------------------------------------------
// D-M04-5 — reorganização em lote
// ---------------------------------------------------------------------------

describe('reorganização em lote (RN-09)', () => {
	it('planejar não grava nada', async () => {
		const p = await novaPessoa('Planejada', { grupo: azul });
		const antes = await vinculosAbertos();

		const previa = await planejar(ctx.db, lider, [{ personId: p, de: azul, para: verde }]);

		expect(previa.movimentos).toHaveLength(1);
		const balancoVerde = previa.balanco.find((b) => b.id === verde)!;
		expect(balancoVerde.depois).toBe(balancoVerde.antes + 1);
		expect(await vinculosAbertos()).toBe(antes);
		expect(await grupoAtual(p)).toBe(azul);
	});

	it('aplica só o que foi confirmado — aceite parcial', async () => {
		const a = await novaPessoa('Confirmada', { grupo: azul });
		const b = await novaPessoa('Desmarcada', { grupo: azul });
		await planejar(ctx.db, lider, [
			{ personId: a, de: azul, para: verde },
			{ personId: b, de: azul, para: verde }
		]);

		// A pessoa desmarcou `b` na conferência: só `a` chega para aplicar.
		const { movimentos, batchId } = await aplicar(ctx.db, lider, [
			{ personId: a, de: azul, para: verde }
		]);

		expect(movimentos).toHaveLength(1);
		expect(await grupoAtual(a)).toBe(verde);
		expect(await grupoAtual(b)).toBe(azul);

		const [novo] = await ctx.db
			.select({ lote: groupMembership.batchId })
			.from(groupMembership)
			.where(and(eq(groupMembership.personId, a), isNull(groupMembership.leftAt)));
		expect(novo!.lote).toBe(batchId);
	});

	it('se alguém mudou desde o planejamento, NADA é aplicado e a tela diz quem', async () => {
		const a = await novaPessoa('Estável', { grupo: azul });
		const b = await novaPessoa('Inquieta', { grupo: azul });
		const plano = [
			{ personId: a, de: azul, para: verde },
			{ personId: b, de: azul, para: verde }
		];

		// Entre planejar e aplicar, outra pessoa mexeu em `b`.
		await mudarDeGrupo(ctx.db, lider, { personId: b, paraGrupoId: null });

		const erro = await aplicar(ctx.db, lider, plano).catch((e: unknown) => e);
		expect(erro).toBeInstanceOf(PlanoDesatualizado);
		expect((erro as PlanoDesatualizado).pessoas).toEqual([expect.stringContaining('Inquieta')]);
		expect(await grupoAtual(a), 'o movimento válido também foi desfeito').toBe(azul);
	});

	it('conselheiro não reorganiza: a tela é da liderança geral', async () => {
		await expect(planejar(ctx.db, conselheiroAzul, [])).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			aplicar(ctx.db, conselheiroAzul, [
				{ personId: conselheiroAzul.personId, de: null, para: azul }
			])
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('o formulário só aceita ids — o resto é descartado', () => {
		const form = new FormData();
		const id = '018f0000-0000-7000-8000-0000000000ab';
		form.set(`para-${id}`, verde);
		form.set(`de-${id}`, azul);
		form.set('para-nao-e-id', verde);
		form.set(`para-018f0000-0000-7000-8000-0000000000ac`, "'; drop table person; --");

		expect(lerPlano(form)).toEqual([{ personId: id, de: azul, para: verde }]);
	});
});

// ---------------------------------------------------------------------------
// D-M04-1 / D-M04-3 — o grupo em si
// ---------------------------------------------------------------------------

describe('o grupo em si', () => {
	const dados = (nome: string) => dadosDoGrupoSchema.parse({ name: nome });

	it('criar exige escopo global', async () => {
		await expect(
			criarGrupoPeloServico(ctx.db, conselheiroAzul, dados('PG do Conselheiro'))
		).rejects.toBeInstanceOf(PolicyDenied);
		const id = await criarGrupoPeloServico(ctx.db, lider, dados('PG Amarelo'));
		expect(id).toBeTruthy();
	});

	it('nome em uso é recusado com explicação', async () => {
		await expect(criarGrupoPeloServico(ctx.db, lider, dados('PG AZUL'))).rejects.toMatchObject({
			motivo: 'nome_em_uso'
		});
	});

	it('conselheiro edita o combinado do próprio grupo — e não o do outro', async () => {
		await atualizarGrupo(
			ctx.db,
			conselheiroAzul,
			azul,
			dadosDoGrupoSchema.parse({ name: 'PG Azul', meetingWeekday: '4', meetingTime: '20:00' })
		);
		const [g] = await ctx.db.select().from(smallGroup).where(eq(smallGroup.id, azul));
		expect(g!.meetingWeekday).toBe(4);

		await expect(
			atualizarGrupo(ctx.db, conselheiroAzul, verde, dados('PG Verde'))
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('arquivar: recusa com pessoas, recusa com responsáveis, aceita vazio', async () => {
		const g = await criarGrupoPeloServico(ctx.db, lider, dados('PG Temporário'));
		const p = await novaPessoa('Última', { grupo: g });
		await expect(arquivarGrupo(ctx.db, lider, g)).rejects.toMatchObject({ motivo: 'tem_membros' });

		await mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: null });
		const responsavel = await novaPessoa('Responsável');
		await ctx.db.insert(personRole).values({
			personId: responsavel,
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: g
		});
		await expect(arquivarGrupo(ctx.db, lider, g)).rejects.toMatchObject({
			motivo: 'tem_responsaveis'
		});

		await ctx.db.delete(personRole).where(eq(personRole.scopeId, g));
		await arquivarGrupo(ctx.db, lider, g);
		await expect(
			mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: g })
		).rejects.toMatchObject({ motivo: 'arquivado' });

		await reativarGrupo(ctx.db, lider, g);
		await mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: g });
		expect(await grupoAtual(p)).toBe(g);
	});

	it('responsável vencido ou removido do cadastro não trava o arquivamento (varredura)', async () => {
		const g = await criarGrupoPeloServico(ctx.db, lider, dados('PG Que Acabou'));
		const vencido = await novaPessoa('Conselheiro de Antes');
		await ctx.db.insert(personRole).values({
			personId: vencido,
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: g,
			expiresAt: new Date(Date.now() - 86_400_000)
		});
		const removido = await novaPessoa('Conselheiro Removido');
		await ctx.db.insert(personRole).values({
			personId: removido,
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: g
		});
		await ctx.db.update(person).set({ deletedAt: new Date() }).where(eq(person.id, removido));

		// Nenhum dos dois aparece como responsável — e nenhum dos dois trava:
		// nem o serviço, nem o gatilho do banco (migração 0011).
		expect((await verGrupo(ctx.db, lider, g))!.responsaveis).toEqual([]);
		await arquivarGrupo(ctx.db, lider, g);
	});

	it('conselheiro não arquiva nem o próprio grupo', async () => {
		await expect(arquivarGrupo(ctx.db, conselheiroAzul, azul)).rejects.toBeInstanceOf(PolicyDenied);
	});
});

describe('responsáveis pelo grupo (D-M04-1)', () => {
	it('papel de grupo é atribuído COM o grupo, e o escopo vale no mesmo clique', async () => {
		const g = await criarGrupoPeloServico(
			ctx.db,
			lider,
			dadosDoGrupoSchema.parse({ name: 'PG Roxo' })
		);
		const alvo = await novaPessoa('Futura Conselheira');

		await atribuirPapel(
			ctx.db,
			lider,
			{ personId: alvo, roleId: ctx.papeis.conselheiro!, grupoId: g },
			{ reautenticadoRecentemente: true }
		);

		const actor = await loadActor(ctx.db, alvo);
		expect(actor!.assignments[0]).toMatchObject({ scopeType: 'group', scopeId: g });

		const visao = await verGrupo(ctx.db, lider, g);
		expect(visao!.responsaveis.map((r) => r.personId)).toEqual([alvo]);
	});

	it('papel da equipe inteira não aceita grupo — seria um acesso maior do que parece', async () => {
		const alvo = await novaPessoa('Membro com Grupo');
		const erro = await atribuirPapel(
			ctx.db,
			lider,
			{ personId: alvo, roleId: ctx.papeis.membro!, grupoId: azul },
			{ reautenticadoRecentemente: true }
		).catch((e: unknown) => e);
		expect(erro).toBeInstanceOf(AcessoRecusado);
		expect((erro as AcessoRecusado).motivo).toBe('escopo_de_grupo');
	});
});

describe('visão do conselheiro (RF-04.3)', () => {
	it('mostra contato e pendências para o conselheiro do grupo', async () => {
		const g = await criarGrupoPeloServico(
			ctx.db,
			lider,
			dadosDoGrupoSchema.parse({ name: 'PG Cinza' })
		);
		const conselheiro = await atorCom('conselheiro', { grupo: g });
		const semData = await novaPessoa('Sem Nascimento', { grupo: g, nascimento: null });

		const visao = await verGrupo(ctx.db, conselheiro, g);
		const linha = visao!.pessoas.find((p) => p.personId === semData)!;

		expect(linha.telefone).not.toBeNull();
		expect(linha.pendencias).toEqual(['regime_restrito', 'sem_acesso']);
	});

	it('quem saiu duas vezes aparece uma vez só em "saíram recentemente"', async () => {
		const g = await criarGrupoPeloServico(
			ctx.db,
			lider,
			dadosDoGrupoSchema.parse({ name: 'PG Vaivém' })
		);
		const p = await novaPessoa('Indecisa', { grupo: g });
		await mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: azul });
		await mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: g });
		await mudarDeGrupo(ctx.db, lider, { personId: p, paraGrupoId: verde, motivo: 'Mudou de novo' });

		const visao = await verGrupo(ctx.db, lider, g);
		expect(visao!.sairamRecentemente).toEqual([
			expect.objectContaining({ personId: p, motivo: 'Mudou de novo' })
		]);

		// O motivo é texto livre de quem cuida do grupo: quem não vê dados
		// sensíveis daquele grupo vê a saída, mas não o porquê (varredura).
		const deFora = await verGrupo(ctx.db, conselheiroVerde, g);
		expect(deFora!.sairamRecentemente).toEqual([
			expect.objectContaining({ personId: p, motivo: null })
		]);
	});

	it('outro conselheiro vê quem está no grupo, mas não contato nem pendências', async () => {
		const visao = await verGrupo(ctx.db, conselheiroVerde, azul);
		expect(visao!.pessoas.length).toBeGreaterThan(0);
		expect(visao!.pessoas.every((p) => p.telefone === null && p.pendencias.length === 0)).toBe(
			true
		);
		// Nem o sinal de menor de idade — que diz a idade tanto quanto a pendência.
		expect(visao!.pessoas.every((p) => p.ehMenor === null)).toBe(true);
	});
});
