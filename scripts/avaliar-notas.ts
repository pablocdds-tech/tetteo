import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { lerDocumentoFiscal } from "../src/server/notas/pipeline";
import {
  gerarExtracaoGemini,
  prepararExtracaoGemini,
} from "../src/server/notas/gemini";
import {
  extracaoFiscalSchema,
  validarExtracaoFiscal,
  type ExtracaoFiscal,
} from "../src/server/notas/extracao";
import { LeituraNotaRecusada } from "../src/server/notas/documento";

async function main() {
  const args = process.argv.slice(2);
  const opcao = (nome: string) => {
    const i = args.indexOf(nome);
    return i < 0 ? undefined : args[i + 1];
  };
  const pasta = path.resolve(opcao("--fixtures") ?? "tests/fixtures/notas");
  const manifest = JSON.parse(
    await readFile(path.join(pasta, "manifest.json"), "utf8"),
  ) as {
    casos: {
      arquivo: string;
      proveniencia: "sintetica" | "real-anonimizada";
      esperado?: Record<string, unknown>;
    }[];
  };
  const arquivoPredicoes = opcao("--predicoes");
  const predicoes = arquivoPredicoes
    ? (JSON.parse(await readFile(arquivoPredicoes, "utf8")) as Record<
        string,
        unknown
      >)
    : undefined;
  const usarGemini = args.includes("--gemini-free");
  assert.ok(
    !(predicoes && usarGemini),
    "Escolha --predicoes ou --gemini-free.",
  );
  if (usarGemini)
    assert.ok(
      process.env.NOTAS_AVALIACAO_FREE_TIER === "confirmado" &&
        process.env.NOTAS_AVALIACAO_GEMINI_KEY,
      "Configure uma chave própria do Free Tier e NOTAS_AVALIACAO_FREE_TIER=confirmado no ambiente; nunca no comando.",
    );
  const config = {
    enabled: true,
    configured: true,
    model: "gemini-2.5-flash",
    inputRate: 0,
    outputRate: 0,
    apiKey: process.env.NOTAS_AVALIACAO_GEMINI_KEY,
  };
  const resultados: {
    arquivo: string;
    proveniencia: string;
    metodo?: string;
    estado: string;
    tokens: number;
    ms: number;
    dados?: ExtracaoFiscal;
  }[] = [];
  const campos: Record<
    string,
    Record<
      string,
      {
        corretos: number;
        avaliados: number;
        ausentes: number;
        indevidos: number;
      }
    >
  > = {};
  function comparar(
    proveniencia: string,
    prefixo: string,
    esperado: unknown,
    observado: unknown,
  ) {
    if (Array.isArray(esperado)) {
      comparar(
        proveniencia,
        `${prefixo}.quantidade_linhas`,
        esperado.length,
        Array.isArray(observado) ? observado.length : null,
      );
      esperado.forEach((v, i) =>
        comparar(
          proveniencia,
          prefixo,
          v,
          Array.isArray(observado) ? observado[i] : null,
        ),
      );
    } else if (esperado && typeof esperado === "object") {
      for (const [k, v] of Object.entries(esperado))
        comparar(
          proveniencia,
          prefixo ? `${prefixo}.${k}` : k,
          v,
          observado && typeof observado === "object"
            ? (observado as Record<string, unknown>)[k]
            : null,
        );
    } else {
      const grupo = (campos[proveniencia] ??= {});
      const c = (grupo[prefixo] ??= {
        corretos: 0,
        avaliados: 0,
        ausentes: 0,
        indevidos: 0,
      });
      c.avaliados++;
      if (
        esperado === observado ||
        (typeof esperado === "number" &&
          typeof observado === "number" &&
          Math.abs(esperado - observado) < 0.000001)
      )
        c.corretos++;
      if (esperado != null && observado == null) c.ausentes++;
      if (esperado == null && observado != null) c.indevidos++;
    }
  }
  for (const caso of manifest.casos) {
    assert.ok(
      ["sintetica", "real-anonimizada"].includes(caso.proveniencia),
      "Declare a proveniência de cada fixture.",
    );
    const arquivo = path.resolve(pasta, caso.arquivo);
    assert.ok(
      arquivo.startsWith(`${pasta}${path.sep}`),
      "Fixture fora da pasta.",
    );
    const inicio = performance.now();
    let tokens = 0;
    try {
      const r = predicoes
        ? (() => {
            const dados = extracaoFiscalSchema.parse(predicoes[caso.arquivo]);
            return {
              dados,
              metodo: "PREDICAO_IMPORTADA",
              pendencias: validarExtracaoFiscal(dados),
            };
          })()
        : await lerDocumentoFiscal(await readFile(arquivo), {
            organizacaoId: "avaliacao-isolada",
            unidadeId: "avaliacao-isolada",
            gemini: usarGemini
              ? async (imagens, recortes) => {
                  let dados: ExtracaoFiscal | undefined;
                  for (let n = 0; n < 2; n++) {
                    const p = await prepararExtracaoGemini(
                      n ? await recortes() : imagens,
                      config,
                    );
                    const r = await gerarExtracaoGemini(p, config);
                    tokens += r.tokens;
                    dados = r.dados;
                    if (!validarExtracaoFiscal(dados).length) break;
                  }
                  return { dados: dados!, extras: [] };
                }
              : undefined,
          });
      resultados.push({
        arquivo: caso.arquivo,
        proveniencia: caso.proveniencia,
        metodo: r.metodo,
        estado: r.pendencias.length ? "PENDENTE" : "LIDO",
        tokens,
        ms: Math.round(performance.now() - inicio),
        dados: r.dados,
      });
      if (caso.esperado)
        comparar(caso.proveniencia, "", caso.esperado, r.dados);
    } catch (e) {
      const estado =
        e instanceof LeituraNotaRecusada ? e.codigo : "ERRO_AVALIACAO";
      resultados.push({
        arquivo: caso.arquivo,
        proveniencia: caso.proveniencia,
        estado,
        tokens,
        ms: Math.round(performance.now() - inicio),
      });
      // Sem leitura, a cobertura cai. Campos não lidos não são contados como acertos.
      if (caso.esperado) comparar(caso.proveniencia, "", caso.esperado, null);
    }
  }
  const taxas = Object.fromEntries(
    Object.entries(campos).map(([grupo, valores]) => [
      grupo,
      Object.fromEntries(
        Object.entries(valores).map(([campo, c]) => [
          campo,
          { ...c, taxa: Number((c.corretos / c.avaliados).toFixed(4)) },
        ]),
      ),
    ]),
  );
  const baselineArquivo = opcao("--baseline");
  const baseline = baselineArquivo
    ? (JSON.parse(await readFile(baselineArquivo, "utf8")) as {
        taxas: typeof taxas;
      })
    : undefined;
  const diferencas = baseline
    ? Object.fromEntries(
        Object.entries(taxas).map(([grupo, valores]) => [
          grupo,
          Object.fromEntries(
            Object.entries(valores).map(([campo, c]) => [
              campo,
              baseline.taxas[grupo]?.[campo]
                ? Number(
                    (c.taxa - baseline.taxas[grupo][campo].taxa).toFixed(4),
                  )
                : null,
            ]),
          ),
        ]),
      )
    : undefined;
  const relatorio = {
    versao: "fiscal-2.0",
    aviso:
      "Resultados sintéticos validam o mecanismo. Acurácia real exige notas reais anonimizadas. Sem --gemini-free, fotos não são avaliadas por IA. QR com consulta desativada fica pendente.",
    taxas,
    diferencas,
    resultados,
  };
  console.table(
    resultados.map(({ arquivo, proveniencia, estado, metodo, tokens, ms }) => ({
      arquivo,
      proveniencia,
      estado,
      metodo,
      tokens,
      ms,
    })),
  );
  for (const [grupo, valores] of Object.entries(taxas)) {
    console.log(`Proveniência: ${grupo}`);
    console.table(valores);
  }
  if (opcao("--saida"))
    await writeFile(
      path.resolve(opcao("--saida")!),
      JSON.stringify(relatorio, null, 2),
    );
  if (!resultados.some((r) => r.proveniencia === "real-anonimizada"))
    console.log("Acurácia em notas reais: NÃO MEDIDA.");
}
main().catch(() => {
  console.error(
    "Avaliação interrompida. Confira o manifesto e as opções; nenhum lançamento foi feito.",
  );
  process.exitCode = 1;
});
