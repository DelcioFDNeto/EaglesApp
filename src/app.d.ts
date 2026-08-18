import type { Actor } from '$server/policy/policy';
import type { SessionRecord } from '$server/auth/session';

declare global {
	namespace App {
		interface Locals {
			/** Quem está agindo nesta requisição. `null` quando não autenticado. */
			actor: Actor | null;
			/** Sessão ativa, para revogação e reautenticação. */
			session: SessionRecord | null;
			/** Nome da pessoa autenticada, para o cabeçalho. */
			displayName: string | null;
			/** Identificador da requisição, ecoado em logs e erros. */
			requestId: string;
		}

		interface PageData {
			usuario?: {
				personId: string;
				nome: string;
			} | null;
		}

		interface Error {
			code?: string;
			requestId?: string;
		}
	}
}

export {};
