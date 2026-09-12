import { lerData } from "./datas.mjs";
import { lerCentavos } from "./dinheiro.mjs";

/**
 * A LEITURA DO CSV DE VENDAS.
 *
 * Uma linha por loja por dia. Linha ruim não derruba o arquivo: é descartada
 * com o NÚMERO e o MOTIVO, e o relatório conta quantas foram. Arquivo ruim
 * (sem cabeçalho, sem as colunas, binário) é recusado inteiro, com o motivo.
 *
 * Limite conhecido: quebra de linha DENTRO de um campo entre aspas não é
 * aceita — a linha fica "aspas sem fechar".
 *
 * Quando `hoje` é informado, uma linha datada DEPOIS de hoje também é
 * descartada ("data no futuro") — ela é sempre erro de digitação, nunca uma
 * venda real, e não pode virar a "última data" do arquivo.
 */

export const COLUNAS_OBRIGATORIAS = ["data", "loja", "pedidos", "valor_total"];

/** Divide uma linha respeitando aspas: `"Centro; sul";12` são 2 campos. */
export function dividirLinha(linha, separador) {
  const campos = [];
  let atual = "";
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      dentroDeAspas = true;
    } else if (c === separador) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return { campos, aspasAbertas: dentroDeAspas };
}

export function lerCsv(texto, { hoje = null } = {}) {
  if (typeof texto !== "string") {
    return { ok: false, motivo: "o arquivo não é texto", linha: null };
  }
  if (texto.includes("\u0000")) {
    return {
      ok: false,
      motivo: "o arquivo não parece texto (tem bytes nulos)",
      linha: null,
    };
  }

  const brutas = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (brutas.length && brutas[brutas.length - 1].trim() === "") brutas.pop();
  if (brutas.length === 0) {
    return {
      ok: false,
      motivo: "o arquivo está vazio, sem cabeçalho",
      linha: null,
    };
  }

  const separador = brutas[0].includes(";") ? ";" : ",";
  const cabecalho = dividirLinha(brutas[0], separador).campos.map((c) =>
    c.trim().toLowerCase(),
  );
  const faltam = COLUNAS_OBRIGATORIAS.filter((c) => !cabecalho.includes(c));
  if (faltam.length) {
    return {
      ok: false,
      motivo: `faltam colunas no cabeçalho: ${faltam.join(", ")}`,
      linha: 1,
    };
  }

  const indice = Object.fromEntries(cabecalho.map((c, i) => [c, i]));
  const precisa = Math.max(...COLUNAS_OBRIGATORIAS.map((c) => indice[c])) + 1;
  const linhas = [];
  const descartadas = [];
  let linhasLidas = 0;

  for (let i = 1; i < brutas.length; i++) {
    const numero = i + 1;
    if (brutas[i].trim() === "") continue;
    linhasLidas++;
    const descartar = (motivo) => descartadas.push({ linha: numero, motivo });

    const { campos, aspasAbertas } = dividirLinha(brutas[i], separador);
    if (aspasAbertas) {
      descartar("aspas sem fechar");
      continue;
    }
    if (campos.length < precisa) {
      descartar("linha incompleta");
      continue;
    }

    const data = lerData(campos[indice.data]);
    if (!data) {
      descartar("data inválida");
      continue;
    }
    // Uma data depois de "hoje" nunca é um dia de venda real — é erro de
    // digitação (mês ou ano trocado). Sem isso, uma linha assim vira a
    // "última data" do arquivo e derruba o alarme de desatualizado.
    if (hoje && data > hoje) {
      descartar("data no futuro");
      continue;
    }
    const loja = campos[indice.loja].trim();
    if (!loja) {
      descartar("loja vazia");
      continue;
    }
    const pedidosTexto = campos[indice.pedidos].trim();
    if (!/^\d{1,7}$/.test(pedidosTexto)) {
      descartar("pedidos inválido");
      continue;
    }
    const centavos = lerCentavos(campos[indice.valor_total]);
    if (centavos === null) {
      descartar("valor inválido");
      continue;
    }

    linhas.push({
      linha: numero,
      data,
      loja,
      pedidos: Number(pedidosTexto),
      centavos,
      observacao:
        indice.observacao === undefined
          ? ""
          : (campos[indice.observacao] ?? ""),
    });
  }

  return { ok: true, separador, linhas, descartadas, linhasLidas };
}
