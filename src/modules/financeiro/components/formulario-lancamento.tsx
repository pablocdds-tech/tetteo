"use client";

import { useActionState, useRef, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { hojeParaCampo } from "@/lib/data";
import { formatarMoeda } from "@/lib/numero";

import { criarLancamentoAcao, type EstadoFinanceiro } from "../acoes";
import { dividirEmParcelas } from "../schemas/dinheiro";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * O cadastro de uma conta.
 *
 * O valor pedido é o TOTAL, não o da parcela. Pedir o valor da parcela
 * obrigaria a pessoa a dividir de cabeça — e é aí que o centavo se perde. Ao
 * digitar 100 em 3 vezes, a tela já mostra "33,34 + 33,33 + 33,33", que é o que
 * vai aparecer no extrato.
 */
export function FormularioLancamento({
  direcao,
  categorias,
  contas,
  fornecedores,
}: {
  direcao: "PAGAR" | "RECEBER";
  categorias: { id: string; nome: string; tipo: string }[];
  contas: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoFinanceiro, FormData>(
    criarLancamentoAcao,
    {},
  );
  const formulario = useRef<HTMLFormElement>(null);
  const [valor, setValor] = useState("");
  const [parcelas, setParcelas] = useState("1");

  const tipoDaCategoria = direcao === "PAGAR" ? "DESPESA" : "RECEITA";
  const numero = Number(valor.replace(/\./g, "").replace(",", "."));
  const vezes = Number(parcelas);
  const previa =
    Number.isFinite(numero) && numero > 0 && vezes > 1 && vezes <= 60
      ? dividirEmParcelas(numero, vezes)
      : null;

  return (
    <form
      ref={formulario}
      action={(dados) => {
        acao(dados);
        formulario.current?.reset();
        setValor("");
        setParcelas("1");
      }}
      className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4"
    >
      <input type="hidden" name="direcao" value={direcao} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="O que é"
          name="descricao"
          placeholder={
            direcao === "PAGAR"
              ? "Ex.: Aluguel de agosto"
              : "Ex.: Repasse iFood"
          }
          erro={estado.erros?.descricao}
          required
        />

        <div className="flex w-full flex-col gap-1.5">
          <label
            htmlFor="categoriaId"
            className="text-ink-2 text-sm font-semibold"
          >
            Categoria
          </label>
          <select id="categoriaId" name="categoriaId" className={ESTILO_SELECT}>
            <option value="">Sem categoria</option>
            {categorias
              .filter((c) => c.tipo === tipoDaCategoria)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="Valor total"
          name="valor"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="1.200,00"
          erro={estado.erros?.valor}
          required
        />

        <Campo
          rotulo="Primeiro vencimento"
          name="vencimento"
          type="date"
          defaultValue={hojeParaCampo()}
          erro={estado.erros?.vencimento}
          required
        />

        <Campo
          rotulo="Repetir (meses)"
          name="parcelas"
          inputMode="numeric"
          value={parcelas}
          onChange={(e) => setParcelas(e.target.value)}
          erro={estado.erros?.parcelas}
          ajuda="1 = conta única."
        />
      </div>

      {previa && (
        <p className="text-ink-2 text-sm">
          {vezes} parcelas de{" "}
          <strong className="tabular-nums">{formatarMoeda(previa[0])}</strong>
          {previa[0] !== previa[vezes - 1] && (
            <>
              {" "}
              (a primeira) e{" "}
              <strong className="tabular-nums">
                {formatarMoeda(previa[vezes - 1])}
              </strong>{" "}
              (as demais)
            </>
          )}
          , de mês em mês. Somam exatamente o total.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {direcao === "PAGAR" && fornecedores.length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            <label
              htmlFor="fornecedorId"
              className="text-ink-2 text-sm font-semibold"
            >
              Fornecedor
            </label>
            <select
              id="fornecedorId"
              name="fornecedorId"
              className={ESTILO_SELECT}
            >
              <option value="">—</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {contas.length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            <label
              htmlFor="contaId"
              className="text-ink-2 text-sm font-semibold"
            >
              Conta prevista
            </label>
            <select id="contaId" name="contaId" className={ESTILO_SELECT}>
              <option value="">—</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm">
          {estado.ok}
        </p>
      )}

      <div>
        <Botao type="submit" peso="secundario" carregando={enviando}>
          {direcao === "PAGAR"
            ? "Cadastrar conta a pagar"
            : "Cadastrar a receber"}
        </Botao>
      </div>
    </form>
  );
}
