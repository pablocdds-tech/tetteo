import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_CARDAPIO } from "./permissoes";

/**
 * Cardápio & Fichas Técnicas.
 *
 * O primeiro App, e a base de todos os outros: Estoque, Compras, Financeiro e
 * Analytics dependem dos insumos e das fichas daqui.
 *
 * "Pratos" saiu da navegação: prato e ficha técnica não são duas coisas. Um
 * prato É uma ficha que tem preço de venda. Duas telas para o mesmo objeto
 * criariam a dúvida "cadastro em qual?" e, com ela, cadastro em dobro — foi
 * exatamente o que aconteceu com os locais de estoque no sistema antigo.
 */
export const manifestoCardapio: ManifestoDoApp = {
  chave: "cardapio",
  nome: "Cardápio",
  subtitulo: "Pratos & insumos",
  icone: "prato",
  cor: { fundo: "#FBE9E3", frente: "#C4512F" },
  area: "operacao",
  rota: "/cardapio",
  navegacao: [
    { rota: "/cardapio", nome: "Insumos" },
    { rota: "/cardapio/fichas", nome: "Fichas técnicas" },
  ],
  permissaoParaVer: "cardapio.ver",
  permissoes: [...PERMISSOES_CARDAPIO],
  eventosQuePublica: ["insumo.criado", "insumo.alterado", "insumo.excluido"],
  comportamentoNaRede: "consolida",
};
