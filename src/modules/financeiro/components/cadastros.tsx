"use client";

import { useActionState, useRef } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { formatarMoeda } from "@/lib/numero";

import {
  desativarCategoriaAcao,
  salvarCategoriaAcao,
  salvarContaAcao,
  type EstadoFinanceiro,
} from "../acoes";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * Categorias e contas.
 *
 * As categorias já vêm criadas no primeiro acesso — as dez que toda pizzaria
 * tem. Uma tela de "monte seu plano de contas" na frente da primeira conta a
 * pagar é onde o módulo seria abandonado, e categoria se renomeia depois sem
 * perder nada.
 */
export function Cadastros({
  categorias,
  contas,
}: {
  categorias: {
    id: string;
    nome: string;
    tipo: string;
    grupo: string | null;
    ehSistema: boolean;
    ativa: boolean;
  }[];
  contas: {
    id: string;
    nome: string;
    tipo: string;
    saldoInicial: number;
    ativa: boolean;
  }[];
}) {
  const [estadoCat, acaoCat, salvandoCat] = useActionState<
    EstadoFinanceiro,
    FormData
  >(salvarCategoriaAcao, {});
  const [estadoConta, acaoConta, salvandoConta] = useActionState<
    EstadoFinanceiro,
    FormData
  >(salvarContaAcao, {});

  const formCat = useRef<HTMLFormElement>(null);
  const formConta = useRef<HTMLFormElement>(null);

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <h2 className="font-semibold">Contas e caixa</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Onde o dinheiro fica. O saldo inicial é o do dia em que você começou a
          usar o sistema — sem ele, o saldo aqui nunca bate com o real.
        </p>

        {contas.length === 0 ? (
          <p className="border-line-2 text-ink-3 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            Nenhuma conta ainda. Cadastre pelo menos a gaveta do caixa.
          </p>
        ) : (
          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {contas.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.nome}</span>
                  <span className="text-ink-3 block text-xs">
                    {c.tipo === "CAIXA" ? "Caixa" : "Banco"}
                  </span>
                </span>
                <span className="text-ink-2 tabular-nums">
                  {formatarMoeda(c.saldoInicial)}
                  <span className="text-ink-3 block text-[10px]">inicial</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <form
          ref={formConta}
          action={(d) => {
            acaoConta(d);
            formConta.current?.reset();
          }}
          className="border-line bg-surface-2 mt-3 flex flex-col gap-3 rounded-xl border p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Nome"
              name="nome"
              placeholder="Ex.: Caixa da loja"
              erro={estadoCat.erros?.nome ?? estadoConta.erros?.nome}
              required
            />
            <div className="flex w-full flex-col gap-1.5">
              <label
                htmlFor="tipoConta"
                className="text-ink-2 text-sm font-semibold"
              >
                Tipo
              </label>
              <select
                id="tipoConta"
                name="tipo"
                defaultValue="BANCO"
                className={ESTILO_SELECT}
              >
                <option value="BANCO">Banco</option>
                <option value="CAIXA">Caixa (gaveta)</option>
              </select>
            </div>
          </div>

          <Campo
            rotulo="Saldo inicial"
            name="saldoInicial"
            inputMode="decimal"
            placeholder="0,00"
            erro={estadoConta.erros?.saldoInicial}
            ajuda="Quanto havia quando você começou a usar o sistema."
          />

          {estadoConta.erro && (
            <p className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm">
              {estadoConta.erro}
            </p>
          )}

          <div>
            <Botao
              type="submit"
              peso="secundario"
              tamanho="pequeno"
              carregando={salvandoConta}
            >
              Adicionar conta
            </Botao>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-semibold">Categorias</h2>
        <p className="text-ink-3 mt-1 text-sm">
          As gavetas do resultado. As que vieram com o sistema podem ser
          renomeadas, não trocadas de lado.
        </p>

        <div className="border-line divide-line mt-3 max-h-96 divide-y overflow-y-auto rounded-xl border">
          {categorias.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 px-4 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.nome}</span>
                {c.grupo && (
                  <span className="text-ink-3 block text-xs">{c.grupo}</span>
                )}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  c.tipo === "RECEITA"
                    ? "bg-ok-sub text-ok"
                    : "bg-surface-3 text-ink-2"
                }`}
              >
                {c.tipo === "RECEITA" ? "receita" : "despesa"}
              </span>
              {!c.ehSistema && (
                <form action={desativarCategoriaAcao}>
                  <input type="hidden" name="id" value={c.id} />
                  <Botao peso="fantasma" tamanho="pequeno" type="submit">
                    ✕
                  </Botao>
                </form>
              )}
            </div>
          ))}
        </div>

        <form
          ref={formCat}
          action={(d) => {
            acaoCat(d);
            formCat.current?.reset();
          }}
          className="border-line bg-surface-2 mt-3 flex flex-col gap-3 rounded-xl border p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Nome"
              name="nome"
              placeholder="Ex.: Contador"
              erro={estadoCat.erros?.nome}
              required
            />
            <div className="flex w-full flex-col gap-1.5">
              <label
                htmlFor="tipoCat"
                className="text-ink-2 text-sm font-semibold"
              >
                É o quê
              </label>
              <select
                id="tipoCat"
                name="tipo"
                defaultValue="DESPESA"
                className={ESTILO_SELECT}
              >
                <option value="DESPESA">Despesa</option>
                <option value="RECEITA">Receita</option>
              </select>
            </div>
          </div>

          <Campo
            rotulo="Grupo"
            name="grupo"
            placeholder="Ex.: Administrativo"
            erro={estadoCat.erros?.grupo}
            ajuda="Opcional. Junta categorias parecidas na tela de resultado."
          />

          {estadoCat.erro && (
            <p className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm">
              {estadoCat.erro}
            </p>
          )}

          <div>
            <Botao
              type="submit"
              peso="secundario"
              tamanho="pequeno"
              carregando={salvandoCat}
            >
              Adicionar categoria
            </Botao>
          </div>
        </form>
      </section>
    </div>
  );
}
