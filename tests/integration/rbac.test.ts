/**
 * Administração de acesso (M03), contra Postgres real.
 *
 * O foco são as quatro travas (D-M03-2). Cada uma é testada pelo caminho que
 * a violaria, e conferida no ESTADO DO BANCO depois da recusa: uma trava que
 * lança erro mas deixa a alteração gravada não trava nada.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { criarBancoDeTeste, criarGrupo, type BancoDeTeste } from './helpers/banco';
import {
	auditLog,
	groupMembership,
	person,
	personRole,
	rolePermission,
	userAccount
} from '../../src/lib/server/db/schema';
import { aceitarConvite } from '../../src/lib/server/auth/conta';
import { loadActor } from '../../src/lib/server/policy/actor';
import { can, PolicyDenied, type Actor } from '../../src/lib/server/policy/policy';
import { hashPassword } from '../../src/lib/server/auth/password';
import { resetEnvCache } from '../../src/lib/server/env';
import {
	atualizarPapel,
	criarPapel,
	excluirPapel,
	listarPapeis,
	verPapel
} from '../../src/lib/server/modules/rbac/papeis';
import {
	atribuicoesDe,
	atribuirPapel,
	removerAtribuicao
} from '../../src/lib/server/modules/rbac/atribuicoes';
import { emitirConvite } from '../../src/lib/server/modules/rbac/convites';
import { removerPessoa } from '../../src/lib/server/modules/pessoas/pessoas';
import { contarAdministradoresAtivos } from '../../src/lib/server/modules/rbac/administradores';
import { AcessoRecusado } from '../../src/lib/server/modules/rbac/regras';
import { ROLE_SEEDS } from '../../src/lib/server/policy/roles';

let ctx: BancoDeTeste;
let lider: Actor;
let membro: Actor;

const COM_REAUTH = { reautenticadoRecentemente: true };
const SEM_REAUTH = { reautenticadoRecentemente: false };

let contador = 0;

/** Pessoa com papel e, por padrão, conta ativa — senão não conta como administradora. */
async function pessoa(
	papel: string | null,
	opcoes: { conta?: boolean; nascimento?: string | null; escopoGrupo?: string } = {}
): Promise<string> {
	contador++;
	const [p] = await ctx.db
		.insert(person)
		.values({
			teamId: ctx.teamId,
			fullName: `Pessoa Rbac ${contador}`,
			birthDate: opcoes.nascimento === undefined ? '1990-01-01' : opcoes.nascimento
		})
		.returning({ id: person.id });

	if (papel) {
		// Escopo de grupo só quando o teste aponta um grupo; sem grupo, o papel
		// entra no escopo global (líder) ou próprio (os demais).
		const semente = ROLE_SEEDS.find((r) => r.key === papel);
		await ctx.db.insert(personRole).values({
			personId: p!.id,
			roleId: ctx.papeis[papel]!,
			scopeType: opcoes.escopoGrupo
				? 'group'
				: semente?.defaultScope === 'global'
					? 'global'
					: 'self',
			scopeId: opcoes.escopoGrupo ?? null
		});
	}

	if (opcoes.conta !== false) {
		await ctx.db.insert(userAccount).values({
			personId: p!.id,
			email: `rbac${contador}@eagles.test`,
			passwordHash: await hashPassword('uma senha de teste comprida')
		});
	}
	return p!.id;
}

async function ator(personId: string): Promise<Actor> {
	const a = await loadActor(ctx.db, personId);
	if (!a) throw new Error('ator não carregou');
	return a;
}

async function recusa(promessa: Promise<unknown>): Promise<AcessoRecusado> {
	try {
		await promessa;
	} catch (erro) {
		if (erro instanceof AcessoRecusado) return erro;
		throw erro;
	}
	throw new Error('esperava uma recusa, e a operação passou');
}

beforeAll(async () => {
	process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
	process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
	process.env.NODE_ENV = 'test';
	resetEnvCache();

	ctx = await criarBancoDeTeste();
	lider = await ator(await pessoa('lider'));
	// Segundo líder: garante que retirar rbac.manage não tranque a equipe
	// por acidente nos testes que não são sobre isso.
	await pessoa('lider');
	membro = await ator(await pessoa('membro'));
}, 60_000);

