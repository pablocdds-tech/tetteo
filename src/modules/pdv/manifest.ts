import type { ManifestoDoApp } from "@/core/registry/tipos";
import { PERMISSOES_PDV } from "./permissoes";
export const manifestoPdv: ManifestoDoApp = {
  chave: "pdv",
  nome: "PDV",
  marca: "Vitaliano",
  subtitulo: "Vendas & caixa",
  icone: "caixa",
  cor: { fundo: "#8b2fd0", frente: "#ffffff" },
  area: "operacao",
  rota: "/pdv",
  navegacao: [
    {
      rota: "/pdv",
      nome: "Gestão de pedidos",
      titulo: "Últimos pedidos",
      icone: "lista-conferida",
    },
    {
      rota: "/pdv/novo-pedido",
      nome: "Novo pedido",
      icone: "mais",
      somenteAcao: true,
      permissao: "pdv.vender",
    },
    { rota: "/pdv/caixa", nome: "Caixa", icone: "moeda" },
    {
      rota: "/pdv/vendas",
      nome: "Histórico de pedidos",
      icone: "lista-conferida",
    },
    {
      rota: "/pdv/entregas/areas",
      nome: "Áreas de entrega",
      icone: "entrega",
      grupo: "Delivery",
      permissao: "pdv.configurar",
    },
    {
      rota: "/pdv/entregas/entregadores",
      nome: "Entregadores",
      icone: "entrega",
      grupo: "Delivery",
      permissao: "pdv.entrega",
    },
    {
      rota: "/pdv/catalogo",
      nome: "Catálogo",
      icone: "prato",
      permissao: "pdv.configurar",
    },
    {
      rota: "/pdv/preparacao",
      nome: "Preparar operação",
      icone: "ferramenta",
      grupo: "Configurações",
      permissao: "pdv.configurar",
    },
  ],
  permissaoParaVer: "pdv.ver",
  permissoes: PERMISSOES_PDV,
  eventosQueEscuta: ["pedido_externo.conferido"],
  comportamentoNaRede: "exige-unidade",
};
