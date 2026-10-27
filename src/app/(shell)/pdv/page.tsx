import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { GestaoPedidos } from "@/modules/pdv/components/gestao-pedidos";
import { listarPedidos } from "@/modules/pdv/services/pedidos";
import {
  esquemaListaPedidos,
  periodoPedidos,
} from "@/modules/pdv/schemas/pedido";
import { ErroPdv } from "@/modules/pdv/schemas/erro";

export default async function PaginaGestaoPedidos({
  searchParams,
}: {
  searchParams: Promise<{
    dia?: string | string[];
    novaVenda?: string | string[];
  }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!contexto.unidadeAtiva) return null;
  const consulta = await searchParams;
  if (Array.isArray(consulta.dia) || Array.isArray(consulta.novaVenda))
    notFound();
  if (
    !esquemaListaPedidos.safeParse({ dia: consulta.dia }).success ||
    (consulta.novaVenda?.length ?? 0) > 100
  )
    notFound();
  if (consulta.dia) {
    try {
      periodoPedidos(consulta.dia);
    } catch (erro) {
      if (erro instanceof ErroPdv) notFound();
      throw erro;
    }
  }
  const quadro = await listarPedidos(contexto, { dia: consulta.dia });
  return (
    <GestaoPedidos
      key={`${contexto.unidadeAtiva.id}:${quadro.dia}`}
      inicial={quadro}
      unidade={contexto.unidadeAtiva.nome}
      podeVender={pode(contexto, "pdv.vender")}
      podeOperar={pode(contexto, "pdv.operar")}
      podeCancelar={pode(contexto, "pdv.cancelar")}
      novaVenda={consulta.novaVenda}
      instante={new Date().toISOString()}
    />
  );
}
