/**
 * A NOTA DO CHECKLIST.
 *
 * Funções puras, sem banco. É a única parte do módulo onde um erro sai caro:
 * a nota é o número que vai para o painel do dono e para a comparação entre
 * lojas, e uma conta errada aqui faz a loja pior parecer a melhor.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE DEFINE TUDO: nem todo item entra na conta.
 *
 * Um checklist de abertura tem três tipos de linha misturados:
 *
 *   "A câmara fria está limpa?"        conformidade — entra
 *   "Temperatura da câmara: ___ °C"    entra SE houver faixa cadastrada
 *   "Observações do turno: ___"        registro — nunca entra
 *
 * Dividir por "todos os itens" faria a loja que anota a temperatura parecer
 * pior do que a que não anota, só porque escreveu mais. A nota é sobre o que
 * estava certo ou errado, não sobre quantos campos foram preenchidos.
 *
 * "Não se aplica" também sai da conta — a loja com um freezer só não pode
 * perder ponto por não ter o freezer 2. Sai da conta, não vale zero: são
 * coisas diferentes e a diferença aparece na nota.
 * ---------------------------------------------------------------------------
 */

export type TipoDeResposta = "SIM_NAO" | "NUMERO" | "TEXTO";

export type ItemRespondido = {
  textoItem: string;
  tipo: TipoDeResposta;
  obrigatorio: boolean;

  /** SIM_NAO: `null` enquanto ninguém respondeu. */
  conforme: boolean | null;
  naoSeAplica: boolean;

  valorNumero: number | null;
  valorTexto: string | null;

  /** Faixa aceitável do NUMERO. Sem faixa, o número é só registro. */
  minimo: number | null;
  maximo: number | null;

  observacao: string | null;
  exigeObservacaoSeNao: boolean;
};

export type Nota = {
  conformes: number;
  naoConformes: number;
  /** Fora da conta por escolha de quem respondeu. */
  naoSeAplica: number;
  /** Fora da conta porque ninguém respondeu. */
  semResposta: number;
  /** Fora da conta por natureza: texto, e número sem faixa. */
  soRegistro: number;
  /** 0 a 100, uma casa. `null` quando nenhum item era de conformidade. */
  pontuacao: number | null;
};

/**
 * Onde um item cai:
 *
 *   true   conforme
 *   false  não conforme
 *   null   fora da conta (N/A, sem resposta, ou item de registro)
 */
export function conformidadeDoItem(item: ItemRespondido): boolean | null {
  if (item.naoSeAplica) return null;

  if (item.tipo === "SIM_NAO") return item.conforme;

  if (item.tipo === "NUMERO") {
    // Sem faixa cadastrada não há certo nem errado — o número é anotação.
    if (item.minimo === null && item.maximo === null) return null;
    if (item.valorNumero === null) return null;

    if (item.minimo !== null && item.valorNumero < item.minimo) return false;
    if (item.maximo !== null && item.valorNumero > item.maximo) return false;
    return true;
  }

  return null;
}

/** Se a pessoa respondeu alguma coisa — para cobrar os obrigatórios. */
export function foiRespondido(item: ItemRespondido): boolean {
  if (item.naoSeAplica) return true;
  if (item.tipo === "SIM_NAO") return item.conforme !== null;
  if (item.tipo === "NUMERO") return item.valorNumero !== null;
  return (item.valorTexto ?? "").trim() !== "";
}

export function calcularNota(itens: ItemRespondido[]): Nota {
  let conformes = 0;
  let naoConformes = 0;
  let naoSeAplica = 0;
  let semResposta = 0;
  let soRegistro = 0;

  for (const item of itens) {
    if (item.naoSeAplica) {
      naoSeAplica += 1;
      continue;
    }

    const conformidade = conformidadeDoItem(item);

    if (conformidade === true) conformes += 1;
    else if (conformidade === false) naoConformes += 1;
    else if (!foiRespondido(item)) semResposta += 1;
    else soRegistro += 1;
  }

  const avaliados = conformes + naoConformes;

  return {
    conformes,
    naoConformes,
    naoSeAplica,
    semResposta,
    soRegistro,
    // Arredondado a uma casa: "93,3%" é o que cabe na tela e o que alguém
    // repete em voz alta. Guardar 93,33333 daria uma precisão que a medida
    // não tem.
    pontuacao:
      avaliados === 0 ? null : Math.round((conformes / avaliados) * 1000) / 10,
  };
}

/**
 * O que impede fechar o checklist.
 *
 * Devolve frases prontas para a tela, não códigos: quem lê está de pé, com o
 * celular na mão, e precisa saber qual linha voltar a preencher.
 *
 * As duas travas existem por motivos diferentes. O obrigatório em branco é
 * checklist pela metade — fechar assim dá 100% para quem não olhou nada. Já o
 * "não conforme" sem explicação é o que apodrece o histórico: três meses de
 * "não" sem uma linha do que houve não ajuda ninguém a consertar nada.
 */
export function impedimentosParaFechar(itens: ItemRespondido[]): string[] {
  const motivos: string[] = [];

  for (const item of itens) {
    if (item.obrigatorio && !foiRespondido(item)) {
      motivos.push(`Falta responder: ${item.textoItem}`);
      continue;
    }

    const naoConforme = conformidadeDoItem(item) === false;
    const semObservacao = (item.observacao ?? "").trim() === "";

    if (naoConforme && item.exigeObservacaoSeNao && semObservacao) {
      motivos.push(`Explique o que houve em: ${item.textoItem}`);
    }
  }

  return motivos;
}

/**
 * O texto com que a pendência nasce.
 *
 * Já sai pronto com a observação de quem respondeu — a pendência vai ser lida
 * amanhã, por outra pessoa, e "Coifa limpa?" sozinho não diz nada.
 */
export function descricaoDaPendencia(item: ItemRespondido): string {
  const observacao = (item.observacao ?? "").trim();
  const medida =
    item.tipo === "NUMERO" && item.valorNumero !== null
      ? ` (leitura: ${item.valorNumero})`
      : "";

  return observacao
    ? `${item.textoItem}${medida} — ${observacao}`
    : `${item.textoItem}${medida}`;
}

/** As não conformidades que devem virar pendência ao fechar. */
export function naoConformidades(
  itens: ItemRespondido[],
): { textoItem: string; descricao: string }[] {
  return itens
    .filter((item) => conformidadeDoItem(item) === false)
    .map((item) => ({
      textoItem: item.textoItem,
      descricao: descricaoDaPendencia(item),
    }));
}
