import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { PreparacaoPdv } from "@/modules/pdv/components/preparacao-pdv";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
import { obterPreparacaoPdv } from "@/modules/pdv/services/preparacao";

export default async function PaginaPreparacaoPdv({
  searchParams,
}: {
  searchParams: Promise<{ local?: string | string[] }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "pdv.ver") || !pode(contexto, "pdv.configurar"))
    notFound();
  if (!contexto.unidadeAtiva) return null;

  const consulta = await searchParams;
  if (Array.isArray(consulta.local)) notFound();
  let dados;
  try {
    dados = await obterPreparacaoPdv(contexto, consulta.local);
  } catch (erro) {
    if (!(erro instanceof ErroPdv)) throw erro;
    return (
      <div className="border-line bg-surface mx-auto max-w-3xl rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Preparação do PDV</h1>
        <p role="alert" className="text-ink-2 mt-3 text-sm">
          {erro.message}
        </p>
        <Link
          href="/pdv/preparacao"
          className={`${estiloDeBotao("secundario")} mt-5`}
        >
          Voltar à preparação
        </Link>
      </div>
    );
  }

  return (
    <PreparacaoPdv
      key={`${dados.unidadeId}:${dados.localId ?? "sem-local"}`}
      dados={dados}
      permissoes={[
        { nome: "Vender", concedida: pode(contexto, "pdv.vender") },
        {
          nome: "Avançar pedidos na cozinha, coleta e entrega",
          concedida: pode(contexto, "pdv.operar"),
        },
        {
          nome: "Abrir, movimentar e fechar caixa",
          concedida: pode(contexto, "pdv.caixa"),
        },
        {
          nome: "Conceder desconto",
          concedida: pode(contexto, "pdv.desconto"),
        },
        { nome: "Cancelar vendas", concedida: pode(contexto, "pdv.cancelar") },
        {
          nome: "Configurar o catálogo do PDV",
          concedida: pode(contexto, "pdv.configurar"),
        },
      ]}
    />
  );
}