afterAll(async () => {
	await ctx?.fechar();
});

describe('quem administra', () => {
	it('lista os papéis com o líder em cima, sem comparar chave', async () => {
		const papeis = await listarPapeis(ctx.db, lider);
		expect(papeis.slice(0, 4).map((p) => p.name)).toEqual([
			'Líder',
			'Conselheiro',
			'Membro',
			'Visitante'
		]);
		expect(papeis.find((p) => p.name === 'Líder')!.pessoas).toBeGreaterThanOrEqual(2);
	});

	it('membro não administra nada', async () => {
		await expect(listarPapeis(ctx.db, membro)).rejects.toThrow(PolicyDenied);
	});

	it('rbac.manage de GRUPO não administra: o escopo precisa ser global', async () => {
		const conselheiro = await ator(
			await pessoa('conselheiro', { escopoGrupo: await criarGrupo(ctx, 'PG do teste') })
		);
		// Mesmo que alguém desse rbac.manage ao papel de conselheiro, a
		// verificação sem contexto só aceita escopo global.
		await expect(listarPapeis(ctx.db, conselheiro)).rejects.toThrow(PolicyDenied);
	});
});

describe('trava: reautenticação (ADR 0004)', () => {
	it('toda alteração de acesso exige senha confirmada há pouco', async () => {
		const alvo = await pessoa(null);
		const r = await recusa(
			atribuirPapel(ctx.db, lider, { personId: alvo, roleId: ctx.papeis.membro! }, SEM_REAUTH)
		);
		expect(r.motivo).toBe('reautenticacao');
		expect(await atribuicoesDe(ctx.db, alvo)).toEqual([]);
	});
});

describe('trava: ninguém altera o próprio acesso', () => {
	it('nem para se dar um papel', async () => {
		const r = await recusa(
			atribuirPapel(
				ctx.db,
				lider,
				{ personId: lider.personId, roleId: ctx.papeis.membro! },
				COM_REAUTH
			)
		);
		expect(r.motivo).toBe('propria_conta');
	});

	it('nem para se tirar um papel', async () => {
		const [minha] = await atribuicoesDe(ctx.db, lider.personId);
		const r = await recusa(removerAtribuicao(ctx.db, lider, minha!.id, COM_REAUTH));
		expect(r.motivo).toBe('propria_conta');
		expect(await atribuicoesDe(ctx.db, lider.personId)).toHaveLength(1);
	});
});

