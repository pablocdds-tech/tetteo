import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_FINANCEIRO } from "./permissoes";

/** Lançamentos e conciliação por unidade; Inter somente para consulta e baixa. */
export const manifestoFinanceiro: ManifestoDoApp = {
  chave: "financeiro",
  nome: "Financeiro",
  subtitulo: "Lançamentos & conciliação Inter",
  icone: "moeda",
  cor: { fundo: "#14365D", frente: "#FFFFFF" },
  area: "gestao",
  rota: "/financeiro",
  navegacao: [
    { rota: "/financeiro/lancamentos", nome: "Lançamentos" },
    { rota: "/financeiro/conciliacao", nome: "Conciliação Inter" },
    { rota: "/financeiro/pessoas", nome: "Pessoas" },
    { rota: "/financeiro/planos", nome: "Plano de contas" },
    { rota: "/financeiro/contas", nome: "Empresas e contas" },
    { rota: "/financeiro/transferencias", nome: "Transferências" },
    { rota: "/financeiro/centros", nome: "Centros de custo" },
    {
      rota: "/financeiro/integracoes",
      nome: "Integrações bancárias",
      permissao: "*",
    },
    {
      rota: "/financeiro/dre",
      nome: "Resultado",
      permissao: "financeiro.resultado",
    },
  ],
  permissaoParaVer: "financeiro.ver",
  permissoes: [...PERMISSOES_FINANCEIRO],
  eventosQuePublica: ["conta.criada", "conta.quitada"],
  eventosQueEscuta: ["nota.lancada", "pedido.recebido"],
  comportamentoNaRede: "exige-unidade",
};
