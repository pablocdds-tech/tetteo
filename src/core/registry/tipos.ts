/**
 * O CONTRATO DE UM APP.
 *
 * Este arquivo é a peça que sustenta a metáfora de sistema operacional. Cada
 * App se declara ao Core através de um manifesto — e o Core não precisa saber
 * nada além disso.
 *
 * O que isso permite: instalar um App novo é criar uma pasta, escrever um
 * manifesto e registrá-lo numa lista. O ícone aparece na tela inicial, a rota
 * passa a resolver, as permissões entram no editor de papéis — e NENHUM
 * arquivo do Core é alterado.
 */

/** Onde o App aparece agrupado na barra lateral e na tela inicial. */
export type AreaDoApp = "operacao" | "gestao" | "pessoas" | "apoio";

/**
 * Como o App se comporta quando o usuário está vendo a REDE INTEIRA em vez de
 * uma unidade só. Nem tudo faz sentido consolidado.
 */
export type ComportamentoNaRede =
  /** Soma as unidades (faturamento total, custo total). */
  | "consolida"
  /** Compara lado a lado (ranking de lojas). */
  | "compara"
  /** Não faz sentido na rede — exige escolher uma unidade. */
  | "exige-unidade";

export type ManifestoDoApp = {
  /**
   * Identificador técnico, estável e vitalício. Usado em permissões, eventos
   * e rotas. NUNCA muda — renomear quebraria tudo que depende dele.
   */
  chave: string;

  /** O que aparece na tela. Pode ser renomeado sem quebrar nada por baixo. */
  nome: string;

  /**
   * Elimina a dúvida de "onde eu clico para fazer X". Descreve TAREFA, não
   * categoria: "Pratos & fichas técnicas", não "Gestão de cardápio".
   */
  subtitulo: string;

  /** Emoji ou nome do ícone. */
  icone: string;

  /**
   * Cor de identidade, fixa e vitalícia. As pessoas encontram por cor antes de
   * ler o nome — trocar depois de lançado apaga a memória de quem já usava.
   */
  cor: { fundo: string; frente: string };

  area: AreaDoApp;

  /** Prefixo de rota que o App é dono. Tudo abaixo dele pertence ao App. */
  rota: string;

  /**
   * A navegação DENTRO do App — o que aparece na barra lateral quando ele
   * está aberto.
   *
   * É isto que faz a barra lateral não virar uma lista de todos os módulos:
   * ela mostra só o que existe dentro do módulo escolhido. Trocar de módulo é
   * um gesto separado, no painel flutuante do topo.
   */
  navegacao: { rota: string; nome: string; permissao?: string }[];

  /**
   * A permissão mínima para o App sequer aparecer. Quem não tem, não vê o
   * ícone — em vez de ver e tomar "acesso negado".
   */
  permissaoParaVer: string;

  /** O vocabulário completo de permissões que este App define. */
  permissoes: { chave: string; descricao: string }[];

  /** Fatos que este App anuncia ao sistema. Sempre no passado. */
  eventosQuePublica?: string[];

  /** Fatos de outros Apps a que este reage. */
  eventosQueEscuta?: string[];

  comportamentoNaRede: ComportamentoNaRede;

  /** Ainda em construção — aparece com um selo e só para quem é Diretor. */
  emConstrucao?: boolean;
};
