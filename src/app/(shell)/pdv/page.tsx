import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { GestaoPedidos } from "@/modules/pdv/components/gestao-pedidos";
import { listarPedidos } from "@/modules/pdv/services/pedidos";
import {
  esquemaListaPedidos,
  periodoPedidos,
} from "@/modules/pdv/schemas/pedido";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
import { listarEntregadores } from "@/modules/pdv/services/entregas";

export default async function PaginaGestaoPedidos({
  searchParams,
}: {
  searchParams: Promise<{
    dia?: string | string[];
    novaVenda?: string | string[];
    visao?: string | string[];
  }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!contexto.unidadeAtiva) return null;
  const consulta = await searchParams;
  if (
    Array.isArray(consulta.dia) ||
    Array.isArray(consulta.novaVenda) ||
    Array.isArray(consulta.visao)
  )
    notFound();
  if (
    !esquemaListaPedidos.safeParse({ dia: consulta.dia, visao: consulta.visao })
      .success ||
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
  const [quadro, entregadores] = await Promise.all([
    listarPedidos(contexto, { dia: consulta.dia, visao: consulta.visao }),
    pode(contexto, "pdv.entrega")
      ? listarEntregadores(contexto)
      : Promise.resolve([]),
  ]);
  return (
    <GestaoPedidos
      key={`${contexto.unidadeAtiva.id}:${quadro.dia}:${quadro.visao}`}
      inicial={quadro}
      unidade={contexto.unidadeAtiva.nome}
      preferenciasId={`${contexto.usuario.id}:${contexto.unidadeAtiva.id}`}
      podeVender={pode(contexto, "pdv.vender")}
      podeOperar={pode(contexto, "pdv.operar")}
      podeCancelar={pode(contexto, "pdv.cancelar")}
      podeEntrega={pode(contexto, "pdv.entrega")}
      entregadores={entregadores
        .filter((e) => e.ativo)
        .map((e) => ({ id: e.id, nome: e.nome }))}
      novaVenda={consulta.novaVenda}
      instante={new Date().toISOString()}
    />
  );
}
