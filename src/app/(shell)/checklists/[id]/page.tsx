import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { paraCampo } from "@/lib/numero";
import { cancelarRespostaAcao } from "@/modules/checklists/acoes";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import {
  FolhaDeChecklist,
  type LinhaDaFolha,
} from "@/modules/checklists/components/folha-de-checklist";
import { ResumoChecklist } from "@/modules/checklists/components/resumo-checklist";
import {
  obterResposta,
  type RespostaCompleta,
} from "@/modules/checklists/services/respostas";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** A faixa aceitável em uma linha só, do jeito que se lê em voz alta. */
function faixaEmTexto(item: RespostaCompleta["itens"][number]) {
  const minimo = item.item.minimo;
  const maximo = item.item.maximo;
  if (minimo === null && maximo === null) return null;

  const unidade = item.item.rotuloUnidade ? ` ${item.item.rotuloUnidade}` : "";
  if (minimo !== null && maximo !== null) {
    return `${paraCampo(minimo.toString())} a ${paraCampo(maximo.toString())}${unidade}`;
  }
  if (minimo !== null) {
    return `a partir de ${paraCampo(minimo.toString())}${unidade}`;
  }
  return `até ${paraCampo(maximo!.toString())}${unidade}`;
}

function paraLinha(item: RespostaCompleta["itens"][number]): LinhaDaFolha {
  return {
    id: item.itemId,
    textoItem: item.textoItem,
    secao: item.secao,
    tipo: item.tipo,
    obrigatorio: item.item.obrigatorio,
    exigeObservacaoSeNao: item.item.exigeObservacaoSeNao,
    exigeFoto: item.item.exigeFoto,
    rotuloUnidade: item.item.rotuloUnidade,
    faixa: faixaEmTexto(item),
    conforme: item.conforme,
    naoSeAplica: item.naoSeAplica,
    // `paraCampo` e não `.toString()`: o Decimal devolve "38.9", e o ponto
    // solto é justamente o que o leitor de número brasileiro estranha.
    valorNumero:
      item.valorNumero === null ? "" : paraCampo(item.valorNumero.toString()),
    valorTexto: item.valorTexto ?? "",
    observacao: item.observacao ?? "",
  };
}

export default async function PaginaResposta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <AvisoUnidade acao="Responder checklist" />
      </div>
    );
  }

  const { id } = await params;
  const resposta = await obterResposta(contexto, id);
  if (!resposta) notFound();

  const linhas = resposta.itens.map(paraLinha);
  const aberta = resposta.status === "ABERTA";
  const podeResponder = aberta && pode(contexto, "checklists.responder");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/checklists"
            className="text-ink-3 hover:text-ink text-sm"
          >
            ← Checklists
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {resposta.modelo.nome}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {data.format(resposta.referencia)} · {contexto.unidadeAtiva.nome}
            {resposta.modelo.descricao ? ` · ${resposta.modelo.descricao}` : ""}
          </p>
        </div>

        {resposta.status === "FECHADA" && (
          <div className="text-right">
            {resposta.pontuacao !== null ? (
              <>
                <span
                  className={`block text-3xl font-semibold tabular-nums ${
                    Number(resposta.pontuacao) >= 90
                      ? "text-ok"
                      : Number(resposta.pontuacao) >= 70
                        ? "text-warn"
                        : "text-bad"
                  }`}
                >
                  {Number(resposta.pontuacao).toLocaleString("pt-BR")}%
                </span>
                <span className="text-ink-3 block text-xs">
                  {resposta.itensConformes} conformes ·{" "}
                  {resposta.itensNaoConformes} não
                </span>
              </>
            ) : (
              <span className="text-ink-3 text-sm">
                Sem nota — só itens de registro
              </span>
            )}
          </div>
        )}
      </div>

      {aberta && (
        <p className="border-line bg-surface-2 text-ink-2 mt-4 rounded-xl border px-4 py-3 text-sm">
          Em andamento. Ao fechar, o checklist congela e cada &quot;não&quot;
          vira uma pendência com dono — depois disso, não dá para editar.
        </p>
      )}

      <div className="mt-6">
        {aberta ? (
          <FolhaDeChecklist
            respostaId={resposta.id}
            linhas={linhas}
            podeResponder={podeResponder}
          />
        ) : (
          <ResumoChecklist linhas={linhas} pendencias={resposta.pendencias} />
        )}
      </div>

      {aberta && pode(contexto, "checklists.responder") && (
        <form action={cancelarRespostaAcao} className="mt-8">
          <input type="hidden" name="respostaId" value={resposta.id} />
          <Botao peso="fantasma" tamanho="pequeno" type="submit">
            Cancelar este checklist
          </Botao>
        </form>
      )}
    </div>
  );
}
