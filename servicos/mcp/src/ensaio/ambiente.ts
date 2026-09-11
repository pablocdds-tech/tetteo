import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import { lerConfig, type Config } from "../config.js";
import { criarFonteFicticia } from "../fontes/ficticia.js";
import type { FonteDeVendas } from "../fontes/tipos.js";
import { ErroDeCliente, type ResolverCliente } from "../oauth/cliente.js";
import { criarRegistro } from "../registro.js";
import { criarAplicacao, type DependenciasDoServidor } from "../servidor.js";
import { criarBancoDeEnsaio, type BancoDeEnsaio } from "./banco-de-ensaio.js";
import { obterCodigo, pedirChaves } from "./fluxo.js";
import { PESSOAS, SENHA_DE_ENSAIO, semear } from "./semente.js";

/**
 * O SERVIDOR INTEIRO, DE VERDADE, NUMA PORTA LIVRE — com banco de ensaio, as
 * mesmas proteções de produção e um cliente fictício no lugar do Claude (a
 * busca do CIMD na internet tem teste próprio). Os logs ficam guardados em
 * `linhasDeLog` para o teste conferir que nenhum segredo vazou.
 */

export const CLIENTE_DE_ENSAIO = "https://claude.ai/oauth/ensaio";
const RETORNO = "http://127.0.0.1:4555/callback";

const clienteDeEnsaio: ResolverCliente = async (clientId) => {
  if (clientId !== CLIENTE_DE_ENSAIO) {
    throw new ErroDeCliente("Cliente desconhecido.");
  }
  return {
    clientId,
    nome: "Claude de ensaio",
    redirectUris: ["http://127.0.0.1/callback"],
  };
};

export type Ambiente = {
  base: string;
  config: Config;
  ensaio: BancoDeEnsaio;
  banco: Banco;
  linhasDeLog: string[];
  encerrar(): Promise<void>;
};

// Nos testes, dezenas de logins seguidos saem do mesmo IP: limite alto, a não
// ser que o próprio teste queira ver o 429.
const SEM_LIMITE = { maximo: 100_000, janelaMs: 60_000 };

export async function subirAmbiente(
  opcoes: {
    fonte?: FonteDeVendas;
    tempoMaximoMs?: number;
    limites?: DependenciasDoServidor["limites"];
  } = {},
): Promise<Ambiente> {
  const ensaio = await criarBancoDeEnsaio();
  await semear(ensaio.admin);
  const linhasDeLog: string[] = [];
  const registro = criarRegistro((linha) => linhasDeLog.push(linha));
  const banco = criarBanco(ensaio.urlDoServico, registro);
  await prepararTabelas(banco);

  // Primeiro a porta, depois a configuração: a URL pública precisa dela.
  const servidor = createServer();
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const config = lerConfig({
    NODE_ENV: "test",
    DATABASE_URL: ensaio.urlDoServico,
    MCP_URL_PUBLICA: base,
  });
  const { app, handler } = criarAplicacao({
    config,
    banco,
    fonte: opcoes.fonte ?? criarFonteFicticia(),
    registro,
    resolverCliente: clienteDeEnsaio,
    agora: () => new Date("2026-09-11T15:00:00Z"),
    tempoMaximoMs: opcoes.tempoMaximoMs,
    limites: {
      autorizar: SEM_LIMITE,
      token: SEM_LIMITE,
      saude: SEM_LIMITE,
      ...opcoes.limites,
    },
  });
  servidor.on("request", app);

  return {
    base,
    config,
    ensaio,
    banco,
    linhasDeLog,
    async encerrar() {
      servidor.close();
      await handler.close();
      await banco.end();
      await ensaio.encerrar();
    },
  };
}

export async function chavesPara(
  ambiente: Ambiente,
  email: string = PESSOAS.gerente,
  unidade?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const verificador = randomBytes(40).toString("base64url");
  const code = await obterCodigo(ambiente.base, {
    email,
    senha: SENHA_DE_ENSAIO,
    clientId: CLIENTE_DE_ENSAIO,
    redirectUri: RETORNO,
    verificador,
    recurso: ambiente.config.urlMcp.href,
    unidade,
  });
  const { corpo } = await pedirChaves(ambiente.base, {
    grant_type: "authorization_code",
    code,
    redirect_uri: RETORNO,
    client_id: CLIENTE_DE_ENSAIO,
    code_verifier: verificador,
  });
  return {
    accessToken: String(corpo.access_token),
    refreshToken: String(corpo.refresh_token),
  };
}
