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

// A resposta em andamento não pode ser cortada quando a entrada fecha: o
// contador de pendentes segura a saída até a última escrita terminar.
let pendentes = 0;
let entradaFechada = false;
const sairSePuder = () => {
  if (entradaFechada && pendentes === 0) process.exit(0);
};

// Espera o flush: no Windows, a escrita num pipe ainda pode estar em
// andamento quando o process.exit roda.
const escrever = (objeto) =>
  new Promise((resolve) =>
    process.stdout.write(`${JSON.stringify(objeto)}\n`, resolve),
  );

leitor.on("line", async (linha) => {
  if (!linha.trim()) return;
  // A contagem começa na LINHA, não na mensagem: a resposta de JSON inválido
  // também não pode ser cortada quando a entrada fecha logo depois.
  pendentes++;
  try {
    let mensagem;
    try {
      mensagem = JSON.parse(linha);
    } catch {
      await escrever({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "JSON inválido" },
      });
      return;
    }
    const resposta = await tratar(mensagem);
    if (resposta) await escrever(resposta);
  } finally {
    pendentes--;
    sairSePuder();
  }
});

leitor.on("close", () => {
  entradaFechada = true;
  sairSePuder();
  // Rede de segurança: uma chamada travada não pode manter o processo vivo
  // para sempre depois que a entrada fechou.
  setTimeout(() => process.exit(0), 30_000).unref();
});
