import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_COMPRAS } from "./permissoes";

/**
 * Compras.
 *
 * O Estoque diz quanto saiu, a Ficha diz quanto deveria custar. Compras
 * responde a pergunta que vem antes: por quanto dá para comprar?
 *
 * É onde o dinheiro é economizado de verdade. Mexer no preço do cardápio
 * assusta o cliente; trocar de fornecedor não assusta ninguém e costuma valer
 * mais.
 *
 * Exige unidade: preço de hortifrúti no Centro não é preço na Zona Sul, e uma
 * cotação de rede esconderia justamente a diferença que importa.
 */
export const manifestoCompras: ManifestoDoApp = {
  chave: "compras",
  nome: "Compras",
  subtitulo: "Cotações & pedidos",
  icone: "🛒",
  cor: { fundo: "#E23B2E", frente: "#FFFFFF" },
  area: "gestao",
  rota: "/compras",
  navegacao: [
    { rota: "/compras", nome: "Pedidos" },
    { rota: "/compras/cotacoes", nome: "Cotações" },
    { rota: "/compras/fornecedores", nome: "Fornecedores" },
  ],
  permissaoParaVer: "compras.ver",
  permissoes: [...PERMISSOES_COMPRAS],
  eventosQuePublica: ["pedido.emitido", "pedido.recebido"],
  comportamentoNaRede: "exige-unidade",
};
