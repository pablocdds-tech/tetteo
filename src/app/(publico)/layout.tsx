import Link from "next/link";
import { classeLinkAutenticacao, MarcaAutenticacao } from "../(auth)/marca";

export const dynamic = "force-dynamic";

export default function LayoutPublico({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10 sm:py-14">
      <header>
        <MarcaAutenticacao />
      </header>
      <main>{children}</main>
      <footer className="border-line text-ink-2 mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t pt-5 text-sm">
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
        <Link
          href="/login"
          className={`${classeLinkAutenticacao} inline-flex min-h-11 items-center`}
        >
          Entrar
        </Link>
      </footer>
    </div>
  );
}
