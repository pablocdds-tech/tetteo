"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { criarNotaAcao, type EstadoFormulario } from "../acoes";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * A CAPA DA NOTA.
 *
 * Só o cabeçalho: fornecedor, número, quando chegou e onde foi guardado. Os
 * itens vêm na tela seguinte, um a um — digitar vinte linhas num formulário
 * só significa perder as vinte se o celular travar no meio.
 *
 * O fornecedor é campo livre com sugestão. Travar a nota até alguém cadastrar
 * o fornecedor certo é o tipo de exigência que faz a pessoa desistir e anotar
 * no caderno.
 */
export function FormularioNota({
  fornecedores,
  locais,
  agora,
}: {
  fornecedores: { id: string; nome: string }[];
  locais: { id: string; nome: string }[];
  agora: string;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    criarNotaAcao,
    {},
  );

  // O depósito é o destino natural: mercadoria chega e é guardada, depois
  // desce para a praça.
  const padrao =
    locais.find((l) => /estoque/i.test(l.nome))?.id ?? locais[0]?.id ?? "";

  return (
    <form action={acao} className="flex max-w-[560px] flex-col gap-4">
      <Campo
        rotulo="Fornecedor"
        name="fornecedor"
        list="fornecedores"
        placeholder="Ex.: Distribuidora Nordeste"
        erro={estado.erros?.fornecedor}
        ajuda="Se ainda não existir, é cadastrado na hora."
        required
        autoFocus
      />
      <datalist id="fornecedores">
        {fornecedores.map((f) => (
          <option key={f.id} value={f.nome} />
        ))}
      </datalist>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="Número"
          name="numero"
          inputMode="numeric"
          erro={estado.erros?.numero}
        />
        <Campo rotulo="Série" name="serie" erro={estado.erros?.serie} />
        <Campo
          rotulo="Chegou em"
          name="recebidaEm"
          type="date"
          defaultValue={agora}
          erro={estado.erros?.recebidaEm}
          required
        />
      </div>

      <div className="flex w-full flex-col gap-1.5">
        <label
          htmlFor="localDestinoId"
          className="text-ink-2 text-sm font-semibold"
        >
          Guardado em
        </label>
        <select
          id="localDestinoId"
          name="localDestinoId"
          defaultValue={padrao}
          className={ESTILO_SELECT}
        >
          {locais.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <span className="text-ink-3 text-sm">
          É onde o saldo vai entrar quando a nota for lançada.
        </span>
      </div>

      <Campo rotulo="Observação" name="observacao" />

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
          Começar a digitar os itens
        </Botao>
        <Link href="/estoque/entradas">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
