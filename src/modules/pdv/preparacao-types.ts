export type PendenciaPreparacao = {
  codigo: string;
  nivel: "BLOQUEIO" | "ESTOQUE" | "AVISO";
  mensagem: string;
  href: string;
  acao: string;
};

export type ProdutoPreparacao = {
  id: string;
  nome: string;
  categoria: string;
  ativo: boolean;
  precoCentavos: number | null;
  codigo: string;
  /** Sem bloqueios de cadastro; não garante todas as combinações ou o saldo futuro. */
  pronto: boolean;
  pendencias: PendenciaPreparacao[];
  estoque: {
    insumoId: string;
    nome: string;
    unidade: string;
    necessarioBase: number;
    disponivel: number | null;
  }[];
};

export type PreparacaoPdv = {
  unidadeId: string;
  unidadeNome: string;
  localId: string | null;
  localNome: string | null;
  caixaAberto: boolean;
  locais: { id: string; nome: string }[];
  contadores: {
    produtos: number;
    prontos: number;
    bloqueados: number;
    alertasEstoque: number;
    avisos: number;
  };
  etapas: {
    id: string;
    titulo: string;
    descricao: string;
    status: "OK" | "PENDENTE" | "ATENCAO";
    href: string;
    acao: string;
  }[];
  produtos: ProdutoPreparacao[];
};
