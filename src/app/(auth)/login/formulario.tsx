"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { MarcaAutenticacao, classeLinkAutenticacao } from "../marca";
import { entrar, entrarComGoogle, type EstadoLogin } from "./actions";

function BotaoGoogle({ disponivel }: { disponivel: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Botao
      type="submit"
      peso="secundario"
      className="min-h-11 w-full"
      carregando={pending}
      disabled={!disponivel}
      aria-describedby={!disponivel ? "google-pendente" : undefined}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5 shrink-0"
        fill="currentColor"
      >
        <path d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.4ZM12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.6A10 10 0 0 0 12 22ZM6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6ZM12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6C7.2 7.7 9.4 5.9 12 5.9Z" />
      </svg>
      {pending ? "Abrindo Google…" : "Continuar com Google"}
    </Botao>
  );
}

export function FormularioLogin({
  googleDisponivel,
  erroGoogle,
  senhaRedefinida,
}: {
  googleDisponivel: boolean;
  erroGoogle: boolean;
  senhaRedefinida: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(
    entrar,
    {},
  );
  return (
    <main className="w-full max-w-sm">
      <MarcaAutenticacao />
      <h1 className="text-xl font-semibold">Entrar</h1>
      <p className="text-ink-2 mt-1 text-sm">
        Sistema operacional da Vitaliano Pizzaria.
      </p>
      {senhaRedefinida && (
        <p
          role="status"
          className="bg-ok-sub text-ok mt-5 rounded-md px-3 py-2 text-sm"
        >
          Senha alterada. Entre com sua nova senha.
        </p>
      )}
      {erroGoogle && (
        <p
          role="alert"
          className="bg-bad-sub text-bad mt-5 rounded-md px-3 py-2 text-sm"
        >
          Não foi possível entrar com Google. Tente novamente ou use e-mail e
          senha. Se sua conta estiver suspensa, fale com o administrador.
        </p>
      )}
      <form action={acao} className="mt-6 flex flex-col gap-4">
        <Campo
          className="min-h-11"
          rotulo="E-mail"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="voce@exemplo.com"
          maxLength={254}
          required
          autoFocus
          disabled={enviando}
        />
        <Campo
          className="min-h-11"
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          required
          disabled={enviando}
        />
        <Link
          href="/recuperar-senha"
          className={`${classeLinkAutenticacao} -mt-1 inline-flex min-h-11 items-center self-end`}
        >
          Esqueci minha senha
        </Link>
        {estado.erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
          >
            {estado.erro}
          </p>
        )}
        <Botao type="submit" carregando={enviando} className="min-h-11 w-full">
          {enviando ? "Entrando…" : "Entrar"}
        </Botao>
      </form>
      <div className="text-ink-3 my-5 flex items-center gap-3 text-sm">
        <span className="bg-line h-px flex-1" />
        <span>ou</span>
        <span className="bg-line h-px flex-1" />
      </div>
      <form action={entrarComGoogle}>
        <BotaoGoogle disponivel={googleDisponivel} />
      </form>
      <p className="text-ink-2 mt-3 text-sm">
        Primeiro acesso? Use o Google para criar sua conta. O administrador
        libera o acesso às lojas.
      </p>
      {!googleDisponivel && (
        <p id="google-pendente" className="text-ink-3 mt-2 text-sm">
          O cadastro com Google ainda está em configuração. Por enquanto, peça
          seu cadastro ao administrador.
        </p>
      )}
      <nav
        aria-label="Informações do acesso"
        className="mt-6 flex flex-wrap gap-x-5 gap-y-2"
      >
        <Link
          href="/sobre"
          className={`${classeLinkAutenticacao} inline-flex min-h-11 items-center`}
        >
          Sobre o Tetteo
        </Link>
        <Link
          href="/privacidade"
          className={`${classeLinkAutenticacao} inline-flex min-h-11 items-center`}
        >
          Privacidade
        </Link>
        <Link
          href="/termos"
          className={`${classeLinkAutenticacao} inline-flex min-h-11 items-center`}
        >
          Termos de uso
        </Link>
      </nav>
    </main>
  );
}
