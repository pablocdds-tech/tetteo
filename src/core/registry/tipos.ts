import type { NomeDeIcone } from "@/design-system/icones";

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

  /**
   * O ícone, pelo NOME, do conjunto desenhado em `design-system/icones`.
   *
   * Já foi `string` com um emoji dentro, e isso tinha três defeitos: o desenho
   * mudava conforme o sistema operacional de quem olhava, a cor era fixa e não
   * acompanhava o tema, e não havia como o TypeScript avisar que "🛵" não
   * existe. Agora um nome errado não compila.
   */
  icone: NomeDeIcone;

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

/**
 * O QUE UM APP TEM A AVISAR.
 *
 * A Severina não sabe o que é uma rotina de contagem, e não pode saber — um
 * App nunca importa de outro. Ela pergunta "tem algo a avisar?" e cada App
 * responde neste formato, no vocabulário dela.
 *
 * O Core define a FORMA, nunca o significado — a mesma divisão que ele já faz
 * com permissão, que guarda como string sem saber o que "estoque.contar"
 * quer dizer.
 */
export type AvisoDoModulo = {
  /**
   * Identifica o aviso para não repetir: "rotina:clx91…".
   *
   * É esta chave que impede a equipe de receber a mesma cobrança a cada
   * batida do relógio — sessenta vezes entre 7h e 8h.
   */
  chave: string;

  /**
   * O fato, em português, que a Severina vai transformar em mensagem.
   *
   * Frase inteira, não fragmento: é o que sai no WhatsApp quando o redator
   * estiver fora do ar, e "contagem praça atrasada" não é uma mensagem.
   */
  assunto: string;

  referenciaTipo: string;
  referenciaId: string;
};

/**
 * UM FATO QUE UM APP DECLARA — "isto aconteceu, e alguém deveria saber".
 *
 * Diferente de `AvisoDoModulo`, que responde "o que cobrar hoje?", o fato
 * responde "o que acabou de acontecer?": o fechamento da loja foi concluído.
 * A Severina transforma o fato num RASCUNHO de aviso — que só sai depois que
 * uma pessoa confirma.
 *
 * O App dono do fato entrega as linhas já escritas. A Severina não sabe o que
 * é uma nota de checklist, e não precisa: ela põe as linhas no aviso.
 */
export type FatoDoModulo = {
  /**
   * A chave de idempotência: "checklists:fechamento:<id>". O mesmo fato
   * perguntado sessenta vezes vira UM rascunho.
   */
  chave: string;
  /** "checklists.fechamento" */
  tipo: string;
  /** O id do registro que originou o fato, no App dono dele. */
  referenciaId: string;
  unidadeId: string;
  titulo: string;
  linhas: string[];
  /** Caminho dentro do Tetteo, sem domínio: "/checklists/clx…". */
  caminho: string;
  ocorridoEm: Date;
  /** O que o destinatário precisa poder ver para receber o aviso. */
  permissaoNecessaria: string;
};
