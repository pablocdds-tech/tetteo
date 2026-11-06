import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { extracaoVazia } from "@/server/notas/extracao";
import { criarManipuladorRascunhos } from "./manipulador";

const ctx: ContextoSessao = {
  usuario: {
    id: "usuario",
    nome: "Pessoa fictícia",
    email: "pessoa@example.test",
    avatarUrl: null,
  },
  organizacao: { id: "org", nome: "Teste" },
  unidadeAtiva: { id: "loja", nome: "Loja fictícia", codigo: "QA" },
  unidadesVisiveis: [{ id: "loja", nome: "Loja fictícia", codigo: "QA" }],
  podeVerRedeInteira: false,
  permissoes: new Set(),
  ehDiretor: false,
};
const documento = {
  id: "rascunho",
  revisao: 0,
  arquivoId: null,
  dados: extracaoVazia(),
  pendencias: [],
  avisos: [],
};
function fixture(opcoes: { autenticado?: boolean; autorizado?: boolean } = {}) {
  let recebidos = 0;
  const handle = criarManipuladorRascunhos({
    contexto: async () => (opcoes.autenticado === false ? null : ctx),
    autorizar: async (_ctx, unidadeId) => {
      if (opcoes.autorizado === false || unidadeId !== "loja")
        throw new SemPermissao("editar rascunhos");
      return {
        organizacaoId: "org",
        unidadeId,
        usuarioId: "usuario",
        instanciaId: "WEB",
      };
    },
    receber: async () => {
      recebidos++;
      return documento;
    },
    salvar: async () => documento,
    obter: async () => documento,
    listar: async () => [],
  });
  return { handle, recebidos: () => recebidos };
}
function pedido(
  method: string,
  body?: BodyInit,
  unidadeId = "loja",
  origin = "http://localhost:3000",
) {
  return new Request("http://localhost:3000/api/notas/rascunhos", {
    method,
    body,
    headers: { origin, "x-unidade-id": unidadeId },
  });
}
test("API exige sessão, autorização, unidade ativa e origem antes de receber arquivos", async () => {
  for (const [opcoes, status] of [
    [{ autenticado: false }, 401],
    [{ autorizado: false }, 403],
  ] as const)
    assert.equal((await fixture(opcoes).handle(pedido("POST"))).status, status);
  const f = fixture();
  assert.equal(
    (await f.handle(pedido("POST", undefined, "outra"))).status,
    403,
  );
  assert.equal(
    (
      await f.handle(
        pedido("POST", undefined, "loja", "https://externo.example.test"),
      )
    ).status,
    403,
  );
  assert.equal(f.recebidos(), 0);
});
test("API aceita upload e impede cache dos dados fiscais", async () => {
  const f = fixture();
  const form = new FormData();
  form.set("operacaoId", randomUUID());
  form.set("arquivo", new File(["<NFe/>"], "ficticia.xml"));
  const r = await f.handle(pedido("POST", form));
  assert.equal(r.status, 200);
  assert.equal(f.recebidos(), 1);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
});
test("API trata JSON inválido e recusa unidade adulterada no salvamento", async () => {
  const f = fixture();
  assert.equal((await f.handle(pedido("PATCH", "{"))).status, 400);
  assert.equal(
    (await f.handle(pedido("PATCH", JSON.stringify({ unidadeId: "outra" }))))
      .status,
    403,
  );
});
test("API limita o corpo pelo stream, mesmo sem content-length", async () => {
  const r = await fixture().handle(pedido("PATCH", "x".repeat(180_001)));
  assert.equal(r.status, 409);
});
test("falhas internas nunca expõem dados do documento ou credenciais", async () => {
  const handle = criarManipuladorRascunhos({
    contexto: async () => {
      throw Error("segredo-sintetico payload-fiscal");
    },
    autorizar: async () => {
      throw Error();
    },
    receber: async () => documento,
    salvar: async () => documento,
    obter: async () => documento,
    listar: async () => [],
  });
  const r = await handle(pedido("GET"));
  assert.equal(r.status, 500);
  assert.doesNotMatch(await r.text(), /segredo|payload/);
});
