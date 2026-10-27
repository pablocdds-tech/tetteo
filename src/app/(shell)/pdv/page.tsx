import { redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { FrenteDeCaixa } from "@/modules/pdv/components/frente-de-caixa";
import { carregarPdv } from "@/modules/pdv/services/pdv";

export default async function PaginaPdv() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!contexto.unidadeAtiva) return null;
  const dados = await carregarPdv(contexto);
  return (
    <FrenteDeCaixa
      key={contexto.unidadeAtiva.id}
      dados={dados}
      unidade={contexto.unidadeAtiva.nome}
      podeVender={pode(contexto, "pdv.vender")}
      podeDesconto={pode(contexto, "pdv.desconto")}
    />
  );
}
