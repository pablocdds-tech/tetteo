"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import type { EstadoCompras } from "@/modules/compras/acoes";
import {
  CASAS,
  NumeroInvalido,
  digitado,
} from "@/modules/compras/schemas/aritmetica";
import type { Informado } from "@/modules/compras/schemas/recebimento";
import { ConferenciaInvalida } from "@/modules/compras/services/recebimentos";

import { conferirRecebimento, devolverMercadoria } from "./conferir";

/**
 * As ações da conferência. Moram aqui, na camada `app/`, porque o orquestrador
 * junta Compras, Estoque e Financeiro — e só esta camada enxerga os três.
 */

type LinhaDigitada = {
  itemDePedidoId: string;
  boas: string;
  avariadas: string;
  fracionavel: boolean;
  decisaoExcedente: "" | "ACEITAR" | "RECUSAR";
  substitutoInsumoId: string;
  decisaoSubstituicao: "" | "ACEITAR" | "RECUSAR";
  lote: string;
  validade: string;
  observacao: string;
  fotoIds: string[];
};

export type EstadoDaConferencia = EstadoCompras & { recebimentoId?: string };

function lerLinhas(bruto: string): LinhaDigitada[] | null {
  try {
    const v = JSON.parse(bruto);
    return Array.isArray(v) ? (v as LinhaDigitada[]) : null;
  } catch {
    return null;
  }
}

export async function conferirRecebimentoAcao(
  _a: EstadoDaConferencia,
  dados: FormData,
): Promise<EstadoDaConferencia> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");

  const pedidoId = String(dados.get("pedidoId") ?? "");
  const linhas = lerLinhas(String(dados.get("linhas") ?? ""));
  if (!linhas)
    return { erro: "Não deu para ler a conferência. Recarregue a tela." };

  const erros: Record<string, string> = {};
  const informados: Informado[] = [];
  for (const l of linhas) {
    try {
      // Caixa conta em caixas inteiras ou meias (3 casas); a granel, na
      // unidade de estoque com 3 casas. Em milésimos, sempre.
      const boas = digitado(l.boas || "0", CASAS.milesimos) ?? 0n;
      const avariadas = digitado(l.avariadas || "0", CASAS.milesimos) ?? 0n;
      if (boas === 0n && avariadas === 0n) continue;
      const validade = l.validade
        ? new Date(`${l.validade}T12:00:00-03:00`)
        : null;
      informados.push({
        itemDePedidoId: l.itemDePedidoId,
        boas,
        avariadas,
        decisaoExcedente: l.decisaoExcedente || null,
        substitutoInsumoId: l.substitutoInsumoId || null,
        decisaoSubstituicao: l.decisaoSubstituicao || null,
        lote: l.lote.trim().slice(0, 40) || null,
        validade:
          validade && !Number.isNaN(validade.getTime()) ? validade : null,
        observacao: l.observacao.trim().slice(0, 300) || null,
        fotoIds: (l.fotoIds ?? []).slice(0, 6),
      });
    } catch (erro) {
      if (erro instanceof NumeroInvalido)
        erros[l.itemDePedidoId] = erro.message;
      else throw erro;
    }
  }
  if (Object.keys(erros).length > 0) {
    return { erro: "Há quantidades que o sistema não entendeu.", erros };
  }

  try {
    const r = await conferirRecebimento(ctx, {
      pedidoId,
      chave: String(dados.get("chave") ?? ""),
      recebidaEm: new Date(),
      localDestinoId: String(dados.get("localDestinoId") ?? ""),
      informados,
      numeroNota: String(dados.get("numeroNota") ?? "").trim() || null,
      serieNota: String(dados.get("serieNota") ?? "").trim() || null,
      chaveAcesso:
        String(dados.get("chaveAcesso") ?? "").replace(/\D/g, "") || null,
      notaExistenteId: String(dados.get("notaExistenteId") ?? "") || null,
      observacao:
        String(dados.get("observacao") ?? "")
          .trim()
          .slice(0, 300) || null,
      gerarContaAPagar: dados.get("gerarContaAPagar") === "on",
    });
    revalidatePath(`/compras/recebimento/${pedidoId}`);
    revalidatePath("/compras/recebimento");
    const conta =
      r.contaAPagar === "gerada"
        ? " A conta a pagar foi criada no Financeiro."
        : r.contaAPagar === "sem-permissao"
          ? " A conta a pagar fica para quem cuida do Financeiro (em Importar notas)."
          : r.contaAPagar === "falhou"
            ? " A conta a pagar não foi criada agora — faça em Financeiro › Importar notas."
            : "";
    return {
      recebimentoId: r.recebimentoId,
      ok: r.jaExistia
        ? "Esta conferência já tinha sido gravada — nada entrou duas vezes."
        : `Entrega ${r.numero} conferida e lançada no estoque.${r.completo ? " Pedido completo." : " O saldo continua pendente."}${conta}`,
    };
  } catch (erro) {
    if (erro instanceof ConferenciaInvalida) {
      return {
        erro: "A conferência tem pendências — veja em cada linha.",
        erros: Object.fromEntries(
          erro.erros.map((e) => [e.itemDePedidoId || "geral", e.mensagem]),
        ),
      };
    }
    if (erro instanceof SemPermissao || erro instanceof ExigeUnidade)
      return { erro: erro.message };
    if (erro instanceof Error && !erro.name.startsWith("PrismaClient"))
      return { erro: erro.message };
    console.error("conferirRecebimentoAcao:", erro);
    return {
      erro: "O sistema não conseguiu gravar. Nada entrou no estoque — tente de novo.",
    };
  }
}

export async function devolverMercadoriaAcao(
  _a: EstadoCompras,
  dados: FormData,
): Promise<EstadoCompras> {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  const pedidoId = String(dados.get("pedidoId") ?? "");
  try {
    await devolverMercadoria(ctx, {
      recebimentoId: String(dados.get("recebimentoId") ?? ""),
      chave: String(dados.get("chave") ?? ""),
      motivo: String(dados.get("motivo") ?? ""),
      linhas: [
        {
          itemDeRecebimentoId: String(dados.get("itemDeRecebimentoId") ?? ""),
          quantidade: String(dados.get("quantidade") ?? ""),
        },
      ],
    });
  } catch (erro) {
    if (erro instanceof Error && !erro.name.startsWith("PrismaClient"))
      return { erro: erro.message };
    console.error("devolverMercadoriaAcao:", erro);
    return { erro: "O sistema não conseguiu gravar a devolução." };
  }
  revalidatePath(`/compras/recebimento/${pedidoId}`);
  return {
    ok: "Devolução registrada: o estoque baixou, e a conta com o fornecedor ficou em divergência.",
  };
}
