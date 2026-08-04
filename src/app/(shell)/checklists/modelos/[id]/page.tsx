import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { paraCampo } from "@/lib/numero";
import { EditorDeItens } from "@/modules/checklists/components/editor-de-itens";
import { FormularioModelo } from "@/modules/checklists/components/formulario-modelo";
import { obterModelo } from "@/modules/checklists/services/modelos";

export default async function PaginaModelo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.editar")) notFound();

  const { id } = await params;
  const modelo = await obterModelo(contexto, id);
  if (!modelo) notFound();

  const agendado = modelo.rotinas.filter((r) => r.ativo).length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/checklists/modelos"
        className="text-ink-3 hover:text-ink text-sm"
      >
        ← Modelos
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {modelo.nome}
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {modelo.itens.length}{" "}
        {modelo.itens.length === 1 ? "pergunta" : "perguntas"} ·{" "}
        {agendado === 0
          ? "não agendado em nenhuma loja"
          : `agendado em ${agendado} ${agendado === 1 ? "loja" : "lojas"}`}
      </p>

      {/* Editar a redação de um item vale para os PRÓXIMOS checklists. Os já
          respondidos guardam o texto de quando foram respondidos — é o que
          impede o histórico de ser reescrito por uma correção de português. */}
      {modelo.rotinas.length > 0 && (
        <p className="border-line bg-surface-2 text-ink-2 mt-4 rounded-xl border px-4 py-3 text-sm">
          Este checklist já está em uso. O que você mudar aqui vale a partir do
          próximo — os já respondidos guardam as perguntas do dia em que foram
          respondidos.
        </p>
      )}

      <section className="mt-6">
        <FormularioModelo
          modelo={{
            id: modelo.id,
            nome: modelo.nome,
            descricao: modelo.descricao,
          }}
        />
      </section>

      <div className="mt-10">
        <EditorDeItens
          modeloId={modelo.id}
          itens={modelo.itens.map((i) => ({
            id: i.id,
            texto: i.texto,
            secao: i.secao,
            tipo: i.tipo,
            obrigatorio: i.obrigatorio,
            exigeObservacaoSeNao: i.exigeObservacaoSeNao,
            exigeFoto: i.exigeFoto,
            rotuloUnidade: i.rotuloUnidade,
            minimo: i.minimo === null ? null : paraCampo(i.minimo.toString()),
            maximo: i.maximo === null ? null : paraCampo(i.maximo.toString()),
          }))}
        />
      </div>
    </div>
  );
}
