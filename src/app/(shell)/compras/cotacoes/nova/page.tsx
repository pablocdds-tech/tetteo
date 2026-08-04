"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { criarCotacaoAcao, type EstadoCompras } from "@/modules/compras/acoes";

export default function PaginaNovaCotacao() {
  const [estado, acao, enviando] = useActionState<EstadoCompras, FormData>(
    criarCotacaoAcao,
    {},
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href="/compras/cotacoes"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Cotações
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Nova cotação
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        Dê um nome. A lista e os fornecedores vêm na tela seguinte.
      </p>

      <form action={acao} className="mt-6 flex max-w-[480px] flex-col gap-4">
        <Campo
          rotulo="Nome"
          name="descricao"
          placeholder="Ex.: Semana 32 — hortifrúti"
          erro={estado.erros?.descricao}
          required
          autoFocus
        />

        <Campo
          rotulo="Preços valem até"
          name="validaAte"
          type="date"
          erro={estado.erros?.validaAte}
          ajuda="Opcional. Hortifrúti vence em dias; descartável dura o mês."
        />

        <Campo
          rotulo="Observação"
          name="observacao"
          placeholder="Ex.: pedir entrega para quinta"
          erro={estado.erros?.observacao}
        />

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
            Criar cotação
          </Botao>
          <Link href="/compras/cotacoes">
            <Botao type="button" peso="fantasma">
              Cancelar
            </Botao>
          </Link>
        </div>
      </form>
    </div>
  );
}
