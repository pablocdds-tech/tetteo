import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { paraCampo } from "@/lib/numero";
import { cancelarContagemAcao } from "@/modules/estoque/acoes";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FolhaDeContagem } from "@/modules/estoque/components/folha-de-contagem";
import { ResumoContagem } from "@/modules/estoque/components/resumo-contagem";
import { obterContagem } from "@/modules/estoque/services/contagens";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function PaginaContagem({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Contagem</h1>
        <div className="mt-6">
          <AvisoUnidade acao="Contar estoque" />
        </div>
      </div>
    );
  }

  const { id } = await params;
  const contagem = await obterContagem(contexto, id);
  if (!contagem || contagem.canceladaEm) notFound();

  const aberta = contagem.status === "ABERTA";
  const podeContar = pode(contexto, "estoque.contar");

  // A folha segue a ordem em que a pessoa anda pela loja: por prateleira
  // (categoria) e, dentro dela, por nome.
  const itens = [...contagem.itens].sort((a, b) => {
    const ca = a.insumo.categoria ?? "";
    const cb = b.insumo.categoria ?? "";
    if (ca !== cb) return ca.localeCompare(cb, "pt-BR");
    return a.insumo.nome.localeCompare(b.insumo.nome, "pt-BR");
  });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/estoque/contagens"
            className="text-ink-3 hover:text-ink text-sm"
          >
            ← Contagens
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {contagem.descricao || dataHora.format(contagem.referencia)}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {contexto.unidadeAtiva.nome} ·{" "}
            {contagem.descricao
              ? dataHora.format(contagem.referencia)
              : contagem.categorias.length === 0
                ? "Contagem cheia"
                : contagem.categorias.join(", ")}
            {!aberta && contagem.fechadaEm && (
              <> · fechada em {dataHora.format(contagem.fechadaEm)}</>
            )}
          </p>
        </div>

        {/* Vale também depois de fechada: uma contagem fechada por engano, ou
            com números que não batem com a realidade, ficaria presa na lista
            para sempre — e pior, continuaria servindo de base para o CMV.
            Cancelar é explícito, fica na auditoria e não apaga nada. */}
        {podeContar && (
          <form action={cancelarContagemAcao}>
            <input type="hidden" name="contagemId" value={contagem.id} />
            <Botao peso="fantasma" tamanho="pequeno" type="submit">
              {aberta ? "Cancelar contagem" : "Descartar esta contagem"}
            </Botao>
          </form>
        )}
      </div>

      <div className="mt-6">
        {aberta ? (
          <FolhaDeContagem
            contagemId={contagem.id}
            podeContar={podeContar}
            itens={itens.map((i) => ({
              insumoId: i.insumoId,
              nome: i.insumo.nome,
              categoria: i.insumo.categoria,
              unidadeMedida: i.insumo.unidadeMedida,
              // `paraCampo`, nunca `.toString()`: o Decimal devolveria "3.5" e
              // o ponto solto voltaria do formulário como 35.
              quantidade:
                i.quantidade === null
                  ? null
                  : paraCampo(i.quantidade.toString()),
            }))}
          />
        ) : (
          <ResumoContagem
            podeVerCustos={pode(contexto, "estoque.custos")}
            itens={itens.map((i) => ({
              insumoId: i.insumoId,
              nome: i.insumo.nome,
              categoria: i.insumo.categoria,
              unidadeMedida: i.insumo.unidadeMedida,
              quantidade:
                i.quantidade === null ? null : i.quantidade.toString(),
              custoUnitario: i.custoUnitario.toString(),
            }))}
          />
        )}
      </div>
    </div>
  );
}
