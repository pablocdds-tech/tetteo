import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { FrenteDeCaixa } from "@/modules/pdv/components/frente-de-caixa";
import { listarCarrinhos } from "@/modules/pdv/services/carrinhos";
import { carregarPdv } from "@/modules/pdv/services/pdv";

export default async function PaginaNovoPedidoPdv() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!contexto.unidadeAtiva) return null;
  const [dados, carrinhos] = await Promise.all([
    carregarPdv(contexto),
    pode(contexto, "pdv.vender")
      ? listarCarrinhos(contexto)
      : Promise.resolve([]),
  ]);
  return (
    <FrenteDeCaixa
      key={contexto.unidadeAtiva.id}
      dados={dados}
      unidade={contexto.unidadeAtiva.nome}
      podeVender={pode(contexto, "pdv.vender")}
      podeDesconto={pode(contexto, "pdv.desconto")}
      podeConfigurar={pode(contexto, "pdv.configurar")}
      carrinhos={carrinhos}
    />
  );
}
