"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { salvarFicha, type EstadoFormulario } from "../acoes";
import { UNIDADES } from "../schemas/insumo";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * O CABEÇALHO DA FICHA: o que é, quanto rende, por quanto se vende.
 *
 * O rendimento é o campo que as pessoas pulam e é o que faz a ficha funcionar.
 * Por isso a ajuda dele não explica o conceito — dá o exemplo: a massa rende 8
 * discos, então o disco custa um oitavo. Sem esse número, o preparo não tem
 * preço unitário e não pode entrar em outra receita.
 */
export function FormularioFicha({
  ficha,
  podeVerCustos,
}: {
  ficha?: {
    id: string;
    nome: string;
    categoria: string | null;
    tipo: "PRATO" | "PREPARO";
    modoDePreparo: string | null;
    rendimento: string;
    unidadeRendimento: string;
    precoVenda: string;
  };
  podeVerCustos: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoFormulario, FormData>(
    salvarFicha,
    {},
  );
  const [tipo, setTipo] = useState(ficha?.tipo ?? "PRATO");

  return (
    <form action={acao} className="flex max-w-[640px] flex-col gap-4">
      {ficha && <input type="hidden" name="id" value={ficha.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          name="nome"
          defaultValue={ficha?.nome ?? ""}
          placeholder="Ex.: Pizza Margherita G"
          erro={estado.erros?.nome}
          required
          autoFocus
        />
        <Campo
          rotulo="Categoria"
          name="categoria"
          defaultValue={ficha?.categoria ?? ""}
          placeholder="Ex.: Pizzas salgadas"
          erro={estado.erros?.categoria}
        />
      </div>

      <div className="flex w-full flex-col gap-1.5">
        <label htmlFor="tipo" className="text-ink-2 text-sm font-semibold">
          O que é
        </label>
        <select
          id="tipo"
          name="tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "PRATO" | "PREPARO")}
          className={ESTILO_SELECT}
        >
          <option value="PRATO">Prato — vai para o cliente, tem preço</option>
          <option value="PREPARO">
            Preparo — massa, molho, mix; entra em outras fichas
          </option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="Rende"
          name="rendimento"
          inputMode="decimal"
          defaultValue={ficha?.rendimento ?? "1"}
          erro={estado.erros?.rendimento}
          required
        />

        <div className="flex w-full flex-col gap-1.5">
          <label
            htmlFor="unidadeRendimento"
            className="text-ink-2 text-sm font-semibold"
          >
            Em quê
          </label>
          <select
            id="unidadeRendimento"
            name="unidadeRendimento"
            defaultValue={ficha?.unidadeRendimento ?? "UN"}
            className={ESTILO_SELECT}
          >
            {UNIDADES.map((u) => (
              <option key={u.valor} value={u.valor}>
                {u.rotulo}
              </option>
            ))}
          </select>
        </div>

        {tipo === "PRATO" && podeVerCustos && (
          <Campo
            rotulo="Preço de venda"
            name="precoVenda"
            inputMode="decimal"
            defaultValue={ficha?.precoVenda ?? ""}
            placeholder="55,00"
            erro={estado.erros?.precoVenda}
          />
        )}
      </div>

      <p className="text-ink-3 -mt-2 text-sm">
        {tipo === "PREPARO"
          ? "O rendimento é o que dá preço unitário ao preparo: uma massa que custa R$ 16 e rende 8 discos faz o disco valer R$ 2. Sem ele, o preparo não pode entrar em outra receita."
          : "Um prato normalmente rende 1 unidade — a porção que vai à mesa. Mude só se a ficha for de uma travessa que serve várias."}
      </p>

      <div className="flex w-full flex-col gap-1.5">
        <label
          htmlFor="modoDePreparo"
          className="text-ink-2 text-sm font-semibold"
        >
          Modo de preparo
        </label>
        <textarea
          id="modoDePreparo"
          name="modoDePreparo"
          rows={4}
          defaultValue={ficha?.modoDePreparo ?? ""}
          placeholder="Como se faz, do jeito que você explicaria para alguém no primeiro dia."
          className="border-line-2 bg-surface text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
        />
        <span className="text-ink-3 text-sm">
          Opcional. É o que fica no tablet da cozinha quando alguém novo entra.
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
          {ficha ? "Salvar" : "Criar ficha"}
        </Botao>
        <Link href="/cardapio/fichas">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
