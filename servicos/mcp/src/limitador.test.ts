import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { criarLimitador } from "./limitador.js";

function chamar(limitador: RequestHandler, ip: string) {
  let passou = false;
  let status = 200;
  const cabecalhos: Record<string, string> = {};
  const req = { ip } as unknown as Request;
  const res = {
    set(nome: string, valor: string) {
      cabecalhos[nome.toLowerCase()] = valor;
      return this;
    },
    status(codigo: number) {
      status = codigo;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  void limitador(req, res, (() => {
    passou = true;
  }) as NextFunction);
  return { passou, status, cabecalhos };
}

describe("limitador por IP", () => {
  it("deixa passar até o máximo e depois responde 429 com Retry-After", () => {
    const limitador = criarLimitador({ maximo: 2, janelaMs: 60_000 }, () => 0);
    assert.equal(chamar(limitador, "1.1.1.1").passou, true);
    assert.equal(chamar(limitador, "1.1.1.1").passou, true);
    const terceira = chamar(limitador, "1.1.1.1");
    assert.equal(terceira.passou, false);
    assert.equal(terceira.status, 429);
    assert.equal(terceira.cabecalhos["retry-after"], "60");
  });

  it("conta cada IP separado", () => {
    const limitador = criarLimitador({ maximo: 1, janelaMs: 60_000 }, () => 0);
    assert.equal(chamar(limitador, "1.1.1.1").passou, true);
    assert.equal(chamar(limitador, "2.2.2.2").passou, true);
    assert.equal(chamar(limitador, "1.1.1.1").passou, false);
  });

  it("zera a contagem quando a janela passa", () => {
    let agora = 0;
    const limitador = criarLimitador(
      { maximo: 1, janelaMs: 60_000 },
      () => agora,
    );
    assert.equal(chamar(limitador, "1.1.1.1").passou, true);
    assert.equal(chamar(limitador, "1.1.1.1").passou, false);
    agora = 60_000;
    assert.equal(chamar(limitador, "1.1.1.1").passou, true);
  });
});
