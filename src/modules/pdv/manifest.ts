import type { ManifestoDoApp } from "@/core/registry/tipos";
import { PERMISSOES_PDV } from "./permissoes";
export const manifestoPdv: ManifestoDoApp = {
  chave: "pdv",
  nome: "PDV",
  subtitulo: "Vendas & caixa",
  icone: "caixa",
  cor: { fundo: "#0066cc", frente: "#ffffff" },
  area: "operacao",
  rota: "/pdv",
  navegacao: [
    {
      rota: "/pdv/preparacao",
      nome: "Preparar operação",
      permissao: "pdv.configurar",
    },
    { rota: "/pdv", nome: "Frente de caixa" },
    { rota: "/pdv/vendas", nome: "Vendas" },
    { rota: "/pdv/caixa", nome: "Caixa" },
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
