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
    { rota: "/pdv", nome: "Gestão de pedidos" },
    { rota: "/pdv/novo-pedido", nome: "Novo pedido", permissao: "pdv.vender" },
    {
      rota: "/pdv/preparacao",
      nome: "Preparar operação",
      permissao: "pdv.configurar",
    },
    { rota: "/pdv/vendas", nome: "Histórico de pedidos" },
    { rota: "/pdv/caixa", nome: "Caixa" },
    {
      rota: "/pdv/entregas/areas",
      nome: "Áreas de entrega",
      permissao: "pdv.configurar",
    },
    {
      rota: "/pdv/entregas/entregadores",
      nome: "Entregadores",
      permissao: "pdv.entrega",
    },
    {
      rota: "/pdv/catalogo",
      nome: "Catálogo do PDV",
      permissao: "pdv.configurar",
    },
  ],
  permissaoParaVer: "pdv.ver",
  permissoes: PERMISSOES_PDV,
  comportamentoNaRede: "exige-unidade",
};
