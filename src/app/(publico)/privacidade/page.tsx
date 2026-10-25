import type { Metadata } from "next";
import { ContatoAcesso } from "../contato";

export const metadata: Metadata = {
  title: "Privacidade · Tetteo",
  description:
    "Como o Tetteo usa os dados de cadastro, autenticação e recuperação de acesso.",
};

export default function PaginaPrivacidade() {
  return (
    <article className="text-ink-2 space-y-6 text-base leading-7">
      <div className="space-y-2">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">
          Política de privacidade do acesso
        </h1>
        <p className="text-ink-3 text-sm">
          Atualizada em 24 de outubro de 2026.
        </p>
      </div>
      <p>
        Esta política explica o uso de dados no cadastro, no login e na
        recuperação de acesso ao Tetteo, sistema da Vitaliano Pizzaria.
      </p>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Dados usados para identificar sua conta
        </h2>
        <p>
          O Tetteo armazena nome, e-mail, situação da conta e informações de
          acesso às lojas. Quando você usa o Google, recebe a confirmação do
          e-mail e um identificador da sua conta Google para reconhecer seus
          próximos acessos.
        </p>
        <p>
          O Google pode fornecer dados básicos do perfil, como a foto. A
          integração atual usa nome, e-mail e identificador para autenticar e
          cadastrar a conta. Sua senha Google não é recebida pelo Tetteo, e o
          login não solicita leitura de Gmail, Drive, contatos ou calendário.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Finalidades e armazenamento
        </h2>
        <p>
          Esses dados servem para identificar quem está entrando, manter a
          sessão, aplicar as permissões e permitir a recuperação da conta. Os
          dados de cadastro e acesso ficam no banco de dados do servidor do
          Tetteo.
        </p>
        <p>
          A senha do Tetteo é armazenada por hash, e não como texto legível. A
          sessão usa um cookie de autenticação. Criar uma conta pelo Google não
          concede acesso automático às lojas ou aos registros da operação.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Recuperação e fornecedores
        </h2>
        <p>
          Se você pedir a recuperação, o Tetteo usa seu endereço de e-mail para
          enviar um link temporário. Quando configurado, o Resend processa o
          destinatário e o conteúdo desse e-mail para fazer a entrega.
        </p>
        <p>
          O link expira em 30 minutos, é de uso único e seu segredo fica
          armazenado no banco apenas por hash. Ao redefinir a senha, os acessos
          anteriores são invalidados.
        </p>
        <p>
          O Google processa a autenticação quando você escolhe essa opção. O uso
          de cada serviço também está sujeito às políticas de privacidade do
          respectivo fornecedor.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-ink text-xl font-semibold">
          Solicitações e contato
        </h2>
        <p>
          Você pode solicitar informações, correção ou exclusão dos dados da sua
          conta. O responsável verifica a identidade de quem solicita e avalia
          os registros envolvidos, inclusive os vínculos com a operação e o
          histórico de auditoria.
        </p>
        <ContatoAcesso />
      </section>
    </article>
  );
}
