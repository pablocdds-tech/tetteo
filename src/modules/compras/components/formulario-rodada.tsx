"use client";

import Link from "next/link";
import { useActionState, useId, useRef, type FormEvent } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Cartao } from "@/design-system/cartao";

import { criarRodadaAcao, type EstadoCompras } from "../acoes";

/**
 * NOVA RODADA — lojas, prazos, janela de entrega.
 *
 * Os prazos já vêm sugeridos (amanhã às 10h para a lista das lojas, depois de
 * amanhã para os fornecedores, entrega em três a quatro dias). Sugerido, não
 * imposto: a pessoa muda. E o erro nunca apaga o que foi digitado — o envio
 * sai pelo onSubmit.
 */
export function FormularioRodada({
  lojas,
  sugestao,
}: {
  lojas: { id: string; nome: string }[];
  sugestao: {
    prazoRequisicao: string;
    prazoCotacao: string;
    entregaDe: string;
    entregaAte: string;
    nome: string;
  };
}) {
  const [estado, despachar, enviando] = useActionState<EstadoCompras, FormData>(
    criarRodadaAcao,
    {},
  );
  const emVoo = useRef(false);
  const idLojas = useId();

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (emVoo.current) return;
    emVoo.current = true;
    const dados = new FormData(e.currentTarget);
    Promise.resolve(despachar(dados)).finally(() => {
      emVoo.current = false;
    });
  }

  return (
    <Cartao className="max-w-[720px] p-5">
      <form onSubmit={enviar} className="flex flex-col gap-5">
        <Campo
          rotulo="Nome da rodada"
          name="descricao"
          defaultValue={sugestao.nome}
          required
          maxLength={120}
          erro={estado.erros?.descricao}
          ajuda="Como vocês chamam: Semana 37, Compra do mês, Hortifrúti de sexta."
        />

        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={`${idLojas}-ajuda`}
        >
          <legend className="text-ink-2 text-sm font-semibold">
            Lojas que participam
          </legend>
          <div className="flex flex-wrap gap-2">
            {lojas.map((l) => (
              <label
                key={l.id}
                className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  name="unidadeIds"
                  value={l.id}
                  defaultChecked
                  className="size-4"
                />
                {l.nome}
              </label>
            ))}
          </div>
          <span id={`${idLojas}-ajuda`} className="text-ink-3 text-sm">
            Cada loja recebe uma requisição para preencher.
          </span>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="As lojas mandam a lista até"
            name="prazoRequisicao"
            type="datetime-local"
            defaultValue={sugestao.prazoRequisicao}
          />
          <Campo
            rotulo="Os fornecedores respondem até"
            name="prazoCotacao"
            type="datetime-local"
            defaultValue={sugestao.prazoCotacao}
            ajuda="O link de cada fornecedor vence neste horário."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Entrega a partir de"
            name="entregaDe"
            type="date"
            defaultValue={sugestao.entregaDe}
          />
          <Campo
            rotulo="Entrega até"
            name="entregaAte"
            type="date"
            defaultValue={sugestao.entregaAte}
          />
        </div>

        <Campo
          rotulo="Observação"
          name="observacao"
          maxLength={300}
          placeholder="Opcional"
        />

        {estado.erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
          >
            {estado.erro}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Botao type="submit" carregando={enviando}>
            Abrir rodada
          </Botao>
          <Link href="/compras" className={estiloDeBotao("fantasma", "medio")}>
            Cancelar
          </Link>
        </div>
        <p className="text-ink-3 text-sm">
          A rodada nasce em rascunho. Nada vai para as lojas até você abrir a
          coleta.
        </p>
      </form>
    </Cartao>
  );
}
