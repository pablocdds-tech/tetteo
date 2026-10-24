"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { MarcaAutenticacao, classeLinkAutenticacao } from "../marca";
import { recuperarSenha, type EstadoRecuperacao } from "./actions";

export function FormularioRecuperacao({ disponivel }: { disponivel: boolean }) {
  const [estado, acao, enviando] = useActionState<EstadoRecuperacao, FormData>(
    recuperarSenha,
    {},
  );
  return (
    <main className="w-full max-w-sm">
      <MarcaAutenticacao />
      <h1 className="text-xl font-semibold">Recuperar senha</h1>
      <p className="text-ink-2 mt-2 text-sm">
        Informe o e-mail da sua conta para receber um link e escolher uma nova
        senha.
      </p>
      {!disponivel ? (
        <p
          role="status"
          className="bg-warn-sub text-warn mt-6 rounded-md px-3 py-3 text-sm"
        >
          O envio de e-mail ainda está em configuração. Peça ao administrador
          para redefinir sua senha em Configurações → Pessoas.
        </p>
      ) : estado.mensagem ? (
        <p
          role="status"
          className="bg-ok-sub text-ok mt-6 rounded-md px-3 py-3 text-sm"
        >
          {estado.mensagem}
        </p>
      ) : (
        <form action={acao} className="mt-6 flex flex-col gap-4">
          <Campo
            className="min-h-11"
            rotulo="E-mail"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            maxLength={254}
            defaultValue={estado.email}
            required
            autoFocus
            disabled={enviando}
          />
          {estado.erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
            >
              {estado.erro}
            </p>
          )}
          <Botao
            type="submit"
            carregando={enviando}
            className="min-h-11 w-full"
          >
            {enviando ? "Solicitando link…" : "Enviar link de recuperação"}
          </Botao>
          <p className="text-ink-3 text-sm">
            O link expira em 30 minutos e funciona uma única vez.
          </p>
        </form>
      )}
      <Link
        href="/login"
        className={`${classeLinkAutenticacao} mt-6 inline-flex min-h-11 items-center`}
      >
        Voltar para entrar
      </Link>
    </main>
  );
}
