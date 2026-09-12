import { notFound, redirect } from "next/navigation";

import { consultarSaudeDoMcp, listarConexoesDeIa } from "@/connectors/mcp";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { Cartao } from "@/design-system/cartao";
import { Vazio } from "@/design-system/vazio";

import { BotaoRevogar } from "./botao-revogar";

/**
 * AS CONEXÕES DE IA.
 *
 * Quem autorizou uma IA a consultar o Tetteo, de qual loja, com qual programa,
 * e o que dá para fazer a respeito: revogar.
 *
 * Não existe "criar conexão" aqui de propósito. Conexão nasce só quando uma
 * pessoa entra com a própria senha na tela do servidor MCP, a pedido do
 * Claude. Um botão aqui criaria acesso sem esse gesto.
 */

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function PaginaIntegracoes() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.integracoes")) notFound();

  const [leitura, saude] = await Promise.all([
    listarConexoesDeIa(contexto),
    consultarSaudeDoMcp(),
  ]);

  const ativas =
    leitura.situacao === "ok"
      ? leitura.conexoes.filter((c) => !c.revogadaEm).length
      : 0;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Conexões de IA</h1>
      <p className="text-ink-3 mt-1 text-sm">
        Quem autorizou uma IA a consultar o Tetteo ·{" "}
        {ativas === 1 ? "1 conexão ativa" : `${ativas} conexões ativas`}
      </p>

      <Cartao className="mt-6 p-4">
        <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
          Servidor de consultas
        </p>
        {saude.situacao === "sem-endereco" ? (
          <p className="mt-1 text-sm">
            Falta configurar <code>MCP_URL_PUBLICA</code> no servidor. Sem isso
            não dá para saber se ele está no ar.
          </p>
        ) : (
          <>
            <p className="mt-1 font-medium break-all">{saude.endereco}</p>
            {saude.situacao === "ok" ? (
              <p className="text-ink-3 mt-1 text-sm">
                Respondeu agora · versão {saude.versao ?? "?"} · banco{" "}
                {saude.banco ?? "?"} · fonte das vendas:{" "}
                <strong>
                  {saude.fonte === "ficticia"
                    ? "fictícia"
                    : (saude.fonte ?? "?")}
                </strong>
                {saude.fonte === "ficticia" &&
                  " — os números que a IA devolve não são vendas reais."}
              </p>
            ) : (
              <p className="text-warn mt-1 text-sm">
                Não respondeu agora. Pode estar reiniciando; se continuar, veja
                a aplicação no painel do servidor.
              </p>
            )}
          </>
        )}
      </Cartao>

      {leitura.situacao === "sem-servidor" ? (
        <Cartao className="mt-6">
          <Vazio
            icone="engrenagem"
            titulo="O servidor MCP ainda não foi preparado neste banco"
            explicacao="Isto é o normal em desenvolvimento. Em produção, a preparação cria o espaço onde as conexões ficam."
          />
        </Cartao>
      ) : leitura.conexoes.length === 0 ? (
        <Cartao className="mt-6">
          <Vazio
            icone="brilho"
            titulo="Nenhuma IA conectada ainda"
            explicacao="Para conectar, adicione o endereço do servidor como conector no Claude e entre com sua conta do Tetteo. Cada pessoa conecta a sua."
          />
        </Cartao>
      ) : (
        <div className="border-line mt-6 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">
              Conexões de IA autorizadas nesta rede
            </caption>
            <thead>
              <tr className="bg-surface-2 border-line border-b">
                <Cabecalho>Pessoa</Cabecalho>
                <Cabecalho>Loja</Cabecalho>
                <Cabecalho>Programa</Cabecalho>
                <Cabecalho>Consultas (7 dias)</Cabecalho>
                <Cabecalho>Último uso</Cabecalho>
                <th className="w-px px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {leitura.conexoes.map((conexao) => (
                <tr
                  key={conexao.id}
                  className={`border-line border-b last:border-b-0 ${conexao.revogadaEm ? "opacity-55" : ""}`}
                >
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">
                      {conexao.pessoa ?? "(pessoa removida)"}
                      {conexao.revogadaEm && (
                        <span className="bg-bad-sub text-bad ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                          revogada
                        </span>
                      )}
                    </span>
                    <span className="text-ink-3 block text-xs">
                      {conexao.email ?? conexao.usuarioId}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{conexao.unidadeNome}</td>
                  <td className="px-4 py-2.5">
                    <span className="block">{conexao.clienteNome}</span>
                    <span className="text-ink-3 block text-xs">
                      {conexao.clienteHost}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {conexao.consultas7Dias}
                  </td>
                  <td className="text-ink-2 px-4 py-2.5 text-xs tabular-nums">
                    {conexao.ultimoUsoEm
                      ? quando.format(conexao.ultimoUsoEm)
                      : "nunca usada"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {conexao.revogadaEm ? (
                      <span className="text-ink-3 text-xs">
                        {conexao.motivo ?? "revogada"}
                      </span>
                    ) : (
                      <BotaoRevogar
                        id={conexao.id}
                        pessoa={conexao.pessoa ?? "esta pessoa"}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-ink-3 mt-4 text-sm">
        Revogar aqui corta o acesso na próxima pergunta que a IA fizer.
        Suspender a pessoa, tirar a permissão de Financeiro ou trocar a senha
        dela no Tetteo também derrubam as conexões.
      </p>
    </div>
  );
}

function Cabecalho({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
      {children}
    </th>
  );
}
