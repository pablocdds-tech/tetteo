"use server";

import { redirect } from "next/navigation";

import { obterContexto } from "@/core/sessao/contexto";
import type { EstadoDaCotacao } from "@/modules/estoque/components/lista-de-compras";

/**
 * DA DESPENSA PARA A REQUISIÇÃO.
 *
 * Provisória durante a reconstrução de Compras: a cotação de 04/08 deixou de
 * existir, e a lista da Despensa passa a alimentar a REQUISIÇÃO da loja na
 * rodada aberta (Tarefa H3 do plano). Até lá, a ação responde com uma frase e
 * não grava nada — a lista continua na tela.
 */
export async function criarCotacaoDaDespensa(): Promise<EstadoDaCotacao> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  return {
    erro: "Compras está sendo atualizado: esta lista vai passar a entrar na requisição da loja. Nada foi gravado — sua lista continua aqui.",
  };
}
