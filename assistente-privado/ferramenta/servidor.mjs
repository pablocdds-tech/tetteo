#!/usr/bin/env node
import { createInterface } from "node:readline";

import { criarFerramentas, lerConfiguracao } from "./ferramentas.mjs";
import { criarProtocolo } from "./protocolo.mjs";

/**
 * O PONTO DE ENTRADA — o gateway do OpenClaw inicia este arquivo como filho.
 *
 * stdout é SÓ do protocolo. Diagnóstico vai para stderr, e nunca com valor
 * de variável: o gateway guarda stderr nos logs dele.
 */

const ferramentas = criarFerramentas(lerConfiguracao());
const tratar = criarProtocolo({
  nome: "fechamento",
  versao: "1.0.0",
  ferramentas,
  registrarErro: (e) =>
    process.stderr.write(`fechamento: erro interno (${e?.name ?? "Erro"})\n`),
});

const leitor = createInterface({ input: process.stdin, crlfDelay: Infinity });

leitor.on("line", async (linha) => {
  if (!linha.trim()) return;
  let mensagem;
  try {
    mensagem = JSON.parse(linha);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } })}\n`,
    );
    return;
  }
  const resposta = await tratar(mensagem);
  if (resposta) process.stdout.write(`${JSON.stringify(resposta)}\n`);
});

leitor.on("close", () => process.exit(0));
