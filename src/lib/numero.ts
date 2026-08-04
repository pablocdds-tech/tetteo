import { z } from "zod";

/**
 * Número do jeito que o Brasil digita.
 *
 * Ninguém na cozinha vai digitar "12.5". Vai digitar "12,5" — e se o sistema
 * recusar, a pessoa desiste de usar. Pior: se ele ACEITAR e ler errado, doze
 * vírgula cinco vira cento e vinte e cinco e o CMV do mês vai junto.
 *
 * Mora em `lib` porque Cardápio, Estoque e Compras leem número do mesmo jeito.
 * Duas cópias dessa regra é uma cópia esperando para divergir.
 *
 * ---------------------------------------------------------------------------
 * O PONTO É AMBÍGUO, E ISSO CUSTOU CARO.
 *
 * A primeira versão apagava todo ponto, tratando-o sempre como separador de
 * milhar. Funcionava para "1.234,56" e destruía "3.5", que virava 35. E não
 * era um caso hipotético: o próprio sistema devolvia "38.9" para o campo ao
 * abrir um cadastro para edição — salvar sem mexer em nada gravava 389.
 *
 * A regra agora tem três caminhos, e o terceiro é o que importa:
 *
 *   tem vírgula        → a vírgula é o decimal, os pontos são milhar
 *   um ponto só, com
 *   1, 2 ou 4+ casas   → o ponto é o decimal ("3.5", "12.75")
 *   um ponto só, com
 *   exatamente 3 casas → AMBÍGUO. "1.200" pode ser mil e duzentos ou um
 *                        vírgula dois, e chutar errado erra por mil vezes.
 *                        O sistema RECUSA e pede para desfazer a dúvida.
 *
 * Recusar incomoda uma vez. Adivinhar errado estraga um relatório que alguém
 * vai usar para decidir preço.
 * ---------------------------------------------------------------------------
 */

type Leitura =
  | { ok: true; valor: number | null }
  | { ok: false; motivo: "invalido" | "ambiguo" };

function interpretar(bruto: string): Leitura {
  const texto = bruto.trim().replace(/\s/g, "");
  if (texto === "") return { ok: true, valor: null };

  let normalizado: string;

  if (texto.includes(",")) {
    // Com vírgula não há dúvida: ela é o decimal, e todo ponto é milhar.
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(".")) {
    const partes = texto.split(".");

    if (partes.length > 2) {
      // "1.234.567" — vários pontos só existem como milhar.
      normalizado = partes.join("");
    } else if (partes[1].length === 3) {
      return { ok: false, motivo: "ambiguo" };
    } else {
      normalizado = texto;
    }
  } else {
    normalizado = texto;
  }

  const valor = Number(normalizado);
  if (Number.isNaN(valor)) return { ok: false, motivo: "invalido" };
  return { ok: true, valor };
}

/**
 * Leitura direta, sem Zod — para importação em lote, onde uma célula ruim não
 * pode derrubar as outras duzentas e sessenta.
 *
 * Devolve `null` para vazio e `undefined` para o que não deu para entender,
 * porque quem chama precisa saber a diferença: em branco é ausência de dado,
 * ilegível é aviso na tela.
 */
export function lerNumeroBr(texto: string): number | null | undefined {
  const leitura = interpretar(texto);
  return leitura.ok ? leitura.valor : undefined;
}

function mensagem(motivo: "invalido" | "ambiguo", rotulo: string) {
  if (motivo === "ambiguo") {
    return `Não deu para entender ${rotulo}: use vírgula para os decimais (1.200,00) ou escreva sem ponto (1200).`;
  }
  return `Informe ${rotulo} como número.`;
}

/** Campo em branco vira zero. Para custo, estoque mínimo e afins. */
export function numeroBr(rotulo: string) {
  return z
    .string()
    .superRefine((bruto, ctx) => {
      const leitura = interpretar(bruto);
      if (!leitura.ok) {
        ctx.addIssue({
          code: "custom",
          message: mensagem(leitura.motivo, rotulo),
        });
        return;
      }
      if (leitura.valor !== null && leitura.valor < 0) {
        ctx.addIssue({
          code: "custom",
          message: `${rotulo} não pode ser negativo.`,
        });
      }
    })
    .transform((bruto) => {
      const leitura = interpretar(bruto);
      return leitura.ok ? (leitura.valor ?? 0) : 0;
    });
}

/**
 * Como `numeroBr`, mas o campo em branco continua VAZIO em vez de virar zero.
 *
 * A diferença decide o CMV. Numa contagem, "0" significa "acabou, não tem
 * nenhum"; em branco significa "não contei este item". Tratar os dois como
 * zero faria o sistema afirmar que a câmara fria está vazia.
 */
export function numeroBrOpcional(rotulo: string) {
  return z
    .string()
    .superRefine((bruto, ctx) => {
      const leitura = interpretar(bruto);
      if (!leitura.ok) {
        ctx.addIssue({
          code: "custom",
          message: mensagem(leitura.motivo, rotulo),
        });
        return;
      }
      if (leitura.valor !== null && leitura.valor < 0) {
        ctx.addIssue({
          code: "custom",
          message: `${rotulo} não pode ser negativo.`,
        });
      }
    })
    .transform((bruto) => {
      const leitura = interpretar(bruto);
      return leitura.ok ? leitura.valor : null;
    });
}

const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatarMoeda(valor: number | string) {
  return formatadorMoeda.format(Number(valor));
}

/** Quantidade com até três casas, sem zeros à toa: "12,5" e não "12,500". */
export function formatarQuantidade(valor: number | string) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/**
 * O valor do jeito que ele deve ENTRAR num campo de formulário.
 *
 * Sem separador de milhar, de propósito: o que sai por aqui volta a ser lido
 * pela função acima, e um "1.234" devolvido pelo sistema cairia direto no caso
 * ambíguo. Vírgula para os decimais, porque é assim que se digita aqui.
 *
 * Nunca use `.toString()` de um Decimal para preencher campo: ele devolve
 * "38.9", e o ponto solto é justamente o que causa confusão.
 */
export function paraCampo(
  valor: number | string | null | undefined,
  casasMinimas = 0,
) {
  if (valor === null || valor === undefined || valor === "") return "";

  const numero = Number(valor);
  if (Number.isNaN(numero)) return "";

  return numero.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: casasMinimas,
    maximumFractionDigits: 4,
  });
}
