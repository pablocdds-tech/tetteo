import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import type { Unidade } from "@/lib/unidades";
import { lancarPropostaAcao } from "@/modules/compras/acoes";
import { EstadoDaSolicitacao } from "@/modules/compras/components/estado";
import { diaHora, dinheiro, qtd } from "@/modules/compras/components/formato";
import {
  FormularioDeProposta,
  type ItemParaCotar,
} from "@/modules/compras/components/formulario-de-proposta";
import { Voltar } from "@/modules/compras/components/voltar";
import { versoesDaSolicitacao } from "@/modules/compras/services/propostas";
import { obterRodada } from "@/modules/compras/services/rodadas";

/**
 * LANÇAR A RESPOSTA — o que o fornecedor mandou pelo WhatsApp, digitado por
 * quem compra. Mesma validação do link. Depois de encerrada a cotação, só
 * como negociação registrada, com motivo. Nada sobrescreve: cada envio é uma
 * versão, e as anteriores ficam listadas embaixo.
 */

const ORIGEM: Record<string, string> = {
  FORNECEDOR_LINK: "Pelo link",
  COMPRADOR_DIGITOU: "Digitada pelo comprador",
  NEGOCIACAO: "Negociação",
};

const diaIso = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export default async function LancarProposta({
  params,
}: {
  params: Promise<{ id: string; solicitacaoId: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.cotar")) notFound();

  const { id, solicitacaoId } = await params;
  const [rodada, s] = await Promise.all([
    obterRodada(ctx, id),
    versoesDaSolicitacao(ctx, solicitacaoId),
  ]);
  if (!rodada || !s || s.rodadaId !== rodada.id) notFound();

  const aceita = rodada.estado === "COTANDO" || rodada.estado === "REVISAO";
  const ultima = s.versoes[0] ?? null;

  const itens: ItemParaCotar[] = [...s.itens]
    .sort((a, b) =>
      a.itemDaRodada.insumo.nome.localeCompare(
        b.itemDaRodada.insumo.nome,
        "pt-BR",
      ),
    )
    .map((i) => {
      const u = i.itemDaRodada.insumo.unidadeMedida as Unidade;
      const daRodada = rodada.itens.find((x) => x.id === i.itemDaRodadaId);
      return {
        itemDaSolicitacaoId: i.id,
        nome: i.itemDaRodada.insumo.nome,
        unidade: u,
        quantidade: qtd(i.itemDaRodada.quantidadeTotal.toString(), u),
        porLoja: (daRodada?.porLoja ?? []).map((l) => ({
          loja: l.loja,
          quantidade: qtd(l.quantidade, u),
        })),
        direcionado: i.direcionado,
      };
    });

  type Versao = (typeof s.versoes)[number];
  const colunas: Coluna<Versao>[] = [
    {
      chave: "versao",
      titulo: "Versão",
      principal: true,
      celula: (v) => `Versão ${v.numero}`,
    },
    {
      chave: "quando",
      titulo: "Recebida em",
      celula: (v) => diaHora(v.recebidaEm),
    },
    {
      chave: "origem",
      titulo: "Como chegou",
      celula: (v) => ORIGEM[v.origem] ?? v.origem,
    },
    {
      chave: "itens",
      titulo: "Itens",
      celula: (v) => {
        const cotados = v.itens.filter((x) => x.situacao === "COTADO").length;
        const semItem = v.itens.filter(
          (x) => x.situacao === "INDISPONIVEL",
        ).length;
        return `${cotados} cotados${semItem ? ` · ${semItem} não tem` : ""}`;
      },
    },
    {
      chave: "frete",
      titulo: "Frete",
      numerica: true,
      celula: (v) =>
        v.frete === null ? "não informado" : dinheiro(v.frete.toString()),
    },
    { chave: "motivo", titulo: "Motivo", celula: (v) => v.motivo ?? "—" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <Voltar
        para={`/compras/rodadas/${rodada.id}`}
        rotulo={`Rodada ${rodada.numero}`}
      />
      <CabecalhoDePagina
        titulo={`Resposta de ${s.fornecedor.nome}`}
        contexto={`Rodada ${rodada.numero} · ${rodada.descricao}`}
        controles={<EstadoDaSolicitacao valor={s.status} />}
      />

      <div className="desk:grid-cols-[minmax(0,1fr)_380px] grid items-start gap-4">
        <div className="min-w-0">
          {aceita ? (
            <FormularioDeProposta
              itens={itens}
              anterior={
                ultima
                  ? {
                      frete: ultima.frete?.toString() ?? null,
                      pedidoMinimo: ultima.pedidoMinimo?.toString() ?? null,
                      prazoEntregaDias: ultima.prazoEntregaDias,
                      validaAte: ultima.validaAte
                        ? diaIso.format(ultima.validaAte)
                        : null,
                      observacao: ultima.observacao,
                      ofertas: ultima.itens.map((o) => ({
                        itemDaSolicitacaoId: o.itemDaSolicitacaoId,
                        situacao: o.situacao,
                        nomeEmbalagem: o.nomeEmbalagem,
                        pecas: o.pecas,
                        conteudo: o.conteudo?.toString() ?? null,
                        unidadeConteudo: o.unidadeConteudo,
                        fracionavel: o.fracionavel,
                        precoEmbalagem: o.precoEmbalagem?.toString() ?? null,
                        disponivel: o.disponivel?.toString() ?? null,
                        observacao: o.observacao,
                      })),
                    }
                  : null
              }
              acao={lancarPropostaAcao}
              campos={{ solicitacaoId: s.id, rodadaId: rodada.id }}
              modo="comprador"
              podeEnviar
              negociacaoObrigatoria={rodada.estado === "REVISAO"}
              rotuloEnviar="Gravar proposta"
            />
          ) : (
            <Cartao>
              <Vazio
                icone="cadeado"
                titulo="Esta rodada não aceita propostas agora"
                explicacao="Proposta entra com a cotação aberta, ou como negociação com a rodada em revisão. Para mudar depois disso, reabra a rodada com o motivo."
              />
            </Cartao>
          )}
        </div>

        <Cartao como="section" className="min-w-0 overflow-hidden">
          <TituloDeSecao apoio="A comparação usa a mais nova; as anteriores ficam.">
            Versões recebidas
          </TituloDeSecao>
          <Tabela
            legenda={`Versões da proposta de ${s.fornecedor.nome}`}
            colunas={colunas}
            linhas={s.versoes}
            chaveDaLinha={(v) => v.id}
            vazio={
              <Vazio
                icone="relogio"
                titulo="Nenhuma resposta ainda"
                explicacao="Quando ele responder pelo link, a versão aparece aqui. Se mandou pelo WhatsApp, digite ao lado."
              />
            }
          />
        </Cartao>
      </div>
    </div>
  );
}
