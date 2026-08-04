"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { salvarOrganizacaoAcao, type EstadoConfig } from "../acoes";

export function FormularioOrganizacao({
  organizacao,
}: {
  organizacao: { nome: string; documento: string | null };
}) {
  const [estado, acao, enviando] = useActionState<EstadoConfig, FormData>(
    salvarOrganizacaoAcao,
    {},
  );

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      <Campo
        rotulo="Nome da rede"
        name="nome"
        defaultValue={organizacao.nome}
        erro={estado.erros?.nome}
        ajuda="Aparece no topo e nos relatórios."
        required
      />

      <Campo
        rotulo="CNPJ"
        name="documento"
        defaultValue={organizacao.documento ?? ""}
        erro={estado.erros?.documento}
        ajuda="Opcional. Cada loja pode ter o seu, em Unidades."
      />

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}
      {estado.sucesso && (
        <p role="status" className="text-ok text-sm">
          {estado.sucesso}
        </p>
      )}

      <div>
        <Botao type="submit" carregando={enviando}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}
