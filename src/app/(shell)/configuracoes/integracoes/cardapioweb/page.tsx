import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { configCw } from "@/connectors/cardapioweb/config";
import { escopoCw } from "@/connectors/cardapioweb/seguranca";
import { painelCw } from "@/connectors/cardapioweb/servico";
import type { CatalogoCw, PedidosCw } from "@/connectors/cardapioweb/schemas";
import { acaoCardapioWeb } from "./acoes";
import { BotaoAcaoCw } from "./botao-acao";
import { PainelRecebimentoCw } from "./painel-recebimento";

export const dynamic = "force-dynamic";
const avisos: Record<string, string> = {
  "webhook-ativo":
    "Loja confirmada. Cadastre a URL e o token de autenticação do webhook no portal da Cardápio Web.",
  "webhook-pausado":
    "Recebimento desativado no Tetteo. Remova também o webhook do portal da Cardápio Web.",
  conferir: "Autorização recebida. Confira a loja antes de concluir o vínculo.",
  salvo: "Autorização atualizada.",
  consultado: "Pedidos e cardápio consultados agora.",
  desconectada: "Conexão desconectada e tokens revogados.",
  configuracao:
    "O administrador precisa configurar o aplicativo Cardápio Web no servidor.",
  state:
    "A autorização expirou, já foi usada ou não pertence a este navegador. Reinicie a conexão.",
  sessao: "Entre no Tetteo e reinicie a autorização.",
  permissao: "Você não tem permissão para gerenciar esta integração.",
  escopo:
    "Revise os escopos store, orders e catalog com a Cardápio Web. Depois autorize novamente.",
  unidade: "Selecione uma unidade autorizada.",
  vinculo: "Essa loja já possui um vínculo. Revise com o administrador.",
  conexao:
    "A conexão mudou ou já existe. Atualize a página e confira a situação.",
  pendente: "Confira ou cancele a autorização pendente antes de recomeçar.",
  limite: "Aguarde pelo menos um minuto antes de tentar novamente.",
  reconectar: "A autorização não está válida. Conecte a loja novamente.",
  rede: "Cardápio Web não respondeu. Tente novamente mais tarde.",
  fornecedor:
    "Cardápio Web não concluiu a solicitação. Tente novamente mais tarde.",
  contrato:
    "A resposta Cardápio Web não corresponde ao contrato esperado. Consulte o administrador.",
  credencial: "A chave de proteção precisa ser revisada no servidor.",
  interno:
    "Não foi possível concluir. Tente novamente ou consulte o administrador.",
};
const estados: Record<string, string> = {
  waiting_confirmation: "Aguardando confirmação",
  pending_payment: "Pagamento pendente",
  pending_online_payment: "Pagamento online pendente",
  scheduled_confirmed: "Agendado confirmado",
  confirmed: "Confirmado",
  ready: "Pronto",
  released: "Saiu para entrega",
  waiting_to_catch: "Aguardando retirada",
  delivered: "Entregue",
  canceling: "Cancelamento em andamento",
  canceled: "Cancelado",
  closed: "Finalizado",
};
const quando = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(d));
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export default async function CardapioWeb({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const sessao = await obterContexto();
  if (!sessao) redirect("/login");
  if (!pode(sessao, "configuracoes.cardapioweb")) notFound();
  const { aviso } = await searchParams;
  let configurada = false;
  let ambiente = "sandbox";
  try {
    const config = configCw();
    configurada = true;
    ambiente = config.ambiente;
  } catch {
    /* Configuração pendente. */
  }
  const painel =
    configurada && sessao.unidadeAtiva
      ? await painelCw(escopoCw(sessao))
      : null;
  const conexao = painel?.conexao;
  const ativa = conexao?.estado === "ATIVA";
  const pedidos = ativa ? (conexao.pedidos as PedidosCw | null) : null;
  const catalogo = ativa ? (conexao.catalogo as CatalogoCw | null) : null;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <Link href="/configuracoes" className="text-accent text-sm">
          Configurações
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Cardápio Web
          </h1>
          {configurada && (
            <span className="bg-surface-2 text-ink-2 rounded-full px-3 py-1 text-xs">
              OAuth ·{" "}
              {ambiente === "producao" ? "Produção" : "Ambiente de testes"}
            </span>
          )}
        </div>
        <p className="text-ink-3 mt-2 text-sm">
          Pedidos e cardápio da{" "}
          {sessao.unidadeAtiva?.nome ?? "unidade selecionada"}
        </p>
      </header>
      {aviso && avisos[aviso] && (
        <p
          role="status"
          className="border-line bg-surface-2 rounded-lg border p-4 text-sm"
        >
          {avisos[aviso]}
        </p>
      )}
      {sessao.unidadeAtiva && <PainelRecebimentoCw scope={escopoCw(sessao)} />}
      {!sessao.unidadeAtiva ? (
        <Cartao className="p-5">
          <p>Selecione uma unidade no topo para gerenciar a conexão.</p>
        </Cartao>
      ) : !configurada ? (
        <Cartao className="space-y-3 p-5">
          <h2 className="font-semibold">Conexão por aplicativo OAuth</h2>
          <p className="text-ink-2 text-sm">
            Para migrar para um aplicativo OAuth, o administrador precisa
            cadastrar o Tetteo na Cardápio Web. O token de API existente pode
            ser configurado na conexão de pedidos acima.
          </p>
          <a
            href="https://docs.cardapioweb.com/cw-app-store/cadastro-e-publicacao"
            className="text-accent inline-block text-sm underline"
          >
            Consultar os requisitos de cadastro
          </a>
        </Cartao>
      ) : (
        <>
          <Cartao>
            <TituloDeSecao>Conexão da unidade</TituloDeSecao>
            <div className="space-y-4 p-5">
              {painel?.pendente ? (
                <>
                  <p className="font-semibold">Confira a loja autorizada</p>
                  <p className="text-sm">
                    {painel.pendente.merchantNome} · identificador{" "}
                    {painel.pendente.merchantId}
                  </p>
                  <p className="text-ink-2 text-sm">
                    Esta é a loja que deve ser vinculada à unidade{" "}
                    <strong>{sessao.unidadeAtiva.nome}</strong>?
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {!painel.pendente.cancelando && (
                      <Acao acao="confirmar" id={painel.pendente.id}>
                        Confirmar esta loja
                      </Acao>
                    )}
                    <Acao acao="cancelar" id={painel.pendente.id} secundario>
                      Cancelar autorização
                    </Acao>
                  </div>
                </>
              ) : ativa ? (
                <>
                  <p className="font-semibold">{conexao.merchantNome}</p>
                  <p className="text-ink-3 text-sm">
                    Loja {conexao.merchantId} · conectada
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Acao acao="consultar">Consultar pedidos e cardápio</Acao>
                    <Acao acao="desconectar" secundario>
                      Desconectar e revogar acesso
                    </Acao>
                  </div>
                </>
              ) : conexao?.estado === "REVOGANDO" ? (
                <>
                  <p className="font-semibold">Revogação pendente</p>
                  <p className="text-ink-2 text-sm">
                    As consultas estão interrompidas. A Cardápio Web ainda
                    precisa confirmar a revogação do acesso.
                  </p>
                  <Acao acao="desconectar">Tentar revogar novamente</Acao>
                </>
              ) : (
                <>
                  <p className="font-semibold">
                    {conexao?.estado === "RECONECTAR"
                      ? "A loja precisa ser autorizada novamente"
                      : "Nenhuma loja conectada"}
                  </p>
                  <p className="text-ink-2 text-sm">
                    Entre na Cardápio Web com o perfil Proprietário para
                    autorizar esta unidade. Ao retornar, você confere o nome e o
                    identificador da loja.
                  </p>
                  <Acao acao="conectar">Autorizar na Cardápio Web</Acao>
                </>
              )}
            </div>
          </Cartao>
          {ativa && (
            <>
              <p className="text-ink-3 text-sm">
                {conexao.consultadaEm
                  ? `Última consulta concluída: ${quando(conexao.consultadaEm)}.`
                  : "Faça a primeira consulta para conferir os dados da loja."}{" "}
                {conexao.ultimoErro
                  ? "A última tentativa falhou; os dados abaixo são da consulta anterior."
                  : ""}
              </p>
              <Cartao>
                <TituloDeSecao apoio="A API retorna pedidos modificados nas últimas 8 horas. Mesas e comandas aparecem após finalizar ou cancelar.">
                  Pedidos da última consulta
                </TituloDeSecao>
                {pedidos?.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">
                        Pedidos retornados pela Cardápio Web
                      </caption>
                      <thead className="text-ink-3">
                        <tr>
                          <th className="px-4 py-3">ID do pedido</th>
                          <th className="px-4 py-3">Situação</th>
                          <th className="px-4 py-3">Canal</th>
                          <th className="px-4 py-3">Atualizado em</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedidos.slice(0, 200).map((p) => (
                          <tr key={p.id} className="border-line border-t">
                            <td className="px-4 py-3 font-mono">{p.id}</td>
                            <td className="px-4 py-3">
                              {estados[p.status] ??
                                `Estado informado: ${p.status}`}
                            </td>
                            <td className="px-4 py-3">{p.sales_channel}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {quando(p.updated_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pedidos.length > 200 && (
                      <p className="text-ink-3 px-4 py-3 text-sm">
                        Exibindo os 200 pedidos mais recentes de{" "}
                        {pedidos.length} recebidos.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-ink-3 p-5 text-sm">
                    {pedidos
                      ? "Nenhum pedido foi retornado nesta consulta."
                      : "Os pedidos aparecerão após a primeira consulta."}
                  </p>
                )}
              </Cartao>
              <Cartao>
                <TituloDeSecao apoio="Preços base e vínculos de complementos e combos preservados da consulta.">
                  Cardápio da loja
                </TituloDeSecao>
                {catalogo?.categories.length ? (
                  <div className="divide-line divide-y">
                    {catalogo.categories.map((categoria) => (
                      <details key={categoria.id} className="px-5 py-4">
                        <summary className="cursor-pointer text-sm font-semibold">
                          {categoria.name}{" "}
                          <span className="text-ink-3 font-normal">
                            · {categoria.items.length} itens ·{" "}
                            {categoria.status}
                          </span>
                        </summary>
                        <ul className="mt-3 space-y-3">
                          {categoria.items.map((item) => (
                            <li
                              key={item.id}
                              className="flex flex-wrap justify-between gap-2 text-sm"
                            >
                              <div>
                                <p>
                                  {item.name}{" "}
                                  {item.kind === "combo" && (
                                    <span className="text-ink-3">· combo</span>
                                  )}
                                </p>
                                <p className="text-ink-3 mt-0.5 text-xs">
                                  ID {item.id} · {item.status} ·{" "}
                                  {item.option_groups.length} grupos de
                                  complementos · {item.combo_steps.length}{" "}
                                  etapas
                                </p>
                              </div>
                              <span className="font-mono tabular-nums">
                                {reais(item.price)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="text-ink-3 p-5 text-sm">
                    {catalogo
                      ? "O cardápio retornado está vazio."
                      : "O cardápio aparecerá após a primeira consulta."}
                  </p>
                )}
              </Cartao>
            </>
          )}
        </>
      )}
      <p className="text-ink-3 text-sm">
        Os pedidos consultados não entram nos totais de vendas do Tetteo. As
        fichas técnicas e o cardápio local continuam sendo gerenciados no módulo
        Cardápio.
      </p>
    </div>
  );
}

function Acao({
  acao,
  id,
  secundario = false,
  children,
}: {
  acao: string;
  id?: string;
  secundario?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form action={acaoCardapioWeb}>
      <input type="hidden" name="acao" value={acao} />
      {id && <input type="hidden" name="id" value={id} />}
      <BotaoAcaoCw secundario={secundario}>{children}</BotaoAcaoCw>
    </form>
  );
}
