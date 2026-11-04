import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import {
  obterContexto,
  pode,
  type ContextoSessao,
} from "@/core/sessao/contexto";
import { Cartao } from "@/design-system/cartao";
import { LinhasCarregando } from "@/design-system/esqueleto";
import { Vazio } from "@/design-system/vazio";
import { CartaoDoAssistente } from "@/modules/assistente-privado/components/cartao-do-assistente";
import { PERMISSAO_VER_ASSISTENTE_PRIVADO } from "@/modules/assistente-privado/permissoes";
import { cartaoDoAssistente } from "@/modules/assistente-privado/services/registros";

export default async function PaginaOpenClaw() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (
    !pode(contexto, "configuracoes.integracoes") ||
    !pode(contexto, PERMISSAO_VER_ASSISTENTE_PRIVADO)
  )
    notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <Link
          href="/configuracoes#integracoes"
          className="text-accent inline-flex min-h-11 items-center text-sm font-medium"
        >
          Configurações › Integrações
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">OpenClaw</h1>
        <p className="text-ink-3 mt-2 text-sm leading-6">
          Monitor do assistente privado da unidade selecionada. Acompanhe a
          conexão, a última execução, a próxima rotina e as pendências.
        </p>
      </header>

      {!contexto.unidadeAtiva ? (
        <Cartao>
          <Vazio
            icone="engrenagem"
            titulo="Escolha uma unidade para consultar o assistente"
            explicacao="Use o seletor de unidade no menu. Cada loja tem seus próprios registros de conexão e execução."
          />
        </Cartao>
      ) : (
        <Suspense
          fallback={
            <Cartao>
              <LinhasCarregando linhas={4} />
            </Cartao>
          }
        >
          <MonitorDoAssistente contexto={contexto} />
        </Suspense>
      )}

      <p className="text-ink-3 text-sm leading-6">
        O assistente foi preparado para analisar arquivos de vendas autorizados
        e produzir relatórios e rascunhos. Este monitor exibe os registros
        enviados pelo OpenClaw; a atualização da conexão e as rotinas são
        administradas no servidor.
      </p>
    </div>
  );
}

async function MonitorDoAssistente({ contexto }: { contexto: ContextoSessao }) {
  let cartao;
  try {
    cartao = await cartaoDoAssistente(contexto);
  } catch {
    return (
      <Cartao className="p-4">
        <h2 className="font-semibold">Registros indisponíveis</h2>
        <p role="status" className="text-ink-3 mt-2 text-sm">
          Não foi possível consultar o monitor. Recarregue a página para tentar
          novamente.
        </p>
      </Cartao>
    );
  }
  return cartao ? <CartaoDoAssistente cartao={cartao} /> : null;
}
