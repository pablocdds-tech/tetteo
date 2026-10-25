import type { ManifestoDoApp } from "@/core/registry/tipos";
export const manifestoAnalytics: ManifestoDoApp = {
  chave: "analytics",
  nome: "Analytics",
  subtitulo: "Vendas & KPIs",
  icone: "grafico",
  cor: { fundo: "#7C3AED", frente: "#FFFFFF" },
  area: "gestao",
  rota: "/analytics",
  navegacao: [{ rota: "/analytics/vendas", nome: "Vendas" }],
  permissaoParaVer: "analytics.ver",
  permissoes: [
    { chave: "analytics.ver", descricao: "Ver indicadores e relatórios" },
  ],
  comportamentoNaRede: "compara",
};
