import "server-only";

import type { AvisoDoModulo } from "@/core/registry/tipos";
import type { ContextoSessao } from "@/core/sessao/contexto";
import { assistenteDoEstoque } from "@/modules/estoque/assistente";

/**
 * O REGISTRO DE FERRAMENTAS — a segunda raiz de composição do sistema.
 *
 * Mesma ideia do `registro-de-apps.ts`, e pelo mesmo motivo: alguém precisa
 * conhecer todos os módulos, e esse alguém não pode ser nem o Core (que não
 * conhece App) nem um App (que não conhece outro App). É este arquivo, fora de
 * `core/` e fora de `modules/`.
 *
 * `server-only` é essencial aqui, e é a diferença para o registro de apps.
 * Aquele carrega manifesto — nome, ícone, cor — e é importado pela barra
 * lateral, no navegador. Este carrega SERVIÇO, que fala com o banco. Se
 * vazasse para o cliente, iria junto o Prisma inteiro, com as consultas e a
 * forma das tabelas.
 *
 * Instalar um participante novo é acrescentar uma linha em `PARTICIPANTES`.
 * Nenhum arquivo da Severina muda.
 */
export type ParticipanteDoAssistente = {
  /** A chave do App, como no manifesto: "estoque", "checklists", … */
  modulo: string;

  /** O que este App tem a lembrar hoje. */
  avisos(contexto: ContextoSessao, agora: Date): Promise<AvisoDoModulo[]>;
};

export const PARTICIPANTES: ParticipanteDoAssistente[] = [assistenteDoEstoque];
