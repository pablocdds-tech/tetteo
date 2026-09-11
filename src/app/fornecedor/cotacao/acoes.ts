"use server";

import {
  dadosDoLink,
  registrarPeloLink,
  type VistaDoFornecedor,
} from "@/modules/compras/services/propostas";

import { passouDoLimite } from "./limite";

/**
 * AS AÇÕES DA PÁGINA DO FORNECEDOR — sem login, e por isso sem confiança.
 *
 * O código chega no corpo do POST (a página o lê depois do "#"). Toda regra —
 * validade do link, itens que são dele, preço zero, versões — mora em
 * `registrarPeloLink`; aqui só se freia o excesso e se traduz o resultado em
 * frase. Erro interno nunca vira texto para o fornecedor.
 */

export type EstadoDaResposta = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: string;
};

export async function lerCotacaoAcao(
  codigo: string,
): Promise<
  { ok: true; vista: VistaDoFornecedor } | { ok: false; mensagem: string }
> {
  if (await passouDoLimite("ler")) {
    return {
      ok: false,
      mensagem:
        "Muitas tentativas em pouco tempo. Espere um minuto e recarregue a página.",
    };
  }
  try {
    const r = await dadosDoLink(String(codigo ?? "").slice(0, 100));
    return r.ok
      ? { ok: true, vista: r.vista }
      : { ok: false, mensagem: r.mensagem };
  } catch (erro) {
    console.error("fornecedor/cotacao ler:", erro);
    return {
      ok: false,
      mensagem:
        "Não conseguimos abrir a cotação agora. Tente de novo em instantes.",
    };
  }
}

export async function enviarPropostaAcao(
  _anterior: EstadoDaResposta,
  dados: FormData,
): Promise<EstadoDaResposta> {
  if (await passouDoLimite("enviar")) {
    return {
      erro: "Muitos envios seguidos. Espere um minuto e envie de novo — o que você digitou continua aqui.",
    };
  }
  const codigo = String(dados.get("codigo") ?? "").slice(0, 100);
  let bruto: unknown;
  try {
    bruto = JSON.parse(String(dados.get("resposta") ?? ""));
  } catch {
    return { erro: "Não conseguimos ler o formulário. Recarregue a página." };
  }

  try {
    const r = await registrarPeloLink(codigo, bruto);
    if (!r.ok) return { erro: r.mensagem, erros: r.erros };
    return {
      ok: `Recebemos sua proposta (versão ${r.versao}). Se precisar corrigir, mude e envie de novo até o prazo — vale a última.`,
    };
  } catch (erro) {
    console.error("fornecedor/cotacao enviar:", erro);
    return {
      erro: "Não conseguimos gravar agora. O que você digitou continua aqui — tente de novo em instantes.",
    };
  }
}