describe('trava: ninguém concede o que não tem', () => {
	let secretaria: Actor;
	let papelSecretaria: string;

	beforeAll(async () => {
		// Um administrador PARCIAL: pode gerir acessos, mas só enxerga pessoas.
		papelSecretaria = await criarPapel(
			ctx.db,
			lider,
			{
				name: 'Secretaria',
				description: 'Cuida dos acessos',
				defaultScope: 'global',
				permissoes: ['rbac.manage', 'person.view']
			},
			COM_REAUTH
		);
		const id = await pessoa(null);
		await atribuirPapel(ctx.db, lider, { personId: id, roleId: papelSecretaria }, COM_REAUTH);
		secretaria = await ator(id);
	});

	it('não cria papel com permissão que não tem', async () => {
		const r = await recusa(
			criarPapel(
				ctx.db,
				secretaria,
				{
					name: 'Tesouraria Paralela',
					defaultScope: 'global',
					permissoes: ['finance.view_all', 'person.view']
				},
				COM_REAUTH
			)
		);
		expect(r.motivo).toBe('escalada');
		expect(r.message).toContain('finance.view_all');
		expect(r.message, 'só aponta o que falta').not.toContain('person.view,');
	});

	it('não dá a ninguém um papel maior que o seu', async () => {
		const alvo = await pessoa(null);
		const r = await recusa(
			atribuirPapel(ctx.db, secretaria, { personId: alvo, roleId: ctx.papeis.lider! }, COM_REAUTH)
		);
		expect(r.motivo).toBe('escalada');
		expect(await atribuicoesDe(ctx.db, alvo)).toEqual([]);
	});

	it('não acrescenta a um papel o que não tem — mas pode retirar', async () => {
		const r = await recusa(
			atualizarPapel(
				ctx.db,
				secretaria,
				ctx.papeis.membro!,
				{
					name: 'Membro',
					description: null,
					permissoes: [...ROLE_SEEDS.find((x) => x.key === 'membro')!.permissions, 'audit.view']
				},
				COM_REAUTH
			)
		);
		expect(r.motivo).toBe('escalada');

		// Retirar o que não tem é reduzir poder, não ganhar.
		const semFinanceiroProprio = ROLE_SEEDS.find((x) => x.key === 'membro')!.permissions.filter(
			(p) => p !== 'finance.view_own'
		);
		await atualizarPapel(
			ctx.db,
			secretaria,
			ctx.papeis.membro!,
			{ name: 'Membro', description: null, permissoes: semFinanceiroProprio },
			COM_REAUTH
		);
		const depois = await verPapel(ctx.db, lider, ctx.papeis.membro!);
		expect(depois!.permissoesDoPapel).not.toContain('finance.view_own');

		// Devolve, para não afetar os demais testes — quem pode é o líder.
		await atualizarPapel(
			ctx.db,
			lider,
			ctx.papeis.membro!,
			{
				name: 'Membro',
				description: null,
				permissoes: ROLE_SEEDS.find((x) => x.key === 'membro')!.permissions
			},
			COM_REAUTH
		);
	});
});

describe('trava: sempre resta um administrador ativo', () => {
	it('conta só quem consegue entrar: conta ativa, com senha e identificador', async () => {
		const antes = await contarAdministradoresAtivos(ctx.db, ctx.teamId);
		await pessoa('lider', { conta: false });
		expect(await contarAdministradoresAtivos(ctx.db, ctx.teamId)).toBe(antes);
	});

	it('tirar rbac.manage do papel Líder é recusado se só líderes administram — e nada muda', async () => {
		// Remove a Secretaria do caminho: com ela, ainda sobraria administrador.
		const papeis = await listarPapeis(ctx.db, lider);
		const secretaria = papeis.find((p) => p.name === 'Secretaria');
		if (secretaria) {
			const detalhe = await verPapel(ctx.db, lider, secretaria.id);
			for (const q of detalhe!.quemTem) {
				await removerAtribuicao(ctx.db, lider, q.atribuicaoId, COM_REAUTH);
			}
		}

		const permsDoLider = ROLE_SEEDS.find((x) => x.key === 'lider')!.permissions;
		const r = await recusa(
			atualizarPapel(
				ctx.db,
				lider,
				ctx.papeis.lider!,
				{
					name: 'Líder',
					description: null,
					permissoes: permsDoLider.filter((p) => p !== 'rbac.manage')
				},
				COM_REAUTH
			)
		);
		expect(r.motivo).toBe('ultimo_administrador');

		// A transação voltou inteira: o papel ainda tem rbac.manage.
		const [ainda] = await ctx.db
			.select()
			.from(rolePermission)
			.where(
				and(
					eq(rolePermission.roleId, ctx.papeis.lider!),
					eq(rolePermission.permissionKey, 'rbac.manage')
				)
			);
		expect(ainda).toBeDefined();
	});

	it('retirar o último administrador ATIVO é recusado, mesmo por quem administra sem conta', async () => {
		// Equipe isolada para controlar exatamente quem é administrador.
		const isolado = await criarBancoDeTeste();
		try {
			const [semConta] = await isolado.db
				.insert(person)
				.values({ teamId: isolado.teamId, fullName: 'Admin Sem Conta' })
				.returning({ id: person.id });
			await isolado.db.insert(personRole).values({
				personId: semConta!.id,
				roleId: isolado.papeis.lider!,
				scopeType: 'global',
				scopeId: null
			});

			const [unico] = await isolado.db
				.insert(person)
				.values({ teamId: isolado.teamId, fullName: 'Único Admin Ativo' })
				.returning({ id: person.id });
			const [atrib] = await isolado.db
				.insert(personRole)
				.values({
					personId: unico!.id,
					roleId: isolado.papeis.lider!,
					scopeType: 'global',
					scopeId: null
				})
				.returning({ id: personRole.id });
			await isolado.db.insert(userAccount).values({
				personId: unico!.id,
				email: 'unico@eagles.test',
				passwordHash: await hashPassword('senha comprida do único')
			});

			expect(await contarAdministradoresAtivos(isolado.db, isolado.teamId)).toBe(1);

			const ator = (await loadActor(isolado.db, semConta!.id))!;
			const r = await recusa(removerAtribuicao(isolado.db, ator, atrib!.id, COM_REAUTH));
			expect(r.motivo).toBe('ultimo_administrador');
			expect(await contarAdministradoresAtivos(isolado.db, isolado.teamId)).toBe(1);
		} finally {
			await isolado.fechar();
		}
	});
});

