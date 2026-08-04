"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { salvarInsumo, type EstadoFormulario } from "../acoes";
import { UNIDADES } from "../schemas/insumo";

type Valores = {
  id?: string;
  nome?: string;
  categoria?: string | null;
  unidadeMedida?: string;
  custoMedio?: string;
  estoqueMinimo?: string;
};

export function FormularioInsumo({ valores = {} }: { valores?: Valores }) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    salvarInsumo,
    {},
  );

  const editando = Boolean(valores.id);

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      {valores.id && <input type="hidden" name="id" value={valores.id} />}

      <Campo
        rotulo="Nome do insumo"
        name="nome"
        defaultValue={valores.nome}
        placeholder="Ex.: Mussarela fatiada"
        erro={estado.erros?.nome}
        required
        autoFocus
      />

      <Campo
        rotulo="Categoria"
        name="categoria"
        defaultValue={valores.categoria ?? ""}
        placeholder="Ex.: Laticínios"
        erro={estado.erros?.categoria}
        ajuda="Opcional. Ajuda a agrupar na lista."
      />

      <div className="flex w-full flex-col gap-1.5">
        <label
          htmlFor="unidadeMedida"
          className="text-ink-2 text-sm font-semibold"
        >
          Unidade de medida
        </label>
        <select
          id="unidadeMedida"
          name="unidadeMedida"
          defaultValue={valores.unidadeMedida ?? "KG"}
          className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
        >
          {UNIDADES.map((u) => (
            <option key={u.valor} value={u.valor}>
              {u.rotulo}
            </option>
          ))}
        </select>
        {estado.erros?.unidadeMedida && (
          <span className="text-bad text-sm">{estado.erros.unidadeMedida}</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Custo por unidade"
          name="custoMedio"
          inputMode="decimal"
          defaultValue={valores.custoMedio ?? "0"}
          erro={estado.erros?.custoMedio}
          ajuda="Em reais. Pode usar vírgula."
        />
        <Campo
          rotulo="Estoque mínimo"
          name="estoqueMinimo"
          inputMode="decimal"
          defaultValue={valores.estoqueMinimo ?? "0"}
          erro={estado.erros?.estoqueMinimo}
          ajuda="Abaixo disso, entra na reposição."
        />
      </div>

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
          {editando ? "Salvar alterações" : "Cadastrar insumo"}
        </Botao>
        <Link href="/cardapio">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
