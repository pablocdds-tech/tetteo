import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_COMPRAS } from "./permissoes";

/**
 * Compras — do pedido da loja à conferência do recebimento.
 *
 * A loja diz o que precisa (requisição), a rede consolida (rodada), os
 * fornecedores cotam (link), o comprador compara e escolhe, o Diretor aprova,
 * a fila envia, e a loja confere o que chegou — com a entrada no estoque pela
 * nota de entrada.
 *
 * "Consolida" na rede: a rodada é da rede inteira. O que é físico —
 * requisição, pedido, recebimento — continua por loja, e cada tela diz isso.
 */
export const manifestoCompras: ManifestoDoApp = {
  chave: "compras",
  nome: "Compras",
  subtitulo: "Rodadas, cotações & recebimento",
  icone: "carrinho",
  cor: { fundo: "#E23B2E", frente: "#FFFFFF" },
  area: "gestao",
  rota: "/compras",
  navegacao: [
    { rota: "/compras", nome: "Rodadas" },
    {
      rota: "/compras/requisicao",
      nome: "Requisição",
      permissao: "compras.requisitar",
    },
    {
      rota: "/compras/comparacao",
      nome: "Comparação",
      permissao: "compras.cotar",
    },
    {
      rota: "/compras/aprovacao",
      nome: "Aprovação",
      permissao: "compras.aprovar",
    },
    { rota: "/compras/pedidos", nome: "Pedidos e envios" },
    {
      rota: "/compras/recebimento",
      nome: "Recebimento",
      permissao: "compras.receber",
    },
    { rota: "/compras/fornecedores", nome: "Fornecedores" },
    {
      rota: "/compras/configuracoes",
      nome: "Configurações",
      permissao: "compras.configurar",
    },
  ],
  permissaoParaVer: "compras.ver",
  permissoes: [...PERMISSOES_COMPRAS],
  eventosQuePublica: ["pedido.aprovado", "recebimento.conferido"],
  comportamentoNaRede: "consolida",
};
