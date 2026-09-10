import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { paraCampo } from "@/lib/numero";
import { cancelarContagemAcao } from "@/modules/estoque/acoes";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { FolhaDeContagem } from "@/modules/estoque/components/folha-de-contagem";
import { ResumoContagem } from "@/modules/estoque/components/resumo-contagem";
import { obterContagem } from "@/modules/estoque/services/contagens";

// No fuso da OPERAÇÃO. Um servidor em UTC escreveria "fechada às 01:30" para
// uma contagem fechada às 22:30 em São Paulo.
const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <CabecalhoDePagina titulo="Contagem" />
        <AvisoUnidade acao="Contar estoque" />
      </div>
    );
  }

  const { id } = await params;
  const contagem = await obterContagem(contexto, id);
  if (!contagem || contagem.canceladaEm) notFound();

  const aberta = contagem.status === "ABERTA";
  const podeContar = pode(contexto, "estoque.contar");
  const local = contagem.local?.nome ?? null;

  // A folha segue a ordem em que a pessoa anda pela loja: por prateleira
  // (categoria) e, dentro dela, por nome.
  const itens = [...contagem.itens].sort((a, b) => {
    const ca = a.insumo.categoria ?? "";
    const cb = b.insumo.categoria ?? "";
    if (ca !== cb) return ca.localeCompare(cb, "pt-BR");
    return a.insumo.nome.localeCompare(b.insumo.nome, "pt-BR");
  });

  const contextoDaTela = [
    contexto.unidadeAtiva.nome,
    local ?? "loja inteira",
    contagem.categorias.length === 0
      ? "todas as categorias"
      : contagem.categorias.join(", "),
    contagem.descricao ? dataHora.format(contagem.referencia) : null,
    // A palavra que muda o que a pessoa pode esperar da tela.
    aberta ? "rascunho — o saldo ainda não mudou" : "fechada",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoDePagina
        titulo={
          contagem.descricao ||
          `Contagem de ${dataHora.format(contagem.referencia)}`
        }
        contexto={contextoDaTela}
        controles={
          // Vale também depois de fechada: uma contagem fechada por engano, ou
          // com números que não batem com a realidade, ficaria presa na lista
          // para sempre — e pior, continuaria servindo de base para o CMV.
          // Cancelar é explícito, fica na auditoria e não apaga nada.
          podeContar ? (
            <form action={cancelarContagemAcao}>
              <input type="hidden" name="contagemId" value={contagem.id} />
              <Botao peso="fantasma" tamanho="pequeno" type="submit">
                {aberta ? "Cancelar contagem" : "Descartar esta contagem"}
              </Botao>
            </form>
          ) : undefined
        }
      />

      {aberta ? (
        <FolhaDeContagem
          contagemId={contagem.id}
          podeContar={podeContar}
          local={local}
          itens={itens.map((i) => ({
            insumoId: i.insumoId,
            nome: i.insumo.nome,
            categoria: i.insumo.categoria,
            unidadeMedida: i.insumo.unidadeMedida,
            // `paraCampo`, nunca `.toString()`: o Decimal devolveria "3.5" e
            // o ponto solto voltaria do formulário como 35.
            quantidade:
              i.quantidade === null ? null : paraCampo(i.quantidade.toString()),
          }))}
        />
      ) : (
        <ResumoContagem
          podeVerCustos={pode(contexto, "estoque.custos")}
          local={local}
          fechadaEm={
            contagem.fechadaEm ? dataHora.format(contagem.fechadaEm) : null
          }
          itens={itens.map((i) => ({
            insumoId: i.insumoId,
            nome: i.insumo.nome,
            categoria: i.insumo.categoria,
            unidadeMedida: i.insumo.unidadeMedida,
            quantidade: i.quantidade === null ? null : i.quantidade.toString(),
            custoUnitario: i.custoUnitario.toString(),
          }))}
        />
      )}
    </div>
  );
}
