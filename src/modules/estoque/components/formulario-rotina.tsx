"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { criarRotinaAcao, type EstadoFormulario } from "../acoes";

const DIAS = [
  { valor: 1, nome: "Segunda" },
  { valor: 2, nome: "Terça" },
  { valor: 3, nome: "Quarta" },
  { valor: 4, nome: "Quinta" },
  { valor: 5, nome: "Sexta" },
  { valor: 6, nome: "Sábado" },
  { valor: 0, nome: "Domingo" },
];

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * Criar uma rotina de contagem.
 *
 * O campo que muda conforme a frequência (dia da semana / dia do mês) troca
 * na hora — mostrar os dois sempre faria metade do formulário ser ruído.
 */
export function FormularioRotina({
  locais,
  categorias,
}: {
  locais: { id: string; nome: string }[];
  categorias: string[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    criarRotinaAcao,
    {},
  );
  const [recorrencia, setRecorrencia] = useState("DIARIA");

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      <Campo
        rotulo="Nome da rotina"
        name="nome"
        placeholder="Ex.: Contagem da praça"
        erro={estado.erros?.nome}
        required
        autoFocus
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex w-full flex-col gap-1.5">
          <label
            htmlFor="recorrencia"
            className="text-ink-2 text-sm font-semibold"
          >
            Frequência
          </label>
          <select
            id="recorrencia"
            name="recorrencia"
            value={recorrencia}
            onChange={(e) => setRecorrencia(e.target.value)}
            className={ESTILO_SELECT}
          >
            <option value="DIARIA">Todo dia</option>
            <option value="SEMANAL">Toda semana</option>
            <option value="MENSAL">Todo mês</option>
          </select>
        </div>

        {recorrencia === "SEMANAL" && (
          <div className="flex w-full flex-col gap-1.5">
            <label
              htmlFor="diaDaSemana"
              className="text-ink-2 text-sm font-semibold"
            >
              Em qual dia
            </label>
            <select
              id="diaDaSemana"
              name="diaDaSemana"
              defaultValue="1"
              className={ESTILO_SELECT}
            >
              {DIAS.map((d) => (
                <option key={d.valor} value={d.valor}>
                  {d.nome}
                </option>
              ))}
            </select>
            {estado.erros?.diaDaSemana && (
              <span className="text-bad text-sm">
                {estado.erros.diaDaSemana}
              </span>
            )}
          </div>
        )}

        {recorrencia === "MENSAL" && (
          <Campo
            rotulo="Em qual dia (1 a 28)"
            name="diaDoMes"
            inputMode="numeric"
            defaultValue="1"
            erro={estado.erros?.diaDoMes}
          />
        )}

        {recorrencia === "DIARIA" && (
          <Campo
            rotulo="Horário"
            name="horario"
            type="time"
            erro={estado.erros?.horario}
            ajuda="Opcional. Só aparece na agenda."
          />
        )}
      </div>

      {recorrencia !== "DIARIA" && (
        <Campo
          rotulo="Horário"
          name="horario"
          type="time"
          erro={estado.erros?.horario}
          ajuda="Opcional. Só aparece na agenda — o atraso é cobrado por dia."
        />
      )}

      <div className="flex w-full flex-col gap-1.5">
        <label htmlFor="localId" className="text-ink-2 text-sm font-semibold">
          Onde contar
        </label>
        <select id="localId" name="localId" className={ESTILO_SELECT}>
          <option value="">A loja inteira</option>
          {locais.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <span className="text-ink-3 text-sm">
          Escolher um lugar faz a folha ter só o que existe nele — é o que deixa
          a contagem diária rápida.
        </span>
      </div>

      {categorias.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-ink-2 text-sm font-semibold">
            Limitar a categorias
          </legend>
          <p className="text-ink-3 -mt-1 text-sm">
            Opcional. Não marque nada para contar todas.
          </p>
          <div className="border-line divide-line mt-1 max-h-56 divide-y overflow-y-auto rounded-xl border">
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
          Criar rotina
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