describe('atribuição', () => {
	it('o escopo vem do papel, e o efeito é imediato', async () => {
		const alvo = await pessoa(null);
		await atribuirPapel(ctx.db, lider, { personId: alvo, roleId: ctx.papeis.membro! }, COM_REAUTH);

		const [a] = await atribuicoesDe(ctx.db, alvo);
		expect(a).toMatchObject({ papel: 'Membro', scopeType: 'self' });

		// Sem cache: o próximo carregamento do ator já reflete.
		expect(can(await ator(alvo), 'event.view', { personId: alvo })).toBe(true);

		await removerAtribuicao(ctx.db, lider, a!.id, COM_REAUTH);
		expect(can(await ator(alvo), 'event.view', { personId: alvo })).toBe(false);
	});

	it('atribuir o mesmo papel duas vezes não duplica', async () => {
		const alvo = await pessoa(null);
		await atribuirPapel(ctx.db, lider, { personId: alvo, roleId: ctx.papeis.membro! }, COM_REAUTH);
		await atribuirPapel(ctx.db, lider, { personId: alvo, roleId: ctx.papeis.membro! }, COM_REAUTH);
		expect(await atribuicoesDe(ctx.db, alvo)).toHaveLength(1);
	});

	it('papel de escopo de grupo é recusado pela tela da pessoa', async () => {
		const alvo = await pessoa(null);
		const r = await recusa(
			atribuirPapel(ctx.db, lider, { personId: alvo, roleId: ctx.papeis.conselheiro! }, COM_REAUTH)
		);
		expect(r.motivo).toBe('escopo_de_grupo');
	});

	it('toda alteração vai para a auditoria com quem, o quê e sobre quem', async () => {
		const alvo = await pessoa(null);
		await atribuirPapel(ctx.db, lider, { personId: alvo, roleId: ctx.papeis.membro! }, COM_REAUTH);
		const [a] = await atribuicoesDe(ctx.db, alvo);
		await removerAtribuicao(ctx.db, lider, a!.id, COM_REAUTH);

		const linhas = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, a!.id));
		const acoes = linhas.map((l) => l.action).sort();
		expect(acoes).toEqual(['rbac.papel_atribuido', 'rbac.papel_removido']);
		expect(linhas.every((l) => l.actorPersonId === lider.personId)).toBe(true);
		expect(linhas.find((l) => l.action === 'rbac.papel_removido')!.before).toMatchObject({
			personId: alvo,
			papel: 'Membro'
		});
	});
});

