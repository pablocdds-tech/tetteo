"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { abrirContagem, type EstadoFormulario } from "../acoes";

/**
 * Abrir uma contagem.
 *
 * Três campos, e o único que exige atenção é o primeiro. Por isso ele vem
 * preenchido com o momento atual: no caso comum a pessoa confere e segue.
 */
export function FormularioNovaContagem({
  categorias,
  locais,
  agora,
}: {
  categorias: string[];
  locais: { id: string; nome: string }[];
  agora: string;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    abrirContagem,
    {},
  );

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      <Campo
        rotulo="Data e hora da contagem"
        name="referencia"
        type="datetime-local"
        defaultValue={agora}
        erro={estado.erros?.referencia}
        ajuda="O momento que a contagem representa. Se você conta segunda de manhã o estoque que fechou domingo, coloque domingo à noite."
        required
      />

      <Campo
        rotulo="Descrição"
        name="descricao"
        placeholder="Ex.: Semana 32"
        erro={estado.erros?.descricao}
        ajuda="Opcional. Serve só para você reconhecer a contagem na lista."
      />

      {locais.length > 0 && (
        <div className="flex w-full flex-col gap-1.5">
          <label htmlFor="localId" className="text-ink-2 text-sm font-semibold">
            Onde contar
          </label>
          <select
            id="localId"
            name="localId"
            className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
          >
            <option value="">A loja inteira</option>
            {locais.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
          <span className="text-ink-3 text-sm">
            Escolher um lugar traz só o que existe nele — folha curta, contagem
            rápida.
          </span>
        </div>
      )}

      {categorias.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-ink-2 text-sm font-semibold">
            O que vai ser contado
          </legend>
          <p className="text-ink-3 -mt-1 text-sm">
            Não marque nada para contar tudo. Marcar categorias faz a contagem
            semanal do que pesa no custo — e o CMV sai só sobre o que foi
            contado nas duas pontas.
          </p>

          <div className="border-line divide-line mt-1 divide-y rounded-xl border">
            {categorias.map((categoria) => (
              <label
                key={categoria}
                className="hover:bg-surface-2 flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  name="categorias"
                  value={categoria}
                  className="accent-accent size-4"
                />
                {categoria}
              </label>
            ))}
          </div>
        </fieldset>
      )}

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
          Abrir contagem
        </Botao>
        <Link
          href="/estoque/contagens"
          className={estiloDeBotao("fantasma", "medio")}
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
