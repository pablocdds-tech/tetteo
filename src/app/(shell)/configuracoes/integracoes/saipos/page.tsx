import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { obterContexto } from "@/core/sessao/contexto";
import { db } from "@/server/db";
import { escopoOperacao } from "@/connectors/saipos/operacao-repositorio";
import {
  configOperacao,
  configWebhookPedido,
} from "@/connectors/saipos/operacao-config";
import { produtosVendidos } from "@/connectors/saipos/detalhes";
import { horarioBrasilia, diaDeslocado } from "@/connectors/saipos/tempo";
import { PainelOperacao } from "./painel";
import { listarEntregas } from "@/connectors/saipos/logistica";

export const dynamic = "force-dynamic";
const quando = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(d)
    : "Ainda não consultado";
export default async function Saipos() {
  const context = await obterContexto();
  if (!context) redirect("/login");
  if (!context.ehDiretor) notFound();
  if (!context.unidadeAtiva)
    return <p>Selecione uma unidade para consultar a integração Saipos.</p>;
  const scope = await escopoOperacao(context);
  const configurada = (tipo: "pedidos" | "logistica") => {
    try {
      return configOperacao(tipo).unidadeId === scope.unidadeId;
    } catch {
      return false;
    }
  };
  const pedidos = configurada("pedidos"),
    logistica = configurada("logistica");
  let webhook = false;
  try {
    webhook = configWebhookPedido().unidadeId === scope.unidadeId;
  } catch {
    // Configuração incompleta não disponibiliza o recebimento de eventos.
  }
  const ambiente =
    process.env.SAIPOS_OPERATIONS_ENVIRONMENT === "producao"
      ? "producao"
      : "homologacao";
  const [vinculo, operacoes, vendas] = await Promise.all([
    db.saiposVinculo.findFirst({
      where: {
        organizacaoId: scope.organizacaoId,
        unidadeId: scope.unidadeId,
        excluidoEm: null,
      },
    }),
    db.saiposOperacao.findMany({
      where: {
        organizacaoId: scope.organizacaoId,
        unidadeId: scope.unidadeId,
        ambiente,
        excluidoEm: null,
      },
      orderBy: { criadoEm: "desc" },
      take: 50,
      select: {
        id: true,
        tipo: true,
        referencia: true,
        estado: true,
        erro: true,
        criadoEm: true,
      },
    }),
    db.saiposVenda.findMany({
      where: {
        organizacaoId: scope.organizacaoId,
        unidadeId: scope.unidadeId,
        excluidoEm: null,
        dataTurno: { gte: diaDeslocado(horarioBrasilia().slice(0, 10), -30) },
      },
      select: {
        cancelada: true,
        itensSaipos: true,
        historicoSaipos: true,
        detalhesEm: true,
      },
    }),
  ]);
  const produtos = produtosVendidos(vendas).slice(0, 20),
    detalhadas = vendas.filter((v) => v.detalhesEm).length;
  const entregas = logistica ? await listarEntregas(scope) : [];
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <Link href="/configuracoes" className="text-accent text-sm">
          Configurações
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Saipos</h1>
        <p className="text-ink-3 mt-1 text-sm">
          {context.unidadeAtiva.nome} · Pedidos e logística em{" "}
          {ambiente === "homologacao" ? "homologação" : "produção"}
        </p>
      </header>
      <section className="border-line bg-surface rounded-xl border p-5">
        <h2 className="font-semibold">Conexões da unidade</h2>
        <dl className="divide-line mt-4 divide-y text-sm">
          {[
            [
              "Dados de vendas e clientes",
              vinculo?.habilitado ? "Vínculo configurado" : "Aguarda vínculo",
            ],
            [
              "Pedidos no PDV",
              pedidos
                ? "Configuração presente; valide no PDV"
                : "Aguarda configuração",
            ],
            [
              "Webhook de pedidos",
              webhook
                ? "Recebimento configurado; valide um evento na Saipos"
                : "Aguarda configuração",
            ],
            [
              "Operação de entregas",
              logistica
                ? "Configuração presente; valide com a Saipos"
                : "Aguarda configuração",
            ],
          ].map(([label, status]) => (
            <div
              key={label}
              className="flex flex-wrap justify-between gap-2 py-3"
            >
              <dt>{label}</dt>
              <dd className="text-ink-3">{status}</dd>
            </div>
          ))}
        </dl>
        <p className="text-ink-3 mt-3 text-sm">
          Credenciais ficam no servidor. Cada API precisa de sua própria
          liberação; configurar não comprova homologação.
        </p>
      </section>
      <section className="border-line bg-surface rounded-xl border p-5">
        <h2 className="font-semibold">
          Produtos e histórico dos últimos 30 dias
        </h2>
        <p className="text-ink-3 mt-1 text-sm">
          {detalhadas} de {vendas.length} vendas possuem detalhes consultados.
          Último sucesso: {quando(vinculo?.detalhesSucessoEm ?? null)}.
        </p>
        {vinculo?.detalhesErro && (
          <p role="alert" className="text-warn mt-2 text-sm">
            {vinculo.detalhesErro}
          </p>
        )}
        {process.env.SAIPOS_DETAILS_ENABLED !== "true" && (
          <p className="text-warn mt-2 text-sm">
            Importação de detalhes aguarda ativação no servidor.
          </p>
        )}
        <p className="text-ink-3 mt-2 text-sm">
          Os dados podem chegar com atraso. Valores de itens incluem adicionais
          e não são o faturamento líquido.{" "}
          <Link href="/analytics/vendas" className="text-accent">
            Conferir vendas
          </Link>{" "}
          ·{" "}
          <Link href="/crm" className="text-accent">
            Abrir CRM
          </Link>
        </p>
        {produtos.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Produtos com detalhes importados
              </caption>
              <thead>
                <tr className="border-line border-b text-left">
                  <th className="py-2">Produto</th>
                  <th>Quantidade</th>
                  <th>Valor dos itens</th>
                </tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.nome} className="border-line border-b">
                    <td className="py-2">{p.nome}</td>
                    <td>{p.quantidade}</td>
                    <td>
                      {(p.centavos / 100).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-3 mt-4 text-sm">
            Os produtos aparecerão após a primeira importação de detalhes.
          </p>
        )}
      </section>
      <PainelOperacao pedidos={pedidos} logistica={logistica} />
      <section className="border-line bg-surface rounded-xl border p-5">
        <h2 className="font-semibold">Solicitações de entrega</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Pedidos recebidos da Saipos. Os endereços são privados desta unidade;
          uma solicitação pendente ainda não confirma o despacho.
        </p>
        {entregas.length ? (
          <ul className="divide-line mt-3 divide-y">
            {entregas.map((e) => (
              <li key={e.id} className="py-3">
                <details>
                  <summary className="cursor-pointer text-sm">
                    {e.dados.orderDisplayId} · {e.dados.customerName} ·{" "}
                    {e.estado}
                  </summary>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div>
                      <dt className="font-medium">Identificador da entrega</dt>
                      <dd className="break-all">{e.id}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Coleta</dt>
                      <dd className="break-all whitespace-pre-wrap">
                        {JSON.stringify(e.dados.pickupAddress)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium">Destino</dt>
                      <dd className="break-all whitespace-pre-wrap">
                        {JSON.stringify(e.dados.deliveryAddress)}
                      </dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-3 mt-4 text-sm">
            As entregas aparecerão quando a loja habilitar o parceiro e enviar
            uma solicitação.
          </p>
        )}
      </section>
      <section className="border-line bg-surface rounded-xl border p-5">
        <h2 className="font-semibold">Pedidos, entregas e confirmações</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Últimas 50 operações deste ambiente. “Recebido” confirma o recebimento
          pela API; a aceitação da loja chega nos eventos.
        </p>
        {operacoes.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <caption className="sr-only">Operações Saipos da unidade</caption>
              <thead>
                <tr className="border-line border-b text-left">
                  <th className="py-2">Quando</th>
                  <th>Tipo</th>
                  <th>Referência</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {operacoes.map((o) => (
                  <tr key={o.id} className="border-line border-b">
                    <td className="py-3">{quando(o.criadoEm)}</td>
                    <td>{o.tipo}</td>
                    <td className="max-w-52 break-all">
                      {o.referencia}
                      <span className="text-ink-3 block text-xs">{o.id}</span>
                    </td>
                    <td>
                      {o.estado === "ENVIANDO"
                        ? "Em envio ou pendente de conferência"
                        : o.estado}
                      {o.erro && (
                        <p className="text-warn max-w-72 text-xs">{o.erro}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-3 mt-4 text-sm">
            Nenhuma operação registrada neste ambiente.
          </p>
        )}
      </section>
    </div>
  );
}
