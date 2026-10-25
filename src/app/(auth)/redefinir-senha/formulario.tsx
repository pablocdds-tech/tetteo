"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { classeLinkAutenticacao } from "../marca";
import { redefinirSenhaPeloLink, type EstadoRedefinicao } from "./actions";

export function FormularioRedefinicao({ token }: { token: string }) {
  const [estado, acao, enviando] = useActionState<EstadoRedefinicao, FormData>(
    redefinirSenhaPeloLink.bind(null, token),
    {},
  );
  return (
    <form action={acao} className="mt-6 flex flex-col gap-4">
      <Campo
        className="min-h-11"
        rotulo="Nova senha"
        name="senha"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={72}
        required
        autoFocus
        erro={estado.erroSenha}
        disabled={enviando}
      />
      <Campo
        className="min-h-11"
        rotulo="Repetir nova senha"
        name="confirmacao"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={72}
        required
        erro={estado.erroConfirmacao}
        disabled={enviando}
      />
      {estado.erro && (
        <div
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          <p>{estado.erro}</p>
          <Link
            className={`${classeLinkAutenticacao} mt-2 inline-flex min-h-11 items-center`}
            href="/recuperar-senha"
          >
            Solicitar novo link
          </Link>
        </div>
      )}
      <Botao type="submit" className="min-h-11 w-full" carregando={enviando}>
        {enviando ? "Salvando senha…" : "Salvar nova senha"}
      </Botao>
    </form>
  );
}
