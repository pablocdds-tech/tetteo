"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { salvarUnidadeAcao, type EstadoConfig } from "../acoes";

export function FormularioUnidade({
  unidade,
}: {
  unidade?: {
    id: string;
    nome: string;
    codigo: string;
    documento: string | null;
    cidade: string | null;
    estado: string | null;
    telefone: string | null;
  };
}) {
  const [estado, acao, enviando] = useActionState<EstadoConfig, FormData>(
    salvarUnidadeAcao,
    {},
  );

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      {unidade && <input type="hidden" name="id" value={unidade.id} />}

      <Campo
        rotulo="Nome da loja"
        name="nome"
        defaultValue={unidade?.nome ?? ""}
        placeholder="Ex.: Zona Sul"
        erro={estado.erros?.nome}
        required
        autoFocus
      />

      <Campo
        rotulo="Código"
        name="codigo"
        defaultValue={unidade?.codigo ?? ""}
        placeholder="Ex.: ZS"
        erro={estado.erros?.codigo}
        ajuda="Curto, sem espaço. Aparece em etiqueta e relatório, onde o nome inteiro não cabe."
        required
      />

      <Campo
        rotulo="CNPJ"
        name="documento"
        defaultValue={unidade?.documento ?? ""}
        erro={estado.erros?.documento}
        ajuda="Opcional. Cada loja pode ter o seu."
      />

      <div className="grid gap-4 sm:grid-cols-[1fr_5rem]">
        <Campo
          rotulo="Cidade"
          name="cidade"
          defaultValue={unidade?.cidade ?? ""}
          erro={estado.erros?.cidade}
        />
        <Campo
          rotulo="UF"
          name="estado"
          maxLength={2}
          defaultValue={unidade?.estado ?? ""}
          erro={estado.erros?.estado}
        />
      </div>

      <Campo
        rotulo="Telefone"
        name="telefone"
        defaultValue={unidade?.telefone ?? ""}
        erro={estado.erros?.telefone}
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
          {unidade ? "Salvar loja" : "Criar loja"}
        </Botao>
        <Link href="/configuracoes/unidades">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
