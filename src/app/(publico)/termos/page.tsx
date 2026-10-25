import type { Metadata } from "next";
import { ContatoAcesso } from "../contato";

export const metadata: Metadata = {
  title: "Termos de uso · Tetteo",
  description:
    "Condições de acesso ao sistema operacional da Vitaliano Pizzaria.",
};

export default function PaginaTermos() {
  return (
    <article className="text-ink-2 space-y-6 text-base leading-7">
      <div className="space-y-2">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">
          Termos de uso do Tetteo
        </h1>
        <p className="text-ink-3 text-sm">
          Atualizados em 24 de outubro de 2026.
        </p>
      </div>
      <p>
        O Tetteo é uma ferramenta de apoio à operação da Vitaliano Pizzaria.
        Estas condições explicam como o acesso ao sistema é organizado.
      </p>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Cadastro e autorização
        </h2>
        <p>
          A conta identifica uma pessoa. O acesso às lojas e às funções depende
          da autorização do administrador. O cadastro pelo Google, por si só,
          não libera dados nem concede função administrativa.
        </p>
        <p>
          Use uma conta que seja sua, informe dados corretos e mantenha suas
          credenciais em sigilo. As ações devem respeitar as permissões
          concedidas e as orientações da organização.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">Uso da operação</h2>
        <p>
          Consulte ou altere somente informações para as quais você tem
          autorização. Confira os dados antes de confirmar operações que alterem
          estoque, compras ou registros financeiros.
        </p>
        <p>
          As permissões podem ser alteradas ou suspensas pelo administrador. Em
          caso de dificuldade de acesso, use a recuperação de senha ou entre em
          contato com o responsável.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Privacidade e suporte
        </h2>
        <p>
          O tratamento dos dados de cadastro e autenticação está descrito na
          política de privacidade, acessível no rodapé desta página e na tela de
          login.
        </p>
        <ContatoAcesso />
      </section>
    </article>
  );
}
