"use client";

import {
  useActionState,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Botao } from "@/design-system/botao";

import type { EstadoCompras } from "../acoes";

/**
 * UM GESTO, UMA AÇÃO.
 *
 * O botão que dispara uma ação do servidor e mostra, logo abaixo, o que ela
 * disse — o erro em frase, ou o "feito". Serve para quase tudo de Compras:
 * avançar rodada, convidar, aprovar, marcar como enviada.
 *
 * Duas coisas que ele garante, e que cada tela escreveria errado sozinha:
 *
 *   UM ENVIO POR VEZ   a trava é um ref, que vale já no segundo clique de um
 *                      duplo clique — antes de o React redesenhar o botão.
 *   ERRO NÃO APAGA     o envio sai pelo onSubmit; com `action`, o React 19
 *                      limpa os campos até quando a ação volta com erro, e o
 *                      motivo que a pessoa escreveu sumiria.
 *
 * Com `pedeMotivo`, o botão abre um campo de motivo antes de enviar —
 * reabrir, cancelar e recusar nunca acontecem sem uma frase.
 */
export function Acao({
  acao,
  campos,
  rotulo,
  peso = "primario",
  tamanho = "medio",
  pedeMotivo,
  confirmar,
  children,
}: {
  acao: (estado: EstadoCompras, dados: FormData) => Promise<EstadoCompras>;
  campos: Record<string, string | number>;
  rotulo: string;
  peso?: "primario" | "secundario" | "fantasma" | "destrutivo";
  tamanho?: "pequeno" | "medio" | "grande";
  /** O rótulo do campo de motivo. Ausente = não pede. */
  pedeMotivo?: string;
  /** Uma frase de confirmação mostrada antes de enviar. */
  confirmar?: string;
  children?: ReactNode;
}) {
  const [estado, despachar, enviando] = useActionState(acao, {});
  const emVoo = useRef(false);
  const [aberto, setAberto] = useState(false);
  const idMotivo = useId();

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current) return;
    if (confirmar && !window.confirm(confirmar)) return;
    emVoo.current = true;
    const dados = new FormData(evento.currentTarget);
    Promise.resolve(despachar(dados)).finally(() => {
      emVoo.current = false;
    });
  }

  const precisaAbrir = !!pedeMotivo && !aberto;

  return (
    <form onSubmit={enviar} className="flex min-w-0 flex-col gap-2">
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={String(valor)} />
      ))}
      {children}
      {pedeMotivo && aberto && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={idMotivo}
            className="text-ink-2 text-sm font-semibold"
          >
            {pedeMotivo}
          </label>
          <textarea
            id={idMotivo}
            name="motivo"
            required
            rows={2}
            maxLength={300}
            className="bg-surface border-line-2 text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {precisaAbrir ? (
          <Botao
            type="button"
            peso={peso}
            tamanho={tamanho}
            onClick={() => setAberto(true)}
          >
            {rotulo}
          </Botao>
        ) : (
          <Botao
            type="submit"
            peso={peso}
            tamanho={tamanho}
            carregando={enviando}
          >
            {rotulo}
          </Botao>
        )}
        {pedeMotivo && aberto && (
          <Botao
            type="button"
            peso="fantasma"
            tamanho={tamanho}
            onClick={() => setAberto(false)}
          >
            Desistir
          </Botao>
        )}
      </div>
      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm leading-5"
        >
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p
          role="status"
          className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm leading-5"
        >
          {estado.ok}
        </p>
      )}
    </form>
  );
}
