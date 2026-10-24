import { redirect } from "next/navigation";
import { auth, signOut } from "@/core/auth";
import { obterContexto } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { MarcaAutenticacao } from "../marca";

export const dynamic = "force-dynamic";

export default async function PaginaConta() {
  const sessao = await auth();
  if (!sessao?.user) redirect("/login");
  if (await obterContexto()) redirect("/");
  return (
    <main className="w-full max-w-sm">
      <MarcaAutenticacao />
      <h1 className="text-xl font-semibold">Sua conta está pronta</h1>
      <p className="text-ink-2 mt-3 text-sm">
        Você entrou como{" "}
        <strong className="text-ink break-all">{sessao.user.email}</strong>.
      </p>
      <p className="text-ink-2 mt-3 text-sm">
        Peça ao administrador da sua loja para liberar o acesso em Configurações
        → Equipe usando este mesmo e-mail.
      </p>
      <p className="text-ink-3 mt-3 text-sm">
        Assim que o acesso for liberado, entre novamente para abrir o painel.
      </p>
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <Botao type="submit" peso="secundario" className="min-h-11 w-full">
          Sair ou usar outra conta
        </Botao>
      </form>
    </main>
  );
}
