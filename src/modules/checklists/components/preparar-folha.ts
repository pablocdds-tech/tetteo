import { paraCampo } from "@/lib/numero";

import type { RespostaCompleta } from "../services/respostas";

import type { LinhaDaFolha } from "./folha-de-checklist";

/**
 * DO BANCO PARA A FOLHA.
 *
 * Mora fora das duas páginas que usam a folha porque a tradução é a mesma nas
 * duas, e duas cópias dela seriam duas cópias esperando para divergir — a
 * primeira a ganhar um campo novo e a segunda a continuar mandando `undefined`
 * para a tela.
 */

const HORA_DA_OPERACAO = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * A faixa aceitável em uma linha só, do jeito que se lê em voz alta.
 *
 * Devolve `null` quando não há faixa — e essa ausência tem significado: um
 * número sem faixa é REGISTRO, não conformidade, e não entra na nota.
 */
export function faixaEmTexto(item: RespostaCompleta["itens"][number]) {
  const minimo = item.item.minimo;
  const maximo = item.item.maximo;
  if (minimo === null && maximo === null) return null;

  const unidade = item.item.rotuloUnidade ? ` ${item.item.rotuloUnidade}` : "";
  if (minimo !== null && maximo !== null) {
    return `${paraCampo(minimo.toString())} a ${paraCampo(maximo.toString())}${unidade}`;
  }
  if (minimo !== null) {
    return `a partir de ${paraCampo(minimo.toString())}${unidade}`;
  }
  return `até ${paraCampo(maximo!.toString())}${unidade}`;
}

/**
 * @param nomes quem respondeu cada item, por id. Vem de fora porque buscar o
 *   nome por item seria uma consulta por linha da folha — e são as mesmas
 *   duas ou três pessoas repetidas doze vezes.
 */
export function paraLinha(
  item: RespostaCompleta["itens"][number],
  nomes: Map<string, string> = new Map(),
): LinhaDaFolha {
  return {
    id: item.itemId,
    textoItem: item.textoItem,
    secao: item.secao,
    tipo: item.tipo,
    obrigatorio: item.item.obrigatorio,
    exigeObservacaoSeNao: item.item.exigeObservacaoSeNao,
    exigeFoto: item.item.exigeFoto,
    rotuloUnidade: item.item.rotuloUnidade,
    faixa: faixaEmTexto(item),
    // Os limites em número vão junto com a faixa em texto: a tela precisa dos
    // dois. O texto é para LER; os números são para a folha julgar a leitura
    // ao vivo, com a mesma regra que o servidor usa ao fechar.
    minimo: item.item.minimo === null ? null : Number(item.item.minimo),
    maximo: item.item.maximo === null ? null : Number(item.item.maximo),
    conforme: item.conforme,
    naoSeAplica: item.naoSeAplica,
    // `paraCampo` e não `.toString()`: o Decimal devolve "38.9", e o ponto
    // solto é justamente o que o leitor de número brasileiro estranha.
    valorNumero:
      item.valorNumero === null ? "" : paraCampo(item.valorNumero.toString()),
    valorTexto: item.valorTexto ?? "",
    observacao: item.observacao ?? "",
    // Formatado aqui, no fuso da operação. Mandar um Date cru faria o celular
    // formatar com o fuso DELE, e um item marcado às 07:12 em São Paulo
    // apareceria como 10:12 para quem estivesse viajando.
    respondidoEm: item.respondidoEm
      ? HORA_DA_OPERACAO.format(item.respondidoEm)
      : null,
    respondidoPor: item.respondidoPorId
      ? (nomes.get(item.respondidoPorId) ?? null)
      : null,
  };
}
