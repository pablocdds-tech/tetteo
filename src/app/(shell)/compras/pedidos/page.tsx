import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import {
  atualizarDestinoAcao,
  buscarMensagemAcao,
  marcarEnviadaAMaoAcao,
  pausarCanalAcao,
  reprocessarAcao,
  resolverIncertaAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { Copiar } from "@/modules/compras/components/copiar";
import {
  EstadoDaConfirmacao,
  EstadoDoEnvio,
  EstadoDoPedido,
  EstadoDoRecebimento,
  ROTULO_DO_PEDIDO,
} from "@/modules/compras/components/estado";
import { FiltrosDeCompras } from "@/modules/compras/components/filtros";
import {
  diaHora,
  dinheiro,
  janela,
} from "@/modules/compras/components/formato";
import type { EstadoDaMensagem } from "@/modules/compras/services/fila";
import { painelDeEnvios } from "@/modules/compras/services/fila";
import { listarPedidos } from "@/modules/compras/services/pedidos";
import { listarRodadas } from "@/modules/compras/services/rodadas";

/**
 * PEDIDOS E ENVIOS — duas perguntas, duas abas.
 *
 *   PEDIDOS  o que foi comprado: situação, se o fornecedor confirmou, se
 *            chegou. Três colunas separadas, porque são três fatos.
 *   ENVIOS   o que o sistema mandou ao fornecedor, mensagem por mensagem:
 *            na fila, aceita pelo canal, entregue, incerta, falhou. É aqui
 *            que se copia, se marca "mandei pelo meu WhatsApp", se tenta de
 *            novo e se decide o que ficou incerto.
 */

const TIPO_DA_MENSAGEM: Record<string, string> = {
  CONVITE_COTACAO: "Convite de cotação",
  PEDIDO: "Pedido",
  ADENDO: "Adendo",
  ALTERACAO: "Alteração",
  CANCELAMENTO: "Cancelamento",
  TESTE: "Teste",
};

const ESTADOS_DA_MENSAGEM: { valor: EstadoDaMensagem; rotulo: string }[] = [
  { valor: "BLOQUEADA", rotulo: "Bloqueada" },
  { valor: "NA_FILA", rotulo: "Na fila" },
  { valor: "ENVIANDO", rotulo: "Saindo agora" },
  { valor: "ACEITA_PELO_CANAL", rotulo: "Aceita pelo canal" },
  { valor: "ENTREGUE", rotulo: "Entregue" },
  { valor: "INCERTA", rotulo: "Incerta" },
  { valor: "FALHOU", rotulo: "Falhou" },
  { valor: "CANCELADA", rotulo: "Cancelada" },
];

type Painel = Awaited<ReturnType<typeof painelDeEnvios>>;
type Mensagem = Painel["mensagens"][number];
type Pedido = Awaited<ReturnType<typeof listarPedidos>>[number];

export default async function PaginaDePedidos({
  searchParams,
}: {
  searchParams: Promise<{
    ver?: string;
    loja?: string;
    rodada?: string;
    status?: string;
    estado?: string;
  }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const sp = await searchParams;
  const ver = sp.ver === "envios" ? "envios" : "pedidos";
  const loja = ctx.unidadesVisiveis.some((u) => u.id === sp.loja)
    ? sp.loja
    : undefined;
  const estadoDaMensagem = ESTADOS_DA_MENSAGEM.find(
    (e) => e.valor === sp.estado,
  )?.valor;

  const painel = await painelDeEnvios(ctx, {
    unidadeId: loja,
    estado: ver === "envios" ? estadoDaMensagem : undefined,
  });
  const problemas =
    (painel.porEstado.BLOQUEADA ?? 0) +
    (painel.porEstado.FALHOU ?? 0) +
    (painel.porEstado.INCERTA ?? 0);

  const filtroDeLoja =
    ctx.unidadesVisiveis.length > 1
      ? [
          {
            nome: "loja",
            rotulo: "Loja",
            todos: "Todas as lojas",
            opcoes: ctx.unidadesVisiveis.map((u) => ({
              valor: u.id,
              rotulo: u.nome,
            })),
          },
        ]
      : [];

  const abas = (
    <nav
      aria-label="Pedidos ou envios"
      className="border-line flex gap-1 border-b"
    >
      {(
        [
          { chave: "pedidos", href: "/compras/pedidos", texto: "Pedidos" },
          {
            chave: "envios",
            href: "/compras/pedidos?ver=envios",
            texto: "Envios ao fornecedor",
          },
        ] as const
      ).map((a) => (
        <Link
          key={a.chave}
          href={a.href}
          aria-current={ver === a.chave ? "page" : undefined}
          className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${
            ver === a.chave
              ? "border-accent text-ink"
              : "text-ink-3 hover:text-ink border-transparent"
          }`}
        >
          {a.texto}
          {a.chave === "envios" && problemas > 0 && (
            <Etiqueta tom="aviso">{problemas} para resolver</Etiqueta>
          )}
        </Link>
      ))}
    </nav>
  );

  if (ver === "envios") {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        <CabecalhoDePagina
          titulo="Pedidos e envios"
          contexto="O que o sistema mandou aos fornecedores, mensagem por mensagem"
          controles={
            <FiltrosDeCompras
              filtros={[
                ...filtroDeLoja,
                {
                  nome: "estado",
                  rotulo: "Situação",
                  todos: "Todas as situações",
                  opcoes: ESTADOS_DA_MENSAGEM.map((e) => ({
                    valor: e.valor,
                    rotulo: `${e.rotulo} (${painel.porEstado[e.valor] ?? 0})`,
                  })),
                },
              ]}
            />
          }
        />
        {abas}
        <PainelDeEnvios
          painel={painel}
          podeEnviar={pode(ctx, "compras.enviar")}
          podeCopiar={
            pode(ctx, "compras.enviar") ||
            pode(ctx, "compras.pedir") ||
            pode(ctx, "compras.cotar")
          }
        />
      </div>
    );
  }

  const rodadas = await listarRodadas(ctx);
  const rodada = rodadas.some((r) => r.id === sp.rodada)
    ? sp.rodada
    : undefined;
  const status =
    sp.status && sp.status in ROTULO_DO_PEDIDO ? sp.status : undefined;
  const pedidos = await listarPedidos(ctx, {
    unidadeId: loja,
    rodadaId: rodada,
    status,
  });
  const filtrado = !!(loja || rodada || status);

  const colunas: Coluna<Pedido>[] = [
    {
      chave: "pedido",
      titulo: "Pedido",
      principal: true,
      larguraMin: "9rem",
      celula: (p) => (
        <Link
          href={`/compras/pedidos/${p.id}`}
          className="hover:text-accent font-medium"
        >
          {p.referencia}
          <span className="text-ink-3 block text-xs font-normal">
            {p.tipo === "ADENDO"
              ? "Adendo"
              : p.rodada
                ? `Rodada ${p.rodada}`
                : "Pedido"}
          </span>
        </Link>
      ),
    },
    ...(ctx.unidadesVisiveis.length > 1
      ? [{ chave: "loja", titulo: "Loja", celula: (p: Pedido) => p.loja }]
      : []),
    { chave: "fornecedor", titulo: "Fornecedor", celula: (p) => p.fornecedor },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (p) => <EstadoDoPedido valor={p.status} />,
    },
    {
      chave: "envio",
      titulo: "Envio",
      celula: (p) =>
        p.status === "APROVADO" || p.status === "CONCLUIDO" || p.envio ? (
          <EstadoDoEnvio
            valor={p.envio?.estado ?? null}
            simulada={p.envio?.simulada}
            enviadaAMao={!!p.envio?.enviadaAMaoEm}
          />
        ) : (
          <span className="text-ink-3 text-xs">sai na aprovação</span>
        ),
    },
    {
      chave: "confirmacao",
      titulo: "Fornecedor",
      celula: (p) =>
        p.status === "APROVADO" || p.status === "CONCLUIDO" ? (
          <EstadoDaConfirmacao valor={p.confirmacao} />
        ) : (
          <span className="text-ink-3 text-xs">—</span>
        ),
    },
    {
      chave: "recebimento",
      titulo: "Recebimento",
      celula: (p) => <EstadoDoRecebimento valor={p.situacaoRecebimento} />,
    },
    {
      chave: "entrega",
      titulo: "Entrega",
      celula: (p) => janela(p.entregaDe, p.entregaAte),
    },
    {
      chave: "total",
      titulo: "Total",
      numerica: true,
      celula: (p) => dinheiro(p.total),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Pedidos e envios"
        contexto="Três fatos diferentes: a mensagem saiu, o fornecedor confirmou, a mercadoria chegou"
        controles={
          <FiltrosDeCompras
            filtros={[
              ...filtroDeLoja,
              {
                nome: "rodada",
                rotulo: "Rodada",
                todos: "Todas as rodadas",
                opcoes: rodadas.map((r) => ({
                  valor: r.id,
                  rotulo: `Rodada ${r.numero}`,
                })),
              },
              {
                nome: "status",
                rotulo: "Situação",
                todos: "Todas as situações",
                opcoes: Object.entries(ROTULO_DO_PEDIDO).map(
                  ([valor, rotulo]) => ({ valor, rotulo }),
                ),
              },
            ]}
          />
        }
      />
      {abas}
      <Cartao className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio={`${pedidos.length} ${pedidos.length === 1 ? "pedido" : "pedidos"}`}
        >
          Pedidos
        </TituloDeSecao>
        <Tabela
          legenda="Pedidos de compra"
          colunas={colunas}
          linhas={pedidos}
          chaveDaLinha={(p) => p.id}
          vazio={
            filtrado ? (
              <Vazio
                icone="filtro"
                titulo="Nenhum pedido neste recorte"
                explicacao="Troque os filtros no topo, ou limpe-os."
              />
            ) : (
              <Vazio
                icone="carrinho"
                titulo="Nenhum pedido ainda"
                explicacao="Os pedidos nascem na comparação de uma rodada, em Gerar pedidos, e passam pela aprovação."
              />
            )
          }
        />
      </Cartao>
    </div>
  );
}

function PainelDeEnvios({
  painel,
  podeEnviar,
  podeCopiar,
}: {
  painel: Painel;
  podeEnviar: boolean;
  podeCopiar: boolean;
}) {
  const colunas: Coluna<Mensagem>[] = [
    {
      chave: "mensagem",
      titulo: "Mensagem",
      principal: true,
      larguraMin: "11rem",
      celula: (m) => (
        <span>
          {m.referenciaTipo === "Pedido" ? (
            <Link
              href={`/compras/pedidos/${m.referenciaId}`}
              className="hover:text-accent"
            >
              {TIPO_DA_MENSAGEM[m.tipo] ?? m.tipo}
            </Link>
          ) : (
            (TIPO_DA_MENSAGEM[m.tipo] ?? m.tipo)
          )}
          {m.sequencia > 1 && (
            <span className="text-ink-3 font-normal">
              {" "}
              · envio {m.sequencia}
            </span>
          )}
          <span className="text-ink-3 block text-xs font-normal">
            na fila em {diaHora(m.enfileiradaEm)}
          </span>
        </span>
      ),
    },
    {
      chave: "fornecedor",
      titulo: "Para",
      celula: (m) => (
        <span className="text-sm">
          {m.ehTeste ? "Número de teste" : (m.fornecedor ?? "—")}
          <span className="text-ink-3 block text-xs tabular-nums">
            {m.destino ?? "sem número"}
          </span>
        </span>
      ),
    },
    {
      chave: "situacao",
      titulo: "Situação",
      larguraMin: "12rem",
      celula: (m) => (
        <span className="flex flex-col items-start gap-1">
          <EstadoDoEnvio
            valor={m.estado}
            simulada={m.simulada}
            enviadaAMao={!!m.enviadaAMaoEm}
          />
          {m.estado === "BLOQUEADA" && m.motivoBloqueio && (
            <span className="text-ink-3 text-xs">{m.motivoBloqueio}</span>
          )}
          {(m.estado === "FALHOU" || m.estado === "INCERTA") &&
            m.ultimoErro && (
              <span className="text-ink-3 text-xs">{m.ultimoErro}</span>
            )}
          {m.estado === "INCERTA" && (
            <span className="text-warn text-xs">
              O canal não confirmou se saiu. Confira no WhatsApp antes de
              reenviar.
            </span>
          )}
          {m.destinoMudou && (
            <span className="text-warn text-xs">
              O telefone do fornecedor mudou depois de entrar na fila.
            </span>
          )}
          {m.resolucao && (
            <span className="text-ink-3 text-xs">{m.resolucao}</span>
          )}
        </span>
      ),
    },
    {
      chave: "tentativas",
      titulo: "Tentativas",
      numerica: true,
      celula: (m) => String(m.tentativas),
    },
    {
      chave: "acoes",
      titulo: "O que fazer",
      larguraMin: "14rem",
      celula: (m) => (
        <AcoesDaMensagem
          m={m}
          podeEnviar={podeEnviar}
          podeCopiar={podeCopiar}
        />
      ),
    },
  ];

  return (
    <>
      {painel.canal.simulado && (
        <p className="border-warn/30 bg-warn-sub text-warn rounded-lg border px-4 py-3 text-sm leading-5">
          <strong className="font-semibold">Simulador ligado:</strong> nenhuma
          mensagem sai do sistema. &ldquo;Simulado — nada saiu&rdquo; quer dizer
          só que o simulador recebeu. Copie cada mensagem, mande pelo seu
          WhatsApp e marque &ldquo;Mandei pelo meu WhatsApp&rdquo;.
        </p>
      )}
      {painel.canal.pausado ? (
        <div className="border-bad/30 bg-bad-sub flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3">
          <p className="text-bad pt-1 text-sm leading-5">
            <strong className="font-semibold">Envio pausado</strong>
            {painel.canal.motivoPausa ? `: ${painel.canal.motivoPausa}` : ""}.
            Nada sai até retomar.
          </p>
          {podeEnviar && (
            <Acao
              acao={pausarCanalAcao}
              campos={{ pausar: "0" }}
              rotulo="Retomar envio"
              peso="secundario"
              tamanho="pequeno"
            />
          )}
        </div>
      ) : (
        podeEnviar && (
          <div className="flex justify-end">
            <Acao
              acao={pausarCanalAcao}
              campos={{ pausar: "1" }}
              rotulo="Pausar todo o envio"
              peso="fantasma"
              tamanho="pequeno"
              pedeMotivo="Por que pausar? A frase aparece para todos no painel."
            />
          </div>
        )
      )}
      <Cartao className="min-w-0 overflow-hidden">
        <TituloDeSecao apoio="Na fila ≠ enviada ≠ entregue ≠ fornecedor confirmou">
          Mensagens aos fornecedores
        </TituloDeSecao>
        <Tabela
          legenda="Mensagens aos fornecedores"
          colunas={colunas}
          linhas={painel.mensagens}
          chaveDaLinha={(m) => m.id}
          vazio={
            <Vazio
              tom="bom"
              icone="entrega"
              titulo="Nenhuma mensagem neste recorte"
              explicacao="Convites de cotação e pedidos aprovados aparecem aqui assim que entram na fila."
            />
          }
        />
      </Cartao>
    </>
  );
}

function AcoesDaMensagem({
  m,
  podeEnviar,
  podeCopiar,
}: {
  m: Mensagem;
  podeEnviar: boolean;
  podeCopiar: boolean;
}) {
  const pedidoId = m.referenciaTipo === "Pedido" ? m.referenciaId : "";
  const encerrada = m.estado === "CANCELADA" || m.estado === "ENTREGUE";
  const podeMarcar =
    podeEnviar &&
    !m.ehTeste &&
    !m.enviadaAMaoEm &&
    m.estado !== "ENVIANDO" &&
    m.estado !== "CANCELADA" &&
    (m.simulada ||
      ["BLOQUEADA", "FALHOU", "INCERTA", "NA_FILA"].includes(m.estado));

  return (
    <div className="flex flex-wrap items-start gap-2">
      {podeCopiar && !m.ehTeste && !encerrada && (
        <Copiar
          rotulo="Copiar mensagem"
          buscar={buscarMensagemAcao.bind(null, m.id)}
        />
      )}
      {podeMarcar && (
        <Acao
          acao={marcarEnviadaAMaoAcao}
          campos={{ mensagemId: m.id, pedidoId }}
          rotulo="Mandei pelo meu WhatsApp"
          peso="secundario"
          tamanho="pequeno"
        />
      )}
      {podeEnviar && m.estado === "FALHOU" && (
        <Acao
          acao={reprocessarAcao}
          campos={{ mensagemId: m.id, pedidoId }}
          rotulo="Tentar de novo"
          peso="secundario"
          tamanho="pequeno"
        />
      )}
      {podeEnviar && m.destinoMudou && (
        <Acao
          acao={atualizarDestinoAcao}
          campos={{ mensagemId: m.id, pedidoId }}
          rotulo="Usar o número novo"
          peso="secundario"
          tamanho="pequeno"
          confirmar="O telefone do fornecedor mudou depois que a mensagem entrou na fila. Mandar para o número que está no cadastro agora?"
        />
      )}
      {podeEnviar && m.estado === "INCERTA" && (
        <>
          <Acao
            acao={resolverIncertaAcao}
            campos={{ mensagemId: m.id, pedidoId, decisao: "saiu" }}
            rotulo="Conferi: chegou"
            peso="secundario"
            tamanho="pequeno"
          />
          <Acao
            acao={resolverIncertaAcao}
            campos={{ mensagemId: m.id, pedidoId, decisao: "reenviar" }}
            rotulo="Não chegou: reenviar"
            peso="fantasma"
            tamanho="pequeno"
            confirmar="Reenviar? Se a primeira tiver chegado, o fornecedor recebe duas. Confira no WhatsApp antes."
          />
        </>
      )}
    </div>
  );
}
