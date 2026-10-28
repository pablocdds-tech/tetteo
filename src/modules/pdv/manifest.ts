import type { ManifestoDoApp } from "@/core/registry/tipos";
import { PERMISSOES_PDV } from "./permissoes";
export const manifestoPdv: ManifestoDoApp = {
  chave: "pdv",
  nome: "PDV",
  subtitulo: "Vendas & caixa",
  icone: "caixa",
  cor: { fundo: "#8b2fd0", frente: "#ffffff" },
  area: "operacao",
  rota: "/pdv",
  navegacao: [
    { rota: "/pdv", nome: "Gestão de pedidos", icone: "lista-conferida" },
    {
      rota: "/pdv/novo-pedido",
      nome: "Novo pedido",
      icone: "mais",
      permissao: "pdv.vender",
    },
    {
      rota: "/pdv/preparacao",
      nome: "Preparar operação",
      icone: "ferramenta",
      permissao: "pdv.configurar",
    },
    { rota: "/pdv/vendas", nome: "Histórico de pedidos", icone: "relogio" },
    { rota: "/pdv/caixa", nome: "Caixa", icone: "moeda" },
    {
      rota: "/pdv/entregas/areas",
      nome: "Áreas de entrega",
      icone: "casa",
      permissao: "pdv.configurar",
    },
    {
      rota: "/pdv/entregas/entregadores",
      nome: "Entregadores",
      icone: "entrega",
      permissao: "pdv.entrega",
    },
    {
      rota: "/pdv/catalogo",
      nome: "Catálogo do PDV",
      icone: "prato",
      permissao: "pdv.configurar",
    },
  ],
  permissaoParaVer: "pdv.ver",
  permissoes: PERMISSOES_PDV,
  eventosQueEscuta: ["pedido_externo.conferido"],
  comportamentoNaRede: "exige-unidade",
};
