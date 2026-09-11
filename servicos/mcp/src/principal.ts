import { existsSync } from "node:fs";

import { criarBanco } from "./banco/conexao.js";
import { prepararTabelas } from "./banco/tabelas.js";
import { lerConfig } from "./config.js";
import { criarFonteFicticia } from "./fontes/ficticia.js";
import { criarRegistro } from "./registro.js";
import { criarAplicacao } from "./servidor.js";

/**
 * A SUBIDA DO SERVIDOR MCP.
 *
 * Em desenvolvimento lê `.env.local` (fora do git). Em produção as variáveis
 * vêm do Dokploy — nunca de arquivo.
 *
 * Erros: promessa rejeitada sem tratamento é registrada e o processo segue;
 * exceção não tratada é registrada e o processo SAI, porque depois dela o
 * estado é desconhecido — o contêiner reinicia limpo em segundos. Erro de
 * ferramenta não chega aqui: vira `isError` lá dentro.
 */

if (process.env.NODE_ENV !== "production" && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const registro = criarRegistro();

process.on("unhandledRejection", (motivo) => {
  registro.erro("promessa rejeitada sem tratamento", { erro: motivo });
});
process.on("uncaughtException", (erro) => {
  registro.erro("exceção não tratada — encerrando para reiniciar limpo", {
    erro,
  });
  process.exit(1);
});

const config = lerConfig();
const banco = criarBanco(config.bancoUrl, registro);
await prepararTabelas(banco);

const fonte = criarFonteFicticia();
const { app, handler } = criarAplicacao({ config, banco, fonte, registro });

const servidor = app.listen(config.porta, "0.0.0.0", () => {
  registro.info("servidor MCP no ar", {
    porta: config.porta,
    recurso: config.urlMcp.href,
    fonte: fonte.nome,
  });
});
servidor.requestTimeout = 30_000;
servidor.headersTimeout = 15_000;
servidor.keepAliveTimeout = 65_000;

let encerrando = false;
async function encerrar(sinal: string) {
  if (encerrando) return;
  encerrando = true;
  registro.info("encerrando", { sinal });
  servidor.close();
  await handler.close().catch(() => {});
  await banco.end().catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", () => void encerrar("SIGTERM"));
process.once("SIGINT", () => void encerrar("SIGINT"));
