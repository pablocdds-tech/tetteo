import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_CARDAPIO } from "./permissoes";

/**
 * Cardápio & Fichas Técnicas.
 *
 * O primeiro App, e a base de todos os outros: Estoque, Compras, Financeiro e
 * Analytics dependem dos insumos e das fichas daqui.
 */
export const manifestoCardapio: ManifestoDoApp = {
  chave: "cardapio",
  nome: "Cardápio",
  subtitulo: "Insumos & fichas técnicas",
  icone: "🍽️",
  cor: { fundo: "#FBE9E3", frente: "#C4512F" },
  area: "operacao",
  rota: "/cardapio",
  permissaoParaVer: "cardapio.ver",
  permissoes: [...PERMISSOES_CARDAPIO],
  eventosQuePublica: ["insumo.criado", "insumo.alterado", "insumo.excluido"],
  comportamentoNaRede: "consolida",
};
