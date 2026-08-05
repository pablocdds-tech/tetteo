"use client";

import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { criarAgenteAcao, type EstadoFormulario } from "../acoes";

const DIAS = [
  { valor: 1, nome: "Seg" },
  { valor: 2, nome: "Ter" },
  { valor: 3, nome: "Qua" },
  { valor: 4, nome: "Qui" },
  { valor: 5, nome: "Sex" },
  { valor: 6, nome: "Sáb" },
  { valor: 0, nome: "Dom" },
];

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * Criar um agente.
 *
 * A tela inteira é uma tradução da regra MOLE × DURO: a caixa de instruções
 * (texto livre, orienta o modelo) fica visualmente separada dos limites
 * (campos, o código confere). Quem preenche precisa perceber que são coisas
 * de natureza diferente — senão escreve "nunca mande depois das 22h" na caixa
 * de texto e acha que está protegido.
 */
export function FormularioAgente({
  papeis,
  pessoas,
  unidades,
}: {
  papeis: string[];
  pessoas: { id: string; nome: string }[];
  unidades: { id: string; nome: string }[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    criarAgenteAcao,
    {},
  );
  const [gatilho, setGatilho] = useState("ROTINA_VENCIDA");

  return (
    <form action={acao} className="flex max-w-[560px] flex-col gap-5">
      {estado.erro && (
        <p className="border-bad/40 bg-bad/10 text-bad rounded-md border px-3 py-2 text-sm">
          {estado.erro}
        </p>
      )}

      <Campo
        rotulo="Nome do agente"
        name="nome"
        placeholder="Ex.: Cobrança da contagem"
        ajuda="Só você vê. Escolha um nome que reconheça daqui a seis meses."
        erro={estado.erros?.nome}
        required
        autoFocus
      />

      {/* ---------- QUANDO ---------- */}
      <fieldset className="border-line rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">Quando ela fala</legend>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="gatilho" className="text-ink-2 text-sm font-semibold">
            Gatilho
          </label>
          <select
            id="gatilho"
            name="gatilho"
            value={gatilho}
            onChange={(e) => setGatilho(e.target.value)}
            className={ESTILO_SELECT}
          >
            <option value="ROTINA_VENCIDA">
              Quando uma contagem vence ou atrasa
            </option>
            <option value="HORARIO">Em um horário fixo</option>
          </select>
        </div>

        {/* Mostrar os dois sempre faria metade do bloco ser ruído. */}
        {gatilho === "HORARIO" && (
          <div className="mt-4 flex flex-col gap-4">
            <Campo
              rotulo="Horário"
              name="horario"
              type="time"
              defaultValue="07:00"
              erro={estado.erros?.horario}
            />
            <div>
              <span className="text-ink-2 text-sm font-semibold">
                Dias da semana
              </span>
              <p className="text-ink-3 mt-0.5 text-xs">
                Nenhum marcado significa todo dia.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DIAS.map((d) => (
                  <label
                    key={d.valor}
                    className="border-line-2 hover:bg-surface-2 flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="diasDaSemana"
                      value={d.valor}
                    />
                    {d.nome}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </fieldset>

      {/* ---------- COM QUEM ---------- */}
      <fieldset className="border-line rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">
          Com quem ela fala
        </legend>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="unidadeId"
            className="text-ink-2 text-sm font-semibold"
          >
            Loja
          </label>
          <select id="unidadeId" name="unidadeId" className={ESTILO_SELECT}>
            <option value="">Todas as lojas</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <span className="text-ink-2 text-sm font-semibold">Por papel</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {papeis.map((p) => (
              <label
                key={p}
                className="border-line-2 hover:bg-surface-2 flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <input type="checkbox" name="destinatariosPapeis" value={p} />
                {p}
              </label>
            ))}
          </div>
          {estado.erros?.destinatariosPapeis && (
            <p className="text-bad mt-2 text-sm">
              {estado.erros.destinatariosPapeis}
            </p>
          )}
        </div>

        <div className="mt-4">
          <span className="text-ink-2 text-sm font-semibold">
            Ou pessoas específicas
          </span>
          {pessoas.length === 0 ? (
            <p className="text-ink-3 mt-1 text-sm">
              Ninguém tem número vinculado ainda. Cadastre em{" "}
              <strong>Números</strong>.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {pessoas.map((p) => (
                <label
                  key={p.id}
                  className="border-line-2 hover:bg-surface-2 flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="destinatariosUsuarios"
                    value={p.id}
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {/* ---------- COMO (MOLE) ---------- */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="instrucoes"
          className="text-ink-2 text-sm font-semibold"
        >
          Como ela fala
        </label>
        <textarea
          id="instrucoes"
          name="instrucoes"
          rows={5}
          required
          defaultValue="Você é a Severina, do Vitaliano. Fale curto e direto. Cobre sem enrolação. Se a pessoa disser que não dá agora, pergunte que horas dá e não insista."
          className="border-line-2 bg-surface text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
        />
        <p className="text-ink-3 text-xs">
          Isto <strong>orienta</strong> a Severina — não a obriga. Regra que não
          pode ser quebrada vai nos limites abaixo, não aqui.
        </p>
        {estado.erros?.instrucoes && (
          <p className="text-bad text-sm">{estado.erros.instrucoes}</p>
        )}
      </div>

      {/* ---------- LIMITES (DURO) ---------- */}
      <fieldset className="border-line rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">Limites</legend>
        <p className="text-ink-3 mb-3 text-xs">
          Estes o sistema confere antes de mandar. Não dependem da Severina
          concordar.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Não falar antes de"
            name="janelaInicio"
            type="time"
            defaultValue="06:00"
            erro={estado.erros?.janelaInicio}
          />
          <Campo
            rotulo="Nem depois de"
            name="janelaFim"
            type="time"
            defaultValue="22:00"
            erro={estado.erros?.janelaFim}
          />
        </div>
      </fieldset>

      <div className="border-line bg-surface-2 rounded-lg border px-3 py-2 text-sm">
        O agente nasce <strong>desligado</strong>. Confira e ligue na lista —
        assim a primeira mensagem não sai antes de você ler.
      </div>

      <div>
        <Botao type="submit" carregando={enviando}>
          Criar agente
        </Botao>
      </div>
    </form>
  );
}
