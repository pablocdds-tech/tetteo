import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { LOJAS, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import { criarBanco, type Banco } from "./conexao.js";
import { prepararTabelas } from "./tabelas.js";
import { buscarUsuarioParaLogin, lojasComVendasVisiveis } from "./tetteo.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const semPermissao = (erro: unknown) =>
  (erro as { code?: string }).code === "42501";

describe("banco do MCP", { skip: pular }, () => {
  let ensaio: BancoDeEnsaio;
  let banco: Banco;

  before(async () => {
    ensaio = await criarBancoDeEnsaio();
    await semear(ensaio.admin);
    banco = criarBanco(ensaio.urlDoServico, registroSilencioso);
    await prepararTabelas(banco);
  });

  after(async () => {
    await banco?.end();
    await ensaio?.encerrar();
  });

  it("o papel tetteo_mcp não lê nenhuma tabela do Tetteo", async () => {
    for (const tabela of [
      "usuario",
      "acesso",
      "unidade",
      "papel_permissao",
      "lancamento",
    ]) {
      await assert.rejects(
        banco.query(`SELECT 1 FROM public.${tabela} LIMIT 1`),
        semPermissao,
        tabela,
      );
    }
  });

  it("não consegue escrever nas visões", async () => {
    await assert.rejects(
      banco.query("UPDATE mcp_leitura.usuario_login SET nome = 'x'"),
      semPermissao,
    );
  });

  it("preparar as tabelas de novo não dá erro", async () => {
    await prepararTabelas(banco);
  });

  it("o login só enxerga pessoa ativa, com e-mail normalizado", async () => {
    const dono = await buscarUsuarioParaLogin(banco, "  DONO@ensaio.test ");
    assert.equal(dono?.id, "usr_dono");
    assert.match(dono?.senhaHash ?? "", /^\$2[aby]\$/);
    assert.equal(
      await buscarUsuarioParaLogin(banco, "suspenso@ensaio.test"),
      null,
    );
    assert.equal(
      await buscarUsuarioParaLogin(banco, "ninguem@ensaio.test"),
      null,
    );
  });

  it("as lojas seguem a regra de permissão do Tetteo", async () => {
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_dono"), [
      LOJAS.centro,
      LOJAS.sul,
    ]);
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_gerente"), [
      LOJAS.centro,
    ]);
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_caixa"), []);
  });

  it("acesso suspenso deixa de valer na hora", async () => {
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'SUSPENSO' WHERE id = 'ac_gerente'`,
    );
    assert.deepEqual(await lojasComVendasVisiveis(banco, "usr_gerente"), []);
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'ATIVO' WHERE id = 'ac_gerente'`,
    );
  });
});
