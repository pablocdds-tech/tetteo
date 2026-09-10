"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { salvarModeloAcao, type EstadoChecklist } from "../acoes";

/**
 * O cabeçalho do modelo: nome e para que ele serve.
 *
 * As perguntas vêm depois, na tela do modelo já salvo. Pedir o nome e catorze
 * itens no mesmo formulário faria perder tudo se algo desse errado no meio.
 */
export function FormularioModelo({
  modelo,
}: {
  modelo?: { id: string; nome: string; descricao: string | null };
}) {
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    salvarModeloAcao,
    {},
  );

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      {modelo && <input type="hidden" name="id" value={modelo.id} />}

      <Campo
        rotulo="Nome do checklist"
        name="nome"
        defaultValue={modelo?.nome ?? ""}
        placeholder="Ex.: Abertura da Pizzaria"
        erro={estado.erros?.nome}
        required
        autoFocus
      />

      <Campo
        rotulo="Para que serve"
        name="descricao"
        defaultValue={modelo?.descricao ?? ""}
        placeholder="Ex.: conferência antes de abrir a porta"
        erro={estado.erros?.descricao}
        ajuda="Opcional. Aparece para quem vai responder."
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
          {modelo ? "Salvar" : "Criar checklist"}
        </Botao>
        <Link href="/checklists/modelos" className={estiloDeBotao("fantasma")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
