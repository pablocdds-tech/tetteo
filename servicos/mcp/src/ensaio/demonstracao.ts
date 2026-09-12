import { randomBytes } from "node:crypto";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { pedidosFicticios } from "../fontes/ficticia.js";
import { hojeEmSaoPaulo } from "../mcp/data.js";
import { obterCodigo, pedirChaves } from "./fluxo.js";
import { PESSOAS, SENHA_DE_ENSAIO } from "./semente.js";

/**
 * O CAMINHO COMPLETO CONTRA O SERVIDOR RODANDO — com a identidade REAL do
 * Claude Code (o documento CIMD publicado em claude.ai), não um cliente de
 * mentira. Faz login, troca o código, conecta pelo SDK oficial, lista as
 * ferramentas, chama vendas_do_dia e compara com a fonte fictícia somada por
 * fora. Não imprime chave nenhuma.
 *
 *   npm run ensaio:demonstrar -- http://127.0.0.1:8787 2026-09-10
 */

const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const ontem = hojeEmSaoPaulo(new Date(Date.now() - 24 * 60 * 60 * 1000));
const data = process.argv[3] ?? ontem;
const redirectUri = "http://127.0.0.1:53682/callback";
const verificador = randomBytes(40).toString("base64url");

const code = await obterCodigo(base, {
  email: PESSOAS.gerente,
  senha: SENHA_DE_ENSAIO,
  clientId: CLAUDE_CODE,
  redirectUri,
  verificador,
  recurso: `${base}/mcp`,
});
console.log("1. login e consentimento: código recebido");

const { status, corpo } = await pedirChaves(base, {
  grant_type: "authorization_code",
  code,
  redirect_uri: redirectUri,
  client_id: CLAUDE_CODE,
  code_verifier: verificador,
  resource: `${base}/mcp`,
});
if (status !== 200) throw new Error(`troca recusada: ${JSON.stringify(corpo)}`);
console.log(
  `2. chaves emitidas (expira em ${corpo.expires_in} s, escopo ${corpo.scope})`,
);

const cliente = new Client(
  { name: "demonstracao", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
await cliente.connect(
  new StreamableHTTPClientTransport(new URL("/mcp", base), {
    requestInit: {
      headers: { Authorization: `Bearer ${String(corpo.access_token)}` },
    },
  }),
);
console.log(
  `3. conectado (protocolo ${cliente.getNegotiatedProtocolVersion()})`,
);

const { tools } = await cliente.listTools();
console.log(`4. ferramentas: ${tools.map((t) => t.name).join(", ")}`);

const resultado = await cliente.callTool({
  name: "vendas_do_dia",
  arguments: { data },
});
await cliente.close();
const dados = resultado.structuredContent as Record<string, number | string>;
console.log(`5. vendas_do_dia(${data}):`, JSON.stringify(dados));

const pedidos = pedidosFicticios({ unidadeId: "uni_centro", data });
const esperado = pedidos.reduce(
  (soma, pedido) => soma + pedido.valorCentavos,
  0,
);
const confere =
  dados.quantidade_vendas === pedidos.length &&
  dados.total_centavos === esperado;
console.log(
  `6. fonte original: ${pedidos.length} pedidos, ${esperado} centavos → ${confere ? "CONFERE" : "NÃO CONFERE"}`,
);
process.exitCode = confere ? 0 : 1;
