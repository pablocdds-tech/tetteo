"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { criarRotinaAcao, type EstadoChecklist } from "../acoes";

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
 * Agendar um checklist nesta loja.
 *
 * O responsável é opcional, e a ausência dele significa "quem estiver de
 * plantão" — não "ninguém". Numa pizzaria de dez pessoas, exigir um nome para
 * cada rotina criaria cadastro que ninguém mantém: o Alisson sai de férias e o
 * checklist da abertura fica órfão sem que a tela avise.
 */
export function FormularioRotina({
  modelos,
  responsaveis,
}: {
  modelos: { id: string; nome: string; _count: { itens: number } }[];
  responsaveis: { id: string; nome: string }[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    criarRotinaAcao,
    {},
  );
  const [recorrencia, setRecorrencia] = useState("DIARIA");

  if (modelos.length === 0) {
    return (
      <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="font-semibold">
          Todos os checklists já estão agendados aqui
        </p>
        <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
          Para agendar mais um, escreva primeiro um modelo novo — ou reative um
          que esteja desativado.
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
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
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

        <Campo
          rotulo="Horário"
          name="horario"
          type="time"
          erro={estado.erros?.horario}
          ajuda="Opcional. Ordena a lista do dia — o atraso é cobrado por dia."
        />
      </div>

      <div className="flex w-full flex-col gap-1.5">
        <label
          htmlFor="responsavelId"
          className="text-ink-2 text-sm font-semibold"
        >
          Responsável
        </label>
        <select
          id="responsavelId"
          name="responsavelId"
          className={ESTILO_SELECT}
        >
          <option value="">Quem estiver de plantão</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
        <span className="text-ink-3 text-sm">
          Aparece na lista do dia. Qualquer pessoa com permissão pode responder
          — o nome aqui diz de quem se cobra, não quem tem a chave.
        </span>
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
          Agendar
        </Botao>
        <Link href="/checklists" className={estiloDeBotao("fantasma")}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
