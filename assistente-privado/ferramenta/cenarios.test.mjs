import assert from "node:assert/strict";
import { test } from "node:test";

import { lerCsv } from "./csv.mjs";
import { calcularFechamento } from "./fechamento.mjs";
import { gerarDados } from "./gerar-dados-exemplo.mjs";

const HOJE = "2026-09-11";
const fechar = (texto) =>
  calcularFechamento({ ...lerCsv(texto), loja: "Loja Centro", hoje: HOJE });

test("gera os cinco arquivos, sempre iguais para o mesmo dia", () => {
  const arquivos = gerarDados(HOJE);
  assert.deepEqual(Object.keys(arquivos).sort(), [
    "vendas-30-dias.csv",
    "vendas-com-problemas.csv",
    "vendas-desatualizado.csv",
    "vendas-sem-pedidos.csv",
    "vendas-vazio.csv",
  ]);
  assert.deepEqual(gerarDados(HOJE), arquivos);
});

test("caso normal: a soma bate com uma conta independente", () => {
  const texto = gerarDados(HOJE)["vendas-30-dias.csv"];
  const r = fechar(texto);

  // Outra implementação, de propósito ingênua: divide por ";" e lê o número
  // brasileiro trocando separadores. Se as duas discordarem, uma está errada.
  let total = 0;
  let pedidos = 0;
  for (const linha of texto.trim().split("\n").slice(1)) {
    const [, loja, p, v] = linha.split(";");
    if (loja !== "Loja Centro") continue;
    pedidos += Number(p);
    total += Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
  }

  assert.equal(r.totalCentavos, total);
  assert.equal(r.pedidos, pedidos);
  assert.equal(r.ticketCentavos, Math.round(total / pedidos));
  assert.deepEqual(r.periodo, { de: "2026-08-12", ate: "2026-09-10" });
  assert.equal(r.diasNoPeriodo, 30);
  assert.equal(r.diasComVenda, 29);
  assert.equal(r.linhasLidas, 59);
  assert.equal(r.linhasDeOutraLoja, 30);
  assert.equal(r.desatualizado, false);
  // Severidade antes de data (Item 3): fora_do_comum é mais grave que
  // dia_sem_linha, mesmo tendo acontecido depois.
  assert.deepEqual(
    r.anomalias.map((a) => `${a.tipo}:${a.data}`),
    ["fora_do_comum:2026-09-03", "dia_sem_linha:2026-08-24"],
  );
});

test("arquivo com problemas: descarta com motivo, acha negativo e repetido, não repete a instrução", () => {
  const texto = gerarDados(HOJE)["vendas-com-problemas.csv"];
  const leitura = lerCsv(texto);
  assert.deepEqual(
    leitura.descartadas.map((d) => d.motivo),
    ["linha incompleta", "data inválida", "pedidos inválido"],
  );
  const r = fechar(texto);
  const tipos = r.anomalias.map((a) => a.tipo);
  assert.ok(tipos.includes("valor_negativo"));
  assert.ok(tipos.includes("data_repetida"));
  assert.ok(r.observacoes.some((o) => o.suspeita));
  const tudo = JSON.stringify(r);
  assert.ok(!tudo.includes("SENHA-FALSA-123"));
  assert.ok(!tudo.includes("transfira"));
});

test("desatualizado avisa; sem pedidos não inventa ticket; vazio é sem_dados", () => {
  const d = gerarDados(HOJE);
  const velho = fechar(d["vendas-desatualizado.csv"]);
  assert.equal(velho.ultimaData, "2026-09-01");
  assert.equal(velho.desatualizado, true);

  const semPedidos = fechar(d["vendas-sem-pedidos.csv"]);
  assert.equal(semPedidos.pedidos, 0);
  assert.ok(semPedidos.totalCentavos > 0);
  assert.equal(semPedidos.ticketCentavos, null);

  assert.equal(fechar(d["vendas-vazio.csv"]).estado, "sem_dados");
});
