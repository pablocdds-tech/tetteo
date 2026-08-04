"use client";

import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { entrar, type EstadoLogin } from "./actions";

export default function PaginaLogin() {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(
    entrar,
    {},
  );

  return (
    <main className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-3">
        <span className="bg-accent text-accent-ink grid size-9 place-items-center rounded-md text-lg font-bold">
          T
        </span>
        <span className="text-2xl font-semibold tracking-tight">Tetteo</span>
      </div>

      <h1 className="text-xl font-semibold">Entrar</h1>
      <p className="text-ink-2 mt-1 text-sm">
        Sistema operacional da Vitaliano Pizzaria.
      </p>

      <form action={acao} className="mt-6 flex flex-col gap-4">
        <Campo
          rotulo="E-mail"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="voce@exemplo.com"
          required
          autoFocus
        />

        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
        />

        {estado.erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
          >
            {estado.erro}
          </p>
        )}

        <Botao type="submit" carregando={enviando} className="mt-2 w-full">
          {enviando ? "Entrando…" : "Entrar"}
        </Botao>
      </form>
    </main>
  );
}
