import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { agoraParaCampo } from "@/lib/data";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FormularioNovaContagem } from "@/modules/estoque/components/formulario-nova-contagem";
import { categoriasDeInsumos } from "@/modules/estoque/services/contagens";
import { listarLocais } from "@/modules/estoque/services/rotinas";

export default async function PaginaNovaContagem() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "estoque.contar")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <CabecalhoDePagina titulo="Nova contagem" />
        <AvisoUnidade acao="Contar estoque" />
      </div>
    );
  }

  const [categorias, locais] = await Promise.all([
    categoriasDeInsumos(contexto),
    listarLocais(contexto),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* O que a pessoa precisa saber antes de abrir: nada muda no estoque
          enquanto a contagem estiver aberta. É um rascunho até ser fechada. */}
      <CabecalhoDePagina
        titulo="Nova contagem"
        contexto={`${contexto.unidadeAtiva.nome} · abre como rascunho — o saldo só muda quando ela for fechada`}
      />

      <div>
        <FormularioNovaContagem
          categorias={categorias}
          locais={locais}
          agora={agoraParaCampo()}
        />
      </div>
    </div>
  );
}
