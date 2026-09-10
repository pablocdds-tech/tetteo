import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_CHECKLISTS } from "./permissoes";

/**
 * Checklists.
 *
 * O App que a equipe abre todo dia. O Estoque é semanal e é do dono; o
 * checklist é diário e é de quem está na loja — por isso a tela inicial não é
 * um cadastro, é a lista do que falta fazer hoje.
 *
 * Compara: a mesma abertura respondida nas duas lojas vira uma nota por loja,
 * e a diferença entre 96% e 71% é o tipo de coisa que só aparece quando a
 * pergunta é literalmente a mesma nos dois lugares.
 */
export const manifestoChecklists: ManifestoDoApp = {
  chave: "checklists",
  nome: "Checklists",
  subtitulo: "Abertura, fechamento & pendências",
  icone: "lista-conferida",
  cor: { fundo: "#34A853", frente: "#FFFFFF" },
  area: "operacao",
  rota: "/checklists",
  navegacao: [
    { rota: "/checklists", nome: "Do dia" },
    { rota: "/checklists/pendencias", nome: "Pendências" },
    { rota: "/checklists/historico", nome: "Histórico" },
    {
      rota: "/checklists/modelos",
      nome: "Modelos",
      permissao: "checklists.editar",
    },
  ],
  permissaoParaVer: "checklists.ver",
  permissoes: [...PERMISSOES_CHECKLISTS],
  eventosQuePublica: ["checklist.fechado", "pendencia.aberta"],
  comportamentoNaRede: "compara",
};
