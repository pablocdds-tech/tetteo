import { config as carregarEnv } from "dotenv";

/**
 * A TRAVA DO ENSAIO — importada PRIMEIRO por todo arquivo desta pasta.
 *
 * O ensaio apaga e recria dados à vontade. Rodado contra o banco errado, ele
 * apagaria a operação de verdade. Por isso ele se recusa a começar se o banco
 * não for, ao mesmo tempo, local e com nome terminado em `_ensaio`.
 *
 * Nenhum valor aqui é de produção. As senhas abaixo são fictícias e só
 * existem para assinar e conferir passes dentro deste processo.
 */

carregarEnv({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL ?? "";
let lida: URL | null = null;
try {
  lida = new URL(url);
} catch {
  lida = null;
}

const local =
  lida !== null && ["localhost", "127.0.0.1", "::1"].includes(lida.hostname);
const deEnsaio =
  lida !== null && lida.pathname.replace("/", "").endsWith("_ensaio");

if (!local || !deEnsaio) {
  throw new Error(
    "O ensaio só roda contra um banco LOCAL com nome terminado em _ensaio. Confira o DATABASE_URL do .env.local.",
  );
}

export const URL_DO_BANCO = url;
export const URL_DO_BANCO_RESTAURADO = url.replace(
  /_ensaio(\?|$)/,
  "_ensaio_restaurado$1",
);

/** Senha fictícia do passe do webhook, só deste processo. */
export const SENHA_DO_WEBHOOK = "senha-do-webhook-de-ensaio-0001";
/** Chave fictícia de instância, para provar que ela nunca aparece gravada. */
export const CHAVE_FICTICIA = "chave-da-instancia-que-nao-pode-vazar-0042";
