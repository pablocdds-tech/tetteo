import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { ChaveGeral } from "@/modules/assistente/components/chave-geral";
import { ListaDeConversas } from "@/modules/assistente/components/lista-de-conversas";
import { listarConversas } from "@/modules/assistente/services/conversas";
import { obterInstancia } from "@/modules/assistente/services/vinculos";

/** A rota só delega: quem sabe o que é uma conversa é o App. */
export default async function PaginaConversas() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const [conversas, instancia] = await Promise.all([
    listarConversas(contexto),
    obterInstancia(contexto),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Severina</h1>
        <p className="text-ink-3 mt-1 text-sm">
          O que ela falou, para quem, e o que não conseguiu entregar
        </p>
      </div>

      {/* A chave geral vem antes do conteúdo: quem precisa dela está com
          pressa, e procurar em configurações custaria minutos. */}
      <div className="mt-6">
        <ChaveGeral
          instancia={instancia}
          podeConfigurar={pode(contexto, "assistente.conectar")}
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Conversas</h2>
        <ListaDeConversas conversas={conversas} />
      </section>
    </div>
  );
}
