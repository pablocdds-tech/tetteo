import type { ManifestoDoApp } from "@/core/registry/tipos";
import { manifestoCardapio } from "@/modules/cardapio/manifest";

/**
 * O REGISTRO DE APPS — "Módulos da Rede".
 *
 * A única lista do sistema inteiro que conhece todos os Apps. Ela vive FORA do
 * Core de propósito: o Core não pode importar de nenhum App — é a regra que o
 * linter verifica. Este arquivo é a raiz da composição.
 *
 * Instalar um App novo é acrescentar uma entrada aqui. Nenhum arquivo do Core
 * muda: o painel de módulos, a navegação lateral e o editor de papéis passam a
 * incluí-lo sozinhos.
 *
 * Cada módulo declara também a sua NAVEGAÇÃO INTERNA. É isso que mantém a
 * barra lateral enxuta: ela nunca lista os módulos todos, só as opções do
 * módulo aberto. Trocar de módulo é outro gesto — o painel flutuante do topo.
 *
 * A ORDEM aqui é a ordem que aparece no painel, e ela segue a corrente do
 * negócio, não o alfabeto: Compras → Cardápio → Estoque → Financeiro. Quem
 * abre o painel lê o caminho do dinheiro.
 */
export const APPS_REGISTRADOS: ManifestoDoApp[] = [
  {
    chave: "analytics",
    nome: "Analytics",
    subtitulo: "Vendas & KPIs",
    icone: "📊",
    cor: { fundo: "#7C3AED", frente: "#FFFFFF" },
    area: "gestao",
    rota: "/analytics",
    navegacao: [
      { rota: "/analytics", nome: "Visão geral" },
      { rota: "/analytics/vendas", nome: "Vendas" },
      { rota: "/analytics/comparativo", nome: "Comparar unidades" },
    ],
    permissaoParaVer: "analytics.ver",
    permissoes: [
      { chave: "analytics.ver", descricao: "Ver indicadores e relatórios" },
    ],
    comportamentoNaRede: "compara",
    emConstrucao: true,
  },

  {
    chave: "crm",
    nome: "CRM",
    subtitulo: "Clientes & reservas",
    icone: "❤️",
    cor: { fundo: "#E11D62", frente: "#FFFFFF" },
    area: "gestao",
    rota: "/crm",
    navegacao: [
      { rota: "/crm", nome: "Clientes" },
      { rota: "/crm/reservas", nome: "Reservas" },
      { rota: "/crm/campanhas", nome: "Campanhas" },
    ],
    permissaoParaVer: "crm.ver",
    permissoes: [
      { chave: "crm.ver", descricao: "Ver clientes e reservas" },
      { chave: "crm.editar", descricao: "Cadastrar e alterar clientes" },
    ],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "assistente",
    nome: "Severina",
    subtitulo: "Atendimento virtual",
    icone: "✨",
    cor: { fundo: "#4F46E5", frente: "#FFFFFF" },
    area: "apoio",
    rota: "/assistente",
    navegacao: [
      { rota: "/assistente", nome: "Conversas" },
      { rota: "/assistente/treinamento", nome: "Treinamento" },
    ],
    permissaoParaVer: "assistente.ver",
    permissoes: [
      { chave: "assistente.ver", descricao: "Ver conversas do atendimento" },
    ],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "compras",
    nome: "Compras",
    subtitulo: "Catálogo & cotações",
    icone: "🛒",
    cor: { fundo: "#E23B2E", frente: "#FFFFFF" },
    area: "gestao",
    rota: "/compras",
    navegacao: [
      { rota: "/compras", nome: "Pedidos" },
      { rota: "/compras/cotacoes", nome: "Cotações" },
      { rota: "/compras/fornecedores", nome: "Fornecedores" },
      { rota: "/compras/catalogo", nome: "Catálogo" },
    ],
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

  manifestoCardapio,

  /**
   * ESTOQUE — onde a ficha técnica deixa de ser teoria.
   *
   * O Cardápio diz quanto o prato DEVERIA custar. O Estoque diz quanto ele
   * custou de verdade: contagem, perdas, produção interna (massa, molho) e o
   * CMV. Sem ele a corrente de eventos morre no meio — Compras registra a
   * entrada e ninguém baixa a saída.
   *
   * Exige unidade: estoque somado da rede não existe. Farinha na câmara fria
   * de uma loja não faz pizza na outra.
   */
  {
    chave: "estoque",
    nome: "Estoque",
    subtitulo: "Contagem, perdas & CMV",
    icone: "📦",
    cor: { fundo: "#B45309", frente: "#FFFFFF" },
    area: "operacao",
    rota: "/estoque",
    navegacao: [
      { rota: "/estoque", nome: "Posição" },
      { rota: "/estoque/movimentacoes", nome: "Movimentações" },
      { rota: "/estoque/contagens", nome: "Contagens" },
      { rota: "/estoque/producao", nome: "Produção" },
      { rota: "/estoque/cmv", nome: "CMV" },
    ],
    permissaoParaVer: "estoque.ver",
    permissoes: [
      { chave: "estoque.ver", descricao: "Ver posição e movimentações" },
      {
        chave: "estoque.movimentar",
        descricao: "Lançar entradas, saídas e perdas",
      },
      { chave: "estoque.contar", descricao: "Fazer e fechar contagens" },
    ],
    eventosQuePublica: [
      "estoque.movimentado",
      "estoque.abaixo-do-minimo",
      "estoque.contagem-fechada",
    ],
    eventosQueEscuta: ["compra.recebida", "pedido.entregue"],
    comportamentoNaRede: "exige-unidade",
    emConstrucao: true,
  },

  /**
   * FINANCEIRO — a resposta do dia 5.
   *
   * Contas a pagar e a receber, fluxo de caixa, conferência do caixa do PDV e
   * o resultado do mês. É o fim da corrente: compra criada vira conta a pagar,
   * pedido entregue vira dinheiro a receber.
   *
   * Consolida: você quer o resultado da rede somado E de cada unidade.
   */
  {
    chave: "financeiro",
    nome: "Financeiro",
    subtitulo: "Contas, caixa & resultado",
    icone: "💰",
    cor: { fundo: "#14365D", frente: "#FFFFFF" },
    area: "gestao",
    rota: "/financeiro",
    navegacao: [
      { rota: "/financeiro", nome: "Visão do caixa" },
      { rota: "/financeiro/pagar", nome: "Contas a pagar" },
      { rota: "/financeiro/receber", nome: "Contas a receber" },
      { rota: "/financeiro/fechamento", nome: "Fechamento de caixa" },
      {
        rota: "/financeiro/resultado",
        nome: "Resultado",
        permissao: "financeiro.resultado",
      },
    ],
    permissaoParaVer: "financeiro.ver",
    permissoes: [
      { chave: "financeiro.ver", descricao: "Ver contas e fluxo de caixa" },
      {
        chave: "financeiro.lancar",
        descricao: "Lançar contas a pagar e a receber",
      },
      {
        chave: "financeiro.baixar",
        descricao: "Dar baixa em pagamentos e recebimentos",
      },
      {
        chave: "financeiro.resultado",
        descricao: "Ver o resultado (DRE) da rede",
      },
    ],
    eventosQuePublica: ["conta.criada", "conta.paga", "caixa.fechado"],
    eventosQueEscuta: ["compra.criada", "pedido.entregue"],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "delivery",
    nome: "Delivery",
    subtitulo: "Canal próprio, ao vivo",
    icone: "🛵",
    cor: { fundo: "#E4262B", frente: "#FFFFFF" },
    area: "operacao",
    rota: "/delivery",
    navegacao: [
      { rota: "/delivery", nome: "Pedidos ao vivo" },
      { rota: "/delivery/entregadores", nome: "Entregadores" },
      { rota: "/delivery/areas", nome: "Áreas de entrega" },
    ],
    permissaoParaVer: "delivery.ver",
    permissoes: [
      { chave: "delivery.ver", descricao: "Ver pedidos e entregas" },
      { chave: "delivery.operar", descricao: "Despachar e cancelar pedidos" },
    ],
    eventosQuePublica: ["pedido.criado", "pedido.entregue"],
    comportamentoNaRede: "exige-unidade",
    emConstrucao: true,
  },

  {
    chave: "patrimonio",
    nome: "Patrimônio",
    subtitulo: "Equipamentos & manutenção",
    icone: "🔧",
    cor: { fundo: "#4A6173", frente: "#FFFFFF" },
    area: "apoio",
    rota: "/patrimonio",
    navegacao: [
      { rota: "/patrimonio", nome: "Equipamentos" },
      { rota: "/patrimonio/manutencoes", nome: "Manutenções" },
    ],
    permissaoParaVer: "patrimonio.ver",
    permissoes: [
      { chave: "patrimonio.ver", descricao: "Ver equipamentos e manutenções" },
    ],
    comportamentoNaRede: "compara",
    emConstrucao: true,
  },

  {
    chave: "vigia",
    nome: "Vigia",
    subtitulo: "Câmeras & fiscalização",
    icone: "👁️",
    cor: { fundo: "#1668D9", frente: "#FFFFFF" },
    area: "apoio",
    rota: "/vigia",
    navegacao: [
      { rota: "/vigia", nome: "Câmeras" },
      { rota: "/vigia/ocorrencias", nome: "Ocorrências" },
    ],
    permissaoParaVer: "vigia.ver",
    permissoes: [
      { chave: "vigia.ver", descricao: "Ver câmeras e ocorrências" },
    ],
    comportamentoNaRede: "exige-unidade",
    emConstrucao: true,
  },

  {
    chave: "telas",
    nome: "Telas",
    subtitulo: "Conteúdo & sinalização",
    icone: "🖥️",
    cor: { fundo: "#159C8C", frente: "#FFFFFF" },
    area: "apoio",
    rota: "/telas",
    navegacao: [
      { rota: "/telas", nome: "Telas" },
      { rota: "/telas/conteudo", nome: "Conteúdo" },
    ],
    permissaoParaVer: "telas.ver",
    permissoes: [
      { chave: "telas.ver", descricao: "Ver telas e conteúdo exibido" },
    ],
    comportamentoNaRede: "compara",
    emConstrucao: true,
  },

  {
    chave: "pessoas",
    nome: "Pessoas (DP)",
    subtitulo: "Folha, admissões & compliance",
    icone: "👥",
    cor: { fundo: "#F08A2C", frente: "#FFFFFF" },
    area: "pessoas",
    rota: "/pessoas",
    navegacao: [
      { rota: "/pessoas", nome: "Funcionários" },
      { rota: "/pessoas/admissoes", nome: "Admissões" },
      { rota: "/pessoas/folha", nome: "Folha" },
      { rota: "/pessoas/documentos", nome: "Documentos" },
    ],
    permissaoParaVer: "pessoas.ver",
    permissoes: [
      { chave: "pessoas.ver", descricao: "Ver funcionários e documentos" },
      { chave: "pessoas.folha", descricao: "Ver e lançar folha de pagamento" },
    ],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "rh",
    nome: "RH (Cultura)",
    subtitulo: "Recrutamento, eNPS & ASOs",
    icone: "💚",
    cor: { fundo: "#16A085", frente: "#FFFFFF" },
    area: "pessoas",
    rota: "/rh",
    navegacao: [
      { rota: "/rh", nome: "Recrutamento" },
      { rota: "/rh/treinamentos", nome: "Treinamentos" },
      { rota: "/rh/pesquisas", nome: "Pesquisas (eNPS)" },
      { rota: "/rh/asos", nome: "ASOs" },
    ],
    permissaoParaVer: "rh.ver",
    permissoes: [
      { chave: "rh.ver", descricao: "Ver processos de recrutamento e cultura" },
    ],
    comportamentoNaRede: "consolida",
    emConstrucao: true,
  },

  {
    chave: "checklists",
    nome: "Checklists",
    subtitulo: "Compliance operacional",
    icone: "✅",
    cor: { fundo: "#34A853", frente: "#FFFFFF" },
    area: "operacao",
    rota: "/checklists",
    navegacao: [
      { rota: "/checklists", nome: "Do dia" },
      { rota: "/checklists/modelos", nome: "Modelos" },
      { rota: "/checklists/auditorias", nome: "Auditorias" },
    ],
    permissaoParaVer: "checklists.ver",
    permissoes: [
      { chave: "checklists.ver", descricao: "Ver e responder checklists" },
      { chave: "checklists.editar", descricao: "Criar e alterar modelos" },
    ],
    comportamentoNaRede: "compara",
    emConstrucao: true,
  },

  /**
   * Configurações aparece no painel como um destino, mas arquiteturalmente
   * é parte do Core — não tem manifesto próprio, não pode ser desinstalada e
   * não define vocabulário de negócio. Está aqui só para o painel ficar
   * completo, como na referência.
   */
  {
    chave: "configuracoes",
    nome: "Configurações",
    subtitulo: "Integrações & usuários",
    icone: "⚙️",
    cor: { fundo: "#1F2430", frente: "#FFFFFF" },
    area: "apoio",
    rota: "/configuracoes",
    navegacao: [
      { rota: "/configuracoes", nome: "Geral" },
      { rota: "/configuracoes/unidades", nome: "Unidades" },
      { rota: "/configuracoes/usuarios", nome: "Usuários e papéis" },
      { rota: "/configuracoes/integracoes", nome: "Integrações" },
    ],
    permissaoParaVer: "configuracoes.ver",
    permissoes: [
      { chave: "configuracoes.ver", descricao: "Ver configurações da rede" },
      { chave: "configuracoes.editar", descricao: "Alterar configurações" },
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
