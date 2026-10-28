import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { painelRecebimentoCw } from "@/connectors/cardapioweb/recebimento";
import { urlWebhookCw, type AmbienteCw } from "@/connectors/cardapioweb/config";
import type { EscopoCw } from "@/connectors/cardapioweb/seguranca";
import { acaoCardapioWeb } from "./acoes";
import { BotaoAcaoCw } from "./botao-acao";
import { FormularioLegadoCw } from "./formulario-legado";
import { AtualizarRecebimentoCw } from "./atualizar-recebimento";

const quando = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(d)
    : "Ainda não recebido";
const status: Record<string, string> = {
  waiting_confirmation: "Aguardando confirmação",
  confirmed: "Confirmado",
  ready: "Pronto",
  released: "Saiu para entrega",
  waiting_to_catch: "Aguardando retirada",
  delivered: "Entregue",
  closed: "Finalizado",
  canceled: "Cancelado",
  canceling: "Cancelamento em andamento",
  pending_payment: "Pagamento pendente",
  pending_online_payment: "Pagamento online pendente",
  scheduled_confirmed: "Agendado confirmado",
};

export async function PainelRecebimentoCw({ scope }: { scope: EscopoCw }) {
  const { vinculos, pedidos } = await painelRecebimentoCw(scope);
  let pronta = false;
  try {
    urlWebhookCw("producao");
    pronta = true;
  } catch {
    /* APP_URL ainda não configurada. */
  }
  return (
    <section
      id="recebimento-cardapioweb"
      className="space-y-5"
      aria-label="Recebimento de pedidos Cardápio Web"
    >
      <AtualizarRecebimentoCw lidoEm={new Date().toISOString()} />
      <Cartao>
        <TituloDeSecao apoio="Para quem já possui o token de API da loja.">
          Conectar pedidos e webhook
        </TituloDeSecao>
        <div className="space-y-5 p-5">
          <p className="text-ink-2 text-sm">
            Confira a loja pela API e confirme o vínculo com esta unidade.
            Depois, cadastre a URL e o token de autenticação do webhook no
            portal da Cardápio Web.
          </p>
          {vinculos.map((v) => (
            <div key={v.id} className="border-line space-y-3 border-t pt-4">
              <p className="font-semibold">
                {v.merchantNome}{" "}
                <span className="text-ink-3 font-normal">
                  · loja {v.merchantId} ·{" "}
                  {v.ambiente === "producao" ? "produção" : "testes"}
                </span>
              </p>
              {v.pendentePorId === scope.usuarioId && (
                <>
                  <p className="text-ink-2 text-sm">
                    A API identificou esta loja. Confirme que ela corresponde à
                    unidade selecionada no Tetteo.
                  </p>
                  <Acao acao="confirmar-legado" id={v.id}>
                    Confirmar loja e ativar recebimento
                  </Acao>
                </>
              )}
              {v.ativo && (
                <>
                  <p className="text-sm font-medium">
                    Recebimento ativo no Tetteo
                  </p>
                  {pronta && (
                    <label className="block text-sm font-medium">
                      URL para cadastrar na Cardápio Web
                      <input
                        type="text"
                        readOnly
                        value={urlWebhookCw(v.ambiente as AmbienteCw)}
                        className="border-line bg-surface-2 mt-2 block w-full rounded-md border px-3 py-2 font-mono text-xs"
                      />
                    </label>
                  )}
                  <p className="text-ink-3 text-xs">
                    Método POST · autenticação pelo token que você criou,
                    enviado em X-Webhook-Token.
                  </p>
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-3">Último webhook recebido</dt>
                      <dd>{quando(v.ultimoEventoEm)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">
                        Última reconciliação pela API
                      </dt>
                      <dd>{quando(v.ultimaReconciliacaoEm)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">
                        Eventos aguardando conferência
                      </dt>
                      <dd>{v._count.eventos}</dd>
                    </div>
                  </dl>
                  {!v.ultimoEventoEm && (
                    <p className="text-warn text-sm">
                      Nenhum webhook foi recebido desta loja. Confira a URL e o
                      mesmo token de autenticação no portal da Cardápio Web. A
                      consulta automática pela API funciona separadamente e pode
                      trazer pedidos mesmo sem o webhook.
                    </p>
                  )}
                  {v.ultimoErro && (
                    <p role="status" className="text-warn text-sm">
                      A última consulta falhou. O Tetteo mantém os eventos
                      gravados e tentará novamente. Se o token expirou, confira
                      a conexão abaixo.
                    </p>
                  )}
                  {process.env.CARDAPIOWEB_WORKER_ENABLED === "false" && (
                    <p className="text-warn text-sm">
                      O processamento automático está pausado pelo
                      administrador.
                    </p>
                  )}
                  <Acao acao="desativar-webhook" id={v.id} secundario>
                    Desconectar no Tetteo
                  </Acao>
                </>
              )}
              {!v.ativo && v.ultimoErro && (
                <p className="text-warn text-sm">
                  A conexão foi interrompida porque a credencial ou a identidade
                  da loja precisa ser conferida. Configure o token novamente
                  abaixo.
                </p>
              )}
            </div>
          ))}
          <details data-credenciais open={vinculos.length === 0}>
            <summary className="cursor-pointer text-sm font-semibold">
              {vinculos.length
                ? "Conferir outra credencial ou trocar o token do webhook"
                : "Configurar a conexão"}
            </summary>
            <div className="mt-4 max-w-xl">
              <FormularioLegadoCw />
            </div>
          </details>
        </div>
      </Cartao>
      <Cartao>
        <TituloDeSecao apoio="Pedidos conferidos pela API. Eles não são somados novamente às vendas do Saipos.">
          Pedidos recebidos
        </TituloDeSecao>
        {pedidos.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Pedidos recebidos e conferidos da unidade
              </caption>
              <thead>
                <tr>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3">Canal</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Atualizado na loja</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id} className="border-line border-t">
                    <td className="px-4 py-3 font-mono">
                      {p.displayId ?? p.orderId}
                    </td>
                    <td className="px-4 py-3">
                      {status[p.estado] ?? p.estado}
                    </td>
                    <td className="px-4 py-3">{p.canal}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {(Number(p.totalCentavos) / 100).toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {quando(p.atualizadoNoProvedorEm)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-3 p-5 text-sm">
            Após conectar a loja, o Tetteo receberá os eventos e consultará os
            pedidos recentes pela API.
          </p>
        )}
      </Cartao>
    </section>
  );
}
function Acao({
  acao,
  id,
  children,
  secundario = false,
}: {
  acao: string;
  id: string;
  children: React.ReactNode;
  secundario?: boolean;
}) {
  return (
    <form action={acaoCardapioWeb}>
      <input type="hidden" name="acao" value={acao} />
      <input type="hidden" name="id" value={id} />
      <BotaoAcaoCw secundario={secundario}>{children}</BotaoAcaoCw>
    </form>
  );
}