describe('papéis personalizados', () => {
	it('cria com chave derivada do nome, e recusa nome repetido', async () => {
		const id = await criarPapel(
			ctx.db,
			lider,
			{
				name: 'Apoio à Recepção',
				description: null,
				defaultScope: 'self',
				permissoes: ['event.view']
			},
			COM_REAUTH
		);
		const papel = await verPapel(ctx.db, lider, id);
		expect(papel).toMatchObject({ key: 'apoio_a_recepcao', isSystem: false, defaultScope: 'self' });

		const r = await recusa(
			criarPapel(
				ctx.db,
				lider,
				{ name: 'apoio à recepção', defaultScope: 'self', permissoes: [] },
				COM_REAUTH
			)
		);
		expect(r.motivo).toBe('nome_em_uso');
	});

	it('papel de sistema não se exclui', async () => {
		const r = await recusa(excluirPapel(ctx.db, lider, ctx.papeis.visitante!, COM_REAUTH));
		expect(r.motivo).toBe('papel_de_sistema');
	});

	it('papel com gente não se exclui; vazio, sim', async () => {
		const id = await criarPapel(
			ctx.db,
			lider,
			{ name: 'Temporário', defaultScope: 'self', permissoes: ['event.view'] },
			COM_REAUTH
		);
		const alvo = await pessoa(null);
		await atribuirPapel(ctx.db, lider, { personId: alvo, roleId: id }, COM_REAUTH);

		expect((await recusa(excluirPapel(ctx.db, lider, id, COM_REAUTH))).motivo).toBe(
			'papel_com_pessoas'
		);

		const [a] = await atribuicoesDe(ctx.db, alvo);
		await removerAtribuicao(ctx.db, lider, a!.id, COM_REAUTH);
		await excluirPapel(ctx.db, lider, id, COM_REAUTH);
		expect(await verPapel(ctx.db, lider, id)).toBeNull();
	});

	it('atribuição VENCIDA não impede excluir o papel — a tela já não a mostra (varredura)', async () => {
		const id = await criarPapel(
			ctx.db,
			lider,
			{ name: 'Mutirão de março', defaultScope: 'self', permissoes: ['event.view'] },
			COM_REAUTH
		);
		await ctx.db.insert(personRole).values({
			personId: await pessoa(null),
			roleId: id,
			scopeType: 'self',
			expiresAt: new Date(Date.now() - 86_400_000)
		});
		expect((await verPapel(ctx.db, lider, id))!.quemTem).toEqual([]);
		await excluirPapel(ctx.db, lider, id, COM_REAUTH);
		expect(await verPapel(ctx.db, lider, id)).toBeNull();
	});
});

describe('remover pessoa (varredura de 11/10/2026)', () => {
	it('encerra os papéis dela junto', async () => {
		const outroLider = await pessoa('lider');
		await removerPessoa(ctx.db, lider, outroLider);
		expect(await atribuicoesDe(ctx.db, outroLider)).toEqual([]);
	});

	it('papel com person.delete não remove o único administrador ativo', async () => {
		// Banco próprio: o principal tem vários líderes de outros testes.
		const isolado = await criarBancoDeTeste();
		try {
			const [l] = await isolado.db
				.insert(person)
				.values({ teamId: isolado.teamId, fullName: 'Único Líder', birthDate: '1990-01-01' })
				.returning({ id: person.id });
			await isolado.db.insert(personRole).values({
				personId: l!.id,
				roleId: isolado.papeis.lider!,
				scopeType: 'global'
			});
			await isolado.db.insert(userAccount).values({
				personId: l!.id,
				email: 'unico@eagles.test',
				passwordHash: await hashPassword('uma senha de teste comprida')
			});
			const [r] = await isolado.db
				.insert(person)
				.values({ teamId: isolado.teamId, fullName: 'Quem Remove' })
				.returning({ id: person.id });
			const quemRemove: Actor = {
				personId: r!.id,
				teamId: isolado.teamId,
				assignments: [
					{
						roleKey: 'limpeza',
						scopeType: 'global',
						scopeId: null,
						permissions: new Set(['person.view', 'person.delete'] as const)
					}
				]
			};

			const recusada = await recusa(removerPessoa(isolado.db, quemRemove, l!.id));
			expect(recusada.motivo).toBe('ultimo_administrador');
			const [ainda] = await isolado.db.select().from(person).where(eq(person.id, l!.id));
			expect(ainda!.deletedAt, 'a remoção voltou inteira').toBeNull();
		} finally {
			await isolado.fechar();
		}
	});
});

