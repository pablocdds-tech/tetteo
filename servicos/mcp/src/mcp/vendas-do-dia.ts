import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { FonteDeVendas } from "../fontes/tipos.js";
import type { Registro } from "../registro.js";
import { esquemaData } from "./data.js";

/**
 * A FERRAMENTA `vendas_do_dia`.
 *
 * A loja NÃO é um parâmetro. Ela vem da conexão, escolhida por uma pessoa na
 * tela de consentimento. Se fosse argumento, bastaria o modelo — ou um texto
 * malicioso colado na conversa — pedir a loja de outra pessoa.
 *
 * Falhas viram `isError: true` com uma frase segura. A mensagem crua do erro
 * nunca sai: o SDK repassaria `error.message` ao modelo, e uma mensagem de
 * banco pode carregar detalhe interno.
 */

export type ConexaoAtual = {
  conexaoId: string;
  unidadeId: string;
  unidadeNome: string;
};

export type ChamadaRegistrada = {
  conexaoId: string;
  ferramenta: string;
  argumentos: Record<string, unknown>;
  resultado: "ok" | "erro";
  duracaoMs: number;
};

export type DependenciasDaFerramenta = {
  fonte: FonteDeVendas;
  conexao: ConexaoAtual;
  registrarChamada: (chamada: ChamadaRegistrada) => Promise<void>;
  registro: Registro;
  agora?: () => Date;
  tempoMaximoMs?: number;
};

export const AVISO_FICTICIO =
  "DADOS FICTÍCIOS — gerados para testar o contrato. Não são vendas reais.";

export const TEMPO_MAXIMO_MS = 8000;

const saida = z.object({
  data: z.string(),
  unidade: z.string(),
  quantidade_vendas: z.number().int().nonnegative(),
  total: z.number().nonnegative(),
  total_centavos: z.number().int().nonnegative(),
  moeda: z.literal("BRL"),
  fonte: z.string(),
  aviso: z.string().optional(),
});

type Resultado = z.infer<typeof saida>;

const reais = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function frase(resultado: Resultado): string {
  const [ano, mes, dia] = resultado.data.split("-");
  const texto = `${dia}/${mes}/${ano} · ${resultado.unidade}: ${resultado.quantidade_vendas} vendas, total de ${reais.format(resultado.total)}.`;
  return resultado.aviso ? `${resultado.aviso} ${texto}` : texto;
}

/** Rejeita quando o sinal aborta — para cortar até fonte que ignora o sinal. */
function corteQuandoAbortar(sinal: AbortSignal): Promise<never> {
  const corte = new Promise<never>((_, rejeitar) => {
    if (sinal.aborted) return rejeitar(sinal.reason);
    sinal.addEventListener("abort", () => rejeitar(sinal.reason), {
      once: true,
    });
  });
  // Depois que a corrida acaba ninguém mais escuta este corte; sem o catch,
  // o disparo tardio do tempo viraria "unhandledRejection".
  corte.catch(() => {});
  return corte;
}

export function registrarVendasDoDia(
  servidor: McpServer,
  deps: DependenciasDaFerramenta,
): void {
  const limite = deps.tempoMaximoMs ?? TEMPO_MAXIMO_MS;

  servidor.registerTool(
    "vendas_do_dia",
    {
      title: "Vendas do dia",
      description:
        "Quantidade de vendas e valor total (R$) de UM dia, na loja ligada a esta conexão. Somente leitura. Informe a data no formato AAAA-MM-DD, no horário de Brasília.",
      inputSchema: z.object({ data: esquemaData(deps.agora) }),
      outputSchema: saida,
      annotations: {
        title: "Vendas do dia",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ data }, ctx) => {
      const inicio = performance.now();
      const tempo = AbortSignal.timeout(limite);
      const sinal = AbortSignal.any([ctx.mcpReq.signal, tempo]);

      const anotar = async (resultado: "ok" | "erro") => {
        try {
          await deps.registrarChamada({
            conexaoId: deps.conexao.conexaoId,
            ferramenta: "vendas_do_dia",
            argumentos: { data },
            resultado,
            duracaoMs: Math.round(performance.now() - inicio),
          });
        } catch (erro) {
          deps.registro.aviso("não consegui registrar a chamada", { erro });
        }
      };

      try {
        const resumo = await Promise.race([
          deps.fonte.vendasDoDia(
            { unidadeId: deps.conexao.unidadeId, data },
            sinal,
          ),
          corteQuandoAbortar(sinal),
        ]);
        const resultado: Resultado = {
          data,
          unidade: deps.conexao.unidadeNome,
          quantidade_vendas: resumo.quantidade,
          total: resumo.totalCentavos / 100,
          total_centavos: resumo.totalCentavos,
          moeda: "BRL",
          fonte: deps.fonte.nome,
          ...(deps.fonte.ehFicticia ? { aviso: AVISO_FICTICIO } : {}),
        };
        await anotar("ok");
        return {
          content: [{ type: "text", text: frase(resultado) }],
          structuredContent: resultado,
        };
      } catch (erro) {
        await anotar("erro");
        deps.registro.erro("vendas_do_dia falhou", {
          erro,
          conexaoId: deps.conexao.conexaoId,
          demorou: tempo.aborted,
        });
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: tempo.aborted
                ? "A consulta das vendas demorou demais e foi interrompida. Tente de novo em instantes."
                : "Não consegui consultar as vendas agora. Tente de novo em instantes.",
            },
          ],
        };
      }
    },
  );
}
