import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_ESTOQUE } from "./permissoes";

/**
 * Estoque.
 *
 * O App existe para entregar um número: o CMV real do período. Toda a
 * navegação abaixo é o caminho até ele — conta, lança o que entrou, conta de
 * novo. Nada aqui depende do PDV ou de ficha técnica.
 *
 * Exige unidade: estoque somado da rede não existe. Farinha na câmara fria de
 * uma loja não vira pizza na outra, e um CMV de rede sem contagem por loja é
 * um número sem dono.
 */
export const manifestoEstoque: ManifestoDoApp = {
  chave: "estoque",
  nome: "Estoque",
  subtitulo: "Contagem, notas & CMV",
  icone: "caixa",
  cor: { fundo: "#B45309", frente: "#FFFFFF" },
  area: "operacao",
  rota: "/estoque",
  navegacao: [
    { rota: "/estoque", nome: "Posição" },
    { rota: "/estoque/contagens", nome: "Contagens" },
    { rota: "/estoque/entradas", nome: "Entradas" },
    { rota: "/estoque/movimentos", nome: "Movimentos" },
    { rota: "/estoque/cmv", nome: "CMV", permissao: "estoque.custos" },
    {
      rota: "/estoque/importar",
      nome: "Importar cadastro",
      permissao: "estoque.lancar",
    },
  ],
  permissaoParaVer: "estoque.ver",
  permissoes: [...PERMISSOES_ESTOQUE],
  eventosQuePublica: ["nota.lancada", "nota.cancelada", "contagem.fechada"],
  comportamentoNaRede: "exige-unidade",

  /// O banco já existe; as telas não. Sai daqui quando Contagens e Entradas
  /// estiverem de pé — até lá a equipe não vê um módulo vazio.
  emConstrucao: true,
};
