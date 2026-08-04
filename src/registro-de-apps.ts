import type { ManifestoDoApp } from "@/core/registry/tipos";
import { manifestoCardapio } from "@/modules/cardapio/manifest";

/**
 * O REGISTRO DE APPS.
 *
 * A única lista do sistema inteiro que conhece todos os Apps. Ela vive FORA do
 * Core de propósito: o Core não pode importar de nenhum App — é a regra que o
 * linter verifica. Este arquivo é a raiz da composição, o lugar onde as peças
 * são amarradas.
 *
 * Instalar um App novo é acrescentar uma linha aqui. Nenhum arquivo do Core
 * muda: a barra lateral, a tela inicial, o editor de papéis e a busca passam a
 * incluí-lo sozinhos.
 *
 * Os Apps marcados com `emConstrucao` já aparecem na tela inicial, com selo, e
 * só para quem é Diretor. É proposital: mostra para onde o sistema está indo
 * sem prometer o que ainda não existe.
 */
export const APPS_REGISTRADOS: ManifestoDoApp[] = [
  manifestoCardapio,

  {
    chave: "estoque",
    nome: "Estoque",
    subtitulo: "Contagens & perdas",
    icone: "📦",
    cor: { fundo: "#FAF0DC", frente: "#9A6D14" },
    area: "operacao",
    rota: "/estoque",
    permissaoParaVer: "estoque.ver",
    permissoes: [
      { chave: "estoque.ver", descricao: "Ver saldos e movimentações" },
      { chave: "estoque.contar", descricao: "Fazer contagem de estoque" },
      { chave: "estoque.ajustar", descricao: "Ajustar saldo e lançar perdas" },
    ],
    eventosQueEscuta: ["compra.recebida", "venda.registrada"],
    comportamentoNaRede: "compara",
    emConstrucao: true,
  },

  {
    chave: "compras",
    nome: "Compras",
    subtitulo: "Cotações & fornecedores",
    icone: "🛒",
    cor: { fundo: "#E7EAFB", frente: "#3E51B5" },
    area: "gestao",
    rota: "/compras",
    permissaoParaVer: "compras.ver",
    permissoes: [
      { chave: "compras.ver", descricao: "Ver pedidos e fornecedores" },
      { chave: "compras.lancar", descricao: "Lançar compras e notas" },
      { chave: "compras.aprovar", descricao: "Aprovar cotações" },
    ],
    eventosQuePublica: ["compra.criada", "compra.recebida"],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "financeiro",
    nome: "Financeiro",
    subtitulo: "Caixa & contas",
    icone: "💰",
    cor: { fundo: "#E0F3EC", frente: "#1B7A5A" },
    area: "gestao",
    rota: "/financeiro",
    permissaoParaVer: "financeiro.ver",
    permissoes: [
      { chave: "financeiro.ver", descricao: "Ver caixa, contas e fluxo" },
      { chave: "financeiro.lancar", descricao: "Lançar contas e pagamentos" },
    ],
    eventosQueEscuta: ["compra.criada", "venda.registrada"],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "analytics",
    nome: "Analytics",
    subtitulo: "Vendas & indicadores",
    icone: "📊",
    cor: { fundo: "#E3EEFA", frente: "#2A6BA8" },
    area: "gestao",
    rota: "/analytics",
    permissaoParaVer: "analytics.ver",
    permissoes: [
      { chave: "analytics.ver", descricao: "Ver indicadores e relatórios" },
    ],
    comportamentoNaRede: "compara",
    emConstrucao: true,
  },

  {
    chave: "pessoas",
    nome: "Pessoas",
    subtitulo: "Folha & admissões",
    icone: "👥",
    cor: { fundo: "#EDF2E0", frente: "#5C7A2E" },
    area: "pessoas",
    rota: "/pessoas",
    permissaoParaVer: "pessoas.ver",
    permissoes: [
      { chave: "pessoas.ver", descricao: "Ver funcionários e documentos" },
    ],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },
];

export const AREAS = [
  { chave: "operacao", nome: "Operação" },
  { chave: "gestao", nome: "Gestão" },
  { chave: "pessoas", nome: "Pessoas" },
  { chave: "apoio", nome: "Apoio" },
] as const;
