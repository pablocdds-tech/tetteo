import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_FINANCEIRO } from "./permissoes";

/**
 * Financeiro — a resposta do dia 5.
 *
 * O último elo: Compras decide por quanto comprar, Estoque diz quanto saiu, a
 * Ficha diz quanto deveria custar, e aqui o dinheiro entra e sai de verdade.
 *
 * "Fechamento de caixa" não entra na navegação porque depende do PDV para
 * existir: conferir a gaveta contra as vendas do turno exige saber quais foram
 * as vendas do turno. Uma tela de conferência sem o lado de lá seria uma
 * planilha com nome bonito.
 *
 * Exige unidade: caixa é físico. A gaveta fica num endereço, o boleto vence no
 * CNPJ de uma loja, e um saldo somado da rede não paga a conta de luz de
 * nenhuma delas.
 */
export const manifestoFinanceiro: ManifestoDoApp = {
  chave: "financeiro",
  nome: "Financeiro",
  subtitulo: "Contas, caixa & resultado",
  icone: "moeda",
  cor: { fundo: "#14365D", frente: "#FFFFFF" },
  area: "gestao",
  rota: "/financeiro",
  navegacao: [
    { rota: "/financeiro", nome: "Visão do caixa" },
    { rota: "/financeiro/pagar", nome: "Contas a pagar" },
    { rota: "/financeiro/receber", nome: "Contas a receber" },
    {
      rota: "/financeiro/resultado",
      nome: "Resultado",
      permissao: "financeiro.resultado",
    },
    {
      rota: "/financeiro/categorias",
      nome: "Categorias e contas",
      permissao: "financeiro.lancar",
    },
  ],
  permissaoParaVer: "financeiro.ver",
  permissoes: [...PERMISSOES_FINANCEIRO],
  eventosQuePublica: ["conta.criada", "conta.quitada"],
  eventosQueEscuta: ["nota.lancada", "pedido.recebido"],
  comportamentoNaRede: "exige-unidade",
};
