"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { abrirRespostaAcao, type EstadoChecklist } from "../acoes";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * Um checklist FORA da agenda.
 *
 * Existe porque a operação real tem exceções: a vigilância sanitária avisou que
 * vem amanhã, um equipamento novo chegou, o dono quer conferir a loja num
 * domingo. Sem isto, a única forma de responder algo não agendado seria criar
 * uma rotina falsa — e a lista do dia passaria a cobrar para sempre uma coisa
 * que aconteceu uma vez.
 */
export function FormularioAvulso({
  modelos,
  hoje,
}: {
  modelos: { id: string; nome: string; _count: { itens: number } }[];
  hoje: string;
}) {
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    abrirRespostaAcao,
    {},
  );

  if (modelos.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="font-semibold">Nenhum checklist escrito ainda</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Um checklist precisa ter perguntas antes de poder ser respondido.
        </p>
        <div className="mt-4">
          <Link
            href="/checklists/modelos/novo"
            className={estiloDeBotao("secundario")}
          >
            Criar um checklist
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={acao} className="flex max-w-[480px] flex-col gap-4">
      <div className="flex w-full flex-col gap-1.5">
        <label htmlFor="modeloId" className="text-ink-2 text-sm font-semibold">
          Qual checklist
        </label>
        <select
          id="modeloId"
          name="modeloId"
          className={ESTILO_SELECT}
          required
        >
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome} ({m._count.itens}{" "}
              {m._count.itens === 1 ? "item" : "itens"})
            </option>
          ))}
        </select>
        {estado.erros?.modeloId && (
          <span className="text-bad text-sm">{estado.erros.modeloId}</span>
        )}
      </div>

      <Campo
        rotulo="Data"
        name="referencia"
        type="date"
        defaultValue={hoje}
        erro={estado.erros?.referencia}
        ajuda="O dia que a resposta representa. O fechamento das 23h costuma ser lançado depois da meia-noite."
        required
      />

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Botao type="submit" carregando={enviando}>
          Abrir checklist
        </Botao>
        <Link href="/checklists" className={estiloDeBotao("fantasma")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
