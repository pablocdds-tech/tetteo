import type { Metadata } from "next";
import Link from "next/link";
import { estiloDeBotao } from "@/design-system/botao";
import { ContatoAcesso } from "../contato";

export const metadata: Metadata = {
  title: "Sobre o Tetteo",
  description:
    "Conheça o sistema de operação da Vitaliano Pizzaria e as opções de acesso.",
};

export default function PaginaSobre() {
  return (
    <article className="text-ink-2 space-y-6 text-base leading-7">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">
        A operação da pizzaria em um só lugar
      </h1>
      <p>
        O Tetteo é o sistema operacional da Vitaliano Pizzaria. Ele reúne
        ferramentas para cardápio, estoque, compras, checklists e financeiro,
        com acesso organizado por loja e função.
      </p>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Uma conta, acesso autorizado
        </h2>
        <p>
          Quem já tem cadastro pode entrar com e-mail e senha. O login com
          Google usa nome, e-mail e a confirmação da sua identidade. Ele não
          solicita acesso ao Gmail nem ao Google Drive.
        </p>
        <p>
          Criar uma conta não libera os dados da pizzaria. Um administrador
          precisa conceder o acesso às lojas e definir as permissões.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">Recuperar o acesso</h2>
        <p>
          A opção “Esqueci minha senha” permite solicitar um link por e-mail
          quando o envio estiver configurado. O link expira em 30 minutos e
          funciona uma única vez. O administrador também pode redefinir a senha.
        </p>
      </section>
      <ContatoAcesso />
      <Link href="/login" className={`${estiloDeBotao()} min-h-11`}>
        Entrar no Tetteo
      </Link>
    </article>
  );
}
