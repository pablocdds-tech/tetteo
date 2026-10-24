import type { Metadata } from "next";
import Link from "next/link";
import { linkRecuperacaoValido } from "@/core/auth/recuperacao";
import { MarcaAutenticacao, classeLinkAutenticacao } from "../marca";
import { FormularioRedefinicao } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Nova senha · Tetteo",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function PaginaRedefinicao({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valido =
    typeof token === "string" && (await linkRecuperacaoValido(token));
  return (
    <main className="w-full max-w-sm">
      <MarcaAutenticacao />
      <h1 className="text-xl font-semibold">
        {valido ? "Escolher nova senha" : "Link inválido ou expirado"}
      </h1>
      {valido ? (
        <>
          <p className="text-ink-2 mt-2 text-sm">
            Use pelo menos 12 caracteres. Após salvar, entre novamente nos seus
            dispositivos.
          </p>
          <FormularioRedefinicao token={token!} />
        </>
      ) : (
        <>
          <p className="text-ink-2 mt-2 text-sm">
            Este link expirou, já foi usado ou não é válido. Solicite outro para
            recuperar sua conta.
          </p>
          <Link
            href="/recuperar-senha"
            className={`${classeLinkAutenticacao} mt-5 inline-flex min-h-11 items-center`}
          >
            Solicitar novo link
          </Link>
        </>
      )}
      <Link
        href="/login"
        className={`${classeLinkAutenticacao} mt-5 flex min-h-11 items-center`}
      >
        Voltar para entrar
      </Link>
    </main>
  );
}