describe('convite (lacuna G1)', () => {
	it('exige papel antes', async () => {
		const alvo = await pessoa(null, { conta: false });
		const r = await recusa(emitirConvite(ctx.db, lider, alvo, COM_REAUTH));
		expect(r.motivo).toBe('sem_papel');
	});

	it('recusa quem está em regime restrito — idade desconhecida conta como possível menor', async () => {
		const alvo = await pessoa('membro', { conta: false, nascimento: null });
		const r = await recusa(emitirConvite(ctx.db, lider, alvo, COM_REAUTH));
		expect(r.motivo).toBe('regime_restrito');
		expect(r.message).toMatch(/data de nascimento/i);
	});

	it('emite para quem tem papel e não tem conta, sem pedir reautenticação', async () => {
		const alvo = await pessoa('membro', { conta: false });
		const c = await emitirConvite(ctx.db, lider, alvo, SEM_REAUTH);
		expect(c.recuperacao).toBe(false);
		expect(c.url).toMatch(/^https:\/\/app\.eagles\.test\/convite\/[A-Za-z0-9_-]{40,}$/);
	});

	it('convite para quem JÁ tem conta é recuperação, e exige reautenticação', async () => {
		const alvo = await pessoa('membro');
		const r = await recusa(emitirConvite(ctx.db, lider, alvo, SEM_REAUTH));
		expect(r.motivo).toBe('reautenticacao');

		const c = await emitirConvite(ctx.db, lider, alvo, COM_REAUTH);
		expect(c.recuperacao).toBe(true);
	});

	it('membro não convida ninguém', async () => {
		const alvo = await pessoa('membro', { conta: false });
		await expect(emitirConvite(ctx.db, membro, alvo, COM_REAUTH)).rejects.toThrow(PolicyDenied);
	});
});

describe('trava 5: convite não é atalho para poder (varredura de 11/10/2026)', () => {
	// Quem emite recebe o link cru — e quem tem o link fica com a conta.
	let grupo: string;
	let conselheiro: Actor;

	beforeAll(async () => {
		grupo = await criarGrupo(ctx, 'PG da Trava 5');
		conselheiro = await ator(await pessoa('conselheiro', { escopoGrupo: grupo }));
	});

	async function noGrupo(personId: string) {
		await ctx.db.insert(groupMembership).values({ groupId: grupo, personId });
		return personId;
	}

	it('conselheiro não gera RECUPERAÇÃO para o líder que é membro do PG dele', async () => {
		const liderNoPg = await noGrupo(await pessoa('lider'));
		const r = await recusa(emitirConvite(ctx.db, conselheiro, liderNoPg, COM_REAUTH));
		expect(r.motivo).toBe('escalada');
	});

	it('nem o PRIMEIRO convite de quem já recebeu papel de líder', async () => {
		const novoLider = await noGrupo(await pessoa('lider', { conta: false }));
		const r = await recusa(emitirConvite(ctx.db, conselheiro, novoLider, COM_REAUTH));
		expect(r.motivo).toBe('escalada');
		// Quem administra os acessos continua podendo.
		expect((await emitirConvite(ctx.db, lider, novoLider, COM_REAUTH)).url).toMatch(/convite/);
	});

	it('o caso de todo dia continua: conselheiro convida quem é membro do PG dele', async () => {
		const membroDoPg = await noGrupo(await pessoa('membro', { conta: false }));
		const c = await emitirConvite(ctx.db, conselheiro, membroDoPg, SEM_REAUTH);
		expect(c.recuperacao).toBe(false);
	});

	it('conta desativada: nem emite, nem aceita um convite antigo', async () => {
		const alvo = await pessoa('membro');
		const antigo = await emitirConvite(ctx.db, lider, alvo, COM_REAUTH);
		await ctx.db
			.update(userAccount)
			.set({ disabledAt: new Date() })
			.where(eq(userAccount.personId, alvo));

		const r = await recusa(emitirConvite(ctx.db, lider, alvo, COM_REAUTH));
		expect(r.motivo).toBe('conta_desativada');

		const aceite = await aceitarConvite(ctx.db, {
			token: antigo.url.split('/').pop()!,
			senha: 'uma senha nova bem comprida',
			identificador: 'desativada@eagles.test'
		});
		expect(aceite.ok).toBe(false);
	});
});
