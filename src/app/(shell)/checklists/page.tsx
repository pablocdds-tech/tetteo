import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { estiloDeBotao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";
import { Vazio } from "@/design-system/vazio";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import { DetalheDaRotina } from "@/modules/checklists/components/detalhe-da-rotina";
import { PainelDeRotinas } from "@/modules/checklists/components/painel-de-rotinas";
import { contarPendenciasAbertas } from "@/modules/checklists/services/pendencias";
import {
  ehPeriodo,
  listarRotinas,
} from "@/modules/checklists/services/rotinas";

/**
 * A TELA DO DIA — lista à esquerda, atividade à direita.
 *
 * Substituiu uma lista de largura inteira em que responder um checklist
 * significava NAVEGAR para outra página: a fila de trabalho sumia, e voltar
 * para ela custava um clique e a perda do lugar. Numa cozinha às 7h, com três
 * rotinas para fechar, isso é a diferença entre conferir tudo e conferir o
 * que deu.
 *
 * O QUE FICA NO ENDEREÇO, E POR QUÊ. Duas coisas, e as duas pelo mesmo
 * motivo: elas trocam o CONJUNTO de dados que o servidor busca.
 *
 *   ?periodo=hoje|semana   qual fila
 *   ?rotina=<id>           qual atividade está aberta à direita
 *
 * Estando na URL, o botão Voltar do navegador desfaz a seleção, o link colado
 * no grupo do WhatsApp abre exatamente a mesma tela, e recarregar não perde
 * nada. A BUSCA não está aqui de propósito — ela só esconde parte do que já
 * veio, e mandá-la ao servidor faria uma requisição por tecla digitada.
 */
export default async function PaginaChecklists({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; rotina?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.ver")) notFound();

  const podeResponder = pode(contexto, "checklists.responder");
  const podeEditar = pode(contexto, "checklists.editar");

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-[var(--width-data)]">
        <CabecalhoDePagina
          titulo="Checklists"
          contexto="O que precisa ser feito hoje"
        />
        <div className="mt-6">
          <AvisoUnidade acao="Responder checklist" />
        </div>
      </div>
    );
  }

  const { periodo: pedido, rotina: rotinaPedida } = await searchParams;
  const periodo = ehPeriodo(pedido) ? pedido : "hoje";

  const [rotinas, pendencias] = await Promise.all([
    listarRotinas(contexto, periodo),
    contarPendenciasAbertas(contexto),
  ]);

  // A seleção pode apontar para uma rotina que não está NESTE período — é o
  // que acontece ao trocar de "Semana" para "Hoje" com algo aberto à direita.
  // A tela não engole a seleção em silêncio: ela diz o que houve e oferece o
  // caminho de volta.
  const selecionada = rotinaPedida
    ? (rotinas.find((r) => r.id === rotinaPedida) ?? null)
    : null;
  const foraDoPeriodo = Boolean(rotinaPedida) && selecionada === null;

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Checklists"
        contexto={`O que precisa ser feito · ${contexto.unidadeAtiva.nome}`}
        acao={
          // No celular, com um detalhe aberto, a ação principal é "Concluir",
          // lá na folha. Dois botões secundários acima dela competiriam com
          // ela e empurrariam a folha para baixo — por isso saem de cena e
          // voltam junto com a lista.
          podeResponder && (
            <div
              className={`flex-wrap items-center gap-2 ${
                rotinaPedida ? "desk:flex hidden" : "flex"
              }`}
            >
              <Link
                href="/checklists/nova"
                className={estiloDeBotao("secundario")}
              >
                Checklist avulso
              </Link>
              {podeEditar && (
                <Link
                  href="/checklists/rotinas/nova"
                  className={estiloDeBotao("secundario")}
                >
                  Agendar rotina
                </Link>
              )}
            </div>
          )
        }
      />

      {/* A pendência é o que sobra do checklist de ontem. Ela aparece ANTES da
          fila de hoje, senão vira uma tela que ninguém abre — e o módulo
          inteiro volta a ser ritual. */}
      {/* No celular, com uma rotina aberta, a faixa sai do caminho: ali o
          detalhe é uma página própria, e 90px de aviso acima da folha
          empurrariam o primeiro item para fora da tela. Ela volta junto com
          a lista. */}
      {pendencias > 0 && (
        <Link
          href="/checklists/pendencias"
          className={`border-warn/30 bg-warn-sub hover:border-warn focus-visible:outline-accent items-center gap-3 rounded-lg border px-4 py-3 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 ${
            selecionada ? "desk:flex hidden" : "flex"
          }`}
        >
          <span aria-hidden="true" className="text-warn flex-none">
            <Icone nome="alerta" tamanho={18} />
          </span>
          <span className="min-w-0 flex-1 text-base">
            <span className="text-warn block font-semibold">
              {pendencias}{" "}
              {pendencias === 1
                ? "pendência esperando conserto"
                : "pendências esperando conserto"}
            </span>
            <span className="text-ink-2 block text-sm">
              Apontado num checklist e ainda não resolvido.
            </span>
          </span>
          <Icone
            nome="seta-direita"
            tamanho={16}
            className="text-ink-2 flex-none"
          />
        </Link>
      )}

      <PainelDeRotinas
        rotinas={rotinas}
        periodo={periodo}
        selecionada={selecionada?.id ?? null}
        detalheAberto={Boolean(rotinaPedida)}
      >
        {selecionada ? (
          <DetalheDaRotina
            contexto={contexto}
            rotina={selecionada}
            periodo={periodo}
            podeResponder={podeResponder}
            podeEditar={podeEditar}
          />
        ) : foraDoPeriodo ? (
          <div className="bg-surface border-line rounded-lg border">
            <Vazio
              icone="filtro"
              titulo="Esta rotina não está no período escolhido"
              explicacao="Ela existe, mas não vence nem está atrasada dentro de “Hoje”. Veja a semana para encontrá-la."
              acao={
                <Link
                  href={`/checklists?periodo=semana&rotina=${rotinaPedida}`}
                  className={estiloDeBotao("secundario")}
                >
                  Ver na semana
                </Link>
              }
            />
          </div>
        ) : (
          <div className="bg-surface border-line rounded-lg border">
            <Vazio
              icone="lista-conferida"
              titulo="Escolha uma rotina à esquerda"
              explicacao={
                rotinas.length === 0
                  ? "Nenhuma rotina de checklist está agendada para esta loja ainda."
                  : "A folha, o responsável e o histórico de conclusão aparecem aqui, sem sair desta tela."
              }
              acao={
                rotinas.length === 0 && podeEditar ? (
                  <Link
                    href="/checklists/modelos/novo"
                    className={estiloDeBotao()}
                  >
                    Criar o primeiro checklist
                  </Link>
                ) : undefined
              }
            />
          </div>
        )}
      </PainelDeRotinas>
    </div>
  );
}
