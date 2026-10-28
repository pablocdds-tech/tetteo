import { redirect } from "next/navigation";
import Link from "next/link";
import { ZodError } from "zod";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Agendamentos } from "@/modules/pdv/components/agendamentos";
import { listarAgendamentos } from "@/modules/pdv/services/agendamentos";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
import { AbasPedidos } from "@/modules/pdv/components/abas-pedidos";
import { estiloDeBotao } from "@/design-system/botao";

export default async function PaginaAgendamentos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!ctx.unidadeAtiva) return null;
  const parametros = await searchParams;
  const filtros = Object.fromEntries(
    ["de", "ate", "estado", "pagina"]
      .filter((chave) => parametros[chave] !== undefined)
      .map((chave) => [chave, parametros[chave]]),
  );
  let inicial;
  try {
    inicial = await listarAgendamentos(ctx, filtros);
  } catch (erro) {
    if (!(erro instanceof ErroPdv) && !(erro instanceof ZodError)) throw erro;
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-2xl font-semibold">Pedidos agendados</h1>
        <p role="alert" className="text-bad">
          {erro instanceof ErroPdv
            ? erro.message
            : "Confira as datas e os filtros do agendamento."}
        </p>
        <Link href="/pdv/agendamentos" className="underline">
          Voltar aos agendados
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pedidos agendados
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {ctx.unidadeAtiva.nome} · horários de São Paulo
          </p>
        </div>
        {pode(ctx, "pdv.vender") && (
          <Link href="/pdv/novo-pedido" className={estiloDeBotao()}>
            + Novo pedido
          </Link>
        )}
      </header>
      <AbasPedidos atual="agendados" />
      <Agendamentos
        key={`${ctx.organizacao.id}:${ctx.unidadeAtiva.id}:${JSON.stringify(filtros)}`}
        inicial={inicial}
        podeVender={pode(ctx, "pdv.vender")}
        podeOperar={pode(ctx, "pdv.operar")}
        podeCancelar={pode(ctx, "pdv.cancelar")}
      />
    </div>
  );
}
