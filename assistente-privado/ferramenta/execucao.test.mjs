import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  EmAndamento,
  LIMITE_PARA_INTERROMPIDO_MS,
  VENCIMENTO_DA_TRAVA_MS,
  caminhos,
  chaveDaExecucao,
  comTrava,
  estadoAtual,
  gravarDados,
  gravarRelatorio,
  lerExecucao,
  marcarEstado,
} from "./execucao.mjs";

const pasta = () => mkdtemp(path.join(os.tmpdir(), "fechamento-"));

test("mesma entrada, mesma chave; qualquer mudança, outra chave", () => {
  const base = {
    conteudo: Buffer.from("a;b\n"),
    loja: "Loja Centro",
    de: "2026-09-01",
    ate: "2026-09-10",
  };
  const chave = chaveDaExecucao(base);
  assert.match(chave, /^[a-f0-9]{16}$/);
  assert.equal(chaveDaExecucao({ ...base }), chave);
  assert.notEqual(
    chaveDaExecucao({ ...base, conteudo: Buffer.from("a;c\n") }),
    chave,
  );
  assert.notEqual(chaveDaExecucao({ ...base, ate: "2026-09-11" }), chave);
  assert.notEqual(chaveDaExecucao({ ...base, loja: "Loja Norte" }), chave);
});

test("estado: calculado, interrompido, cancelado, concluído", async () => {
  const p = await pasta();
  const agora = new Date("2026-09-11T12:00:00Z");
  await gravarDados(p, "k1", {
    estado: "calculado",
    calculadoEm: agora.toISOString(),
  });
  let e = await lerExecucao(p, "k1");
  assert.equal(estadoAtual(e, new Date(agora.getTime() + 60_000)), "calculado");
  assert.equal(
    estadoAtual(e, new Date(agora.getTime() + LIMITE_PARA_INTERROMPIDO_MS + 1)),
    "interrompido",
  );
  await marcarEstado(p, "k1", "cancelado", agora);
  e = await lerExecucao(p, "k1");
  assert.equal(estadoAtual(e, agora), "cancelado");
  await gravarRelatorio(p, "k1", "texto");
  e = await lerExecucao(p, "k1");
  assert.equal(estadoAtual(e, agora), "concluido");
  assert.equal(estadoAtual(await lerExecucao(p, "nao-existe"), agora), null);
});

test("trava: a segunda simultânea recusa; depois libera; trava vencida é trocada", async () => {
  const p = await pasta();
  let liberar;
  const primeira = comTrava(p, "k2", () => new Promise((r) => (liberar = r)));
  await new Promise((r) => setTimeout(r, 30));
  await assert.rejects(
    comTrava(p, "k2", async () => "não devia rodar"),
    EmAndamento,
  );
  liberar("ok");
  assert.equal(await primeira, "ok");
  assert.equal(await comTrava(p, "k2", async () => "de novo"), "de novo");

  const { trava } = caminhos(p, "k3");
  await mkdir(path.dirname(trava), { recursive: true });
  await writeFile(trava, "");
  const velho = new Date(Date.now() - VENCIMENTO_DA_TRAVA_MS - 5_000);
  await utimes(trava, velho, velho);
  assert.equal(await comTrava(p, "k3", async () => "trocou"), "trocou");
});
