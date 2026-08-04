"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
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
  agora,
}: {
  categorias: string[];
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
        <Link href="/estoque/contagens">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
