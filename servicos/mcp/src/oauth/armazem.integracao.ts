import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { criarBanco, type Banco } from "../banco/conexao.js";
import { prepararTabelas } from "../banco/tabelas.js";
import {
  criarBancoDeEnsaio,
  urlDeEnsaio,
  type BancoDeEnsaio,
} from "../ensaio/banco-de-ensaio.js";
import { LOJAS, semear } from "../ensaio/semente.js";
import { registroSilencioso } from "../registro.js";
import {
  aprovarConexao,
  buscarChaveDeAcesso,
  criarPedido,
  falhasRecentes,
  lerPedido,
  limparVencidos,
  registrarChamada,
  registrarTentativa,
  renovar,
  revogarConexoesDoUsuario,
  revogarPorChave,
  trocarCodigo,
  type ChavesEmitidas,
} from "./armazem.js";
import { desafioDe } from "./segredos.js";

const pular = urlDeEnsaio()
  ? false
  : "defina MCP_ENSAIO_PG_URL (Postgres local) para rodar";

const RECURSO = "https://mcp.exemplo.com.br/mcp";
const CLIENTE = "https://claude.ai/oauth/ensaio";
const RETORNO = "https://claude.ai/api/mcp/auth_callback";
const VERIFICADOR = "v".repeat(43) + "erificador-de-ensaio";

describe("armazém do OAuth", { skip: pular }, () => {
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

  async function conectar(usuarioId = "usr_gerente", unidadeId = "uni_centro") {
    const codigo = await aprovarConexao(banco, {
      usuarioId,
      unidadeId,
      clientId: CLIENTE,
      clienteNome: "Claude",
      escopos: ["vendas:ler"],
      recurso: RECURSO,
      redirectUri: RETORNO,
      codeChallenge: desafioDe(VERIFICADOR),
    });
    const troca = await trocarCodigo(banco, {
      codigo,
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
    });
    assert.ok(troca.ok, "a troca do código deveria funcionar");
    return { codigo, chaves: troca.chaves };
  }

  const valida = (chaves: ChavesEmitidas) =>
    buscarChaveDeAcesso(banco, chaves.accessToken, RECURSO);

  it("guarda e devolve o pedido só com o id certo e dentro do prazo", async () => {
    const id = await criarPedido(banco, {
      clientId: CLIENTE,
      clienteNome: "Claude",
      redirectUri: RETORNO,
      state: "abc",
      codeChallenge: desafioDe(VERIFICADOR),
      escopos: ["vendas:ler"],
      recurso: RECURSO,
    });
    const pedido = await lerPedido(banco, id);
    assert.equal(pedido?.state, "abc");
    assert.equal(pedido?.redirectUri, RETORNO);
    assert.equal(await lerPedido(banco, "tmcq_inventado"), null);

    await ensaio.admin.query(
      "UPDATE mcp.pedido_autorizacao SET expira_em = now() - interval '1 second'",
    );
    assert.equal(await lerPedido(banco, id), null);
  });

  it("troca o código por chaves e a chave de acesso leva a loja", async () => {
    const { chaves } = await conectar();
    assert.match(chaves.accessToken, /^tmcp_/);
    assert.match(chaves.refreshToken, /^tmcr_/);
    assert.equal(chaves.expiresIn, 3600);

    const chave = await valida(chaves);
    assert.equal(chave?.unidadeId, LOJAS.centro.id);
    assert.equal(chave?.unidadeNome, LOJAS.centro.nome);
    assert.equal(chave?.clientId, CLIENTE);
    assert.equal(
      await buscarChaveDeAcesso(banco, chaves.accessToken, "https://outro/mcp"),
      null,
    );
  });

  it("código usado duas vezes revoga a conexão inteira", async () => {
    const { codigo, chaves } = await conectar();
    const segunda = await trocarCodigo(banco, {
      codigo,
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
    });
    assert.equal(segunda.ok, false);
    assert.equal(await valida(chaves), null);
  });

  it("recusa PKCE errado, outro cliente, outro retorno e código vencido", async () => {
    const aprovar = () =>
      aprovarConexao(banco, {
        usuarioId: "usr_gerente",
        unidadeId: "uni_centro",
        clientId: CLIENTE,
        clienteNome: "Claude",
        escopos: ["vendas:ler"],
        recurso: RECURSO,
        redirectUri: RETORNO,
        codeChallenge: desafioDe(VERIFICADOR),
      });
    const base = {
      clientId: CLIENTE,
      redirectUri: RETORNO,
      verificador: VERIFICADOR,
    };

    for (const troca of [
      { verificador: "x".repeat(43) },
      { clientId: "https://claude.ai/outro" },
      { redirectUri: "https://claude.ai/outro" },
    ]) {
      const resultado = await trocarCodigo(banco, {
        ...base,
        ...troca,
        codigo: await aprovar(),
      });
      assert.equal(resultado.ok, false);
    }

    const vencido = await aprovar();
    await ensaio.admin.query(
      "UPDATE mcp.codigo_autorizacao SET expira_em = now() - interval '1 second' WHERE usado_em IS NULL",
    );
    assert.equal(
      (await trocarCodigo(banco, { ...base, codigo: vencido })).ok,
      false,
    );
  });

  it("renova trocando a chave, e a antiga reapresentada derruba tudo", async () => {
    const { chaves } = await conectar();
    const renovada = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.ok(renovada.ok);
    assert.notEqual(renovada.chaves.refreshToken, chaves.refreshToken);
    assert.ok(await valida(renovada.chaves));

    const reuso = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.equal(reuso.ok, false);
    assert.equal(await valida(renovada.chaves), null);
  });

  it("chave de renovação apresentada por outro cliente revoga a conexão", async () => {
    const { chaves } = await conectar();
    const roubo = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: "https://claude.ai/outro",
    });
    assert.equal(roubo.ok, false);
    assert.equal(await valida(chaves), null);
  });

  it("quem perde a permissão perde a chave na hora", async () => {
    const { chaves } = await conectar();
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'SUSPENSO' WHERE id = 'ac_gerente'`,
    );
    assert.equal(await valida(chaves), null);
    const renovada = await renovar(banco, {
      refreshToken: chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.equal(renovada.ok, false);
    await ensaio.admin.query(
      `UPDATE acesso SET status = 'ATIVO' WHERE id = 'ac_gerente'`,
    );
  });

  it("revoga pela própria chave e por pessoa", async () => {
    const primeira = await conectar();
    await revogarPorChave(banco, {
      token: primeira.chaves.refreshToken,
      clientId: CLIENTE,
    });
    assert.equal(await valida(primeira.chaves), null);

    const segunda = await conectar("usr_dono", "uni_sul");
    assert.ok(await valida(segunda.chaves));
    assert.ok((await revogarConexoesDoUsuario(banco, "DONO@ensaio.test")) >= 1);
    assert.equal(await valida(segunda.chaves), null);
  });

  it("guarda só impressões digitais, nunca a chave em claro", async () => {
    const { chaves } = await conectar();
    const { rows } = await ensaio.admin.query(
      "SELECT hash FROM mcp.token UNION ALL SELECT hash FROM mcp.codigo_autorizacao",
    );
    for (const { hash } of rows as { hash: string }[]) {
      assert.match(hash, /^[0-9a-f]{64}$/);
    }
    assert.ok(
      !rows.some((l: { hash: string }) => l.hash === chaves.accessToken),
    );
  });

  it("conta tentativas falhas por e-mail e por IP", async () => {
    await registrarTentativa(banco, {
      emailHash: "e1",
      ipHash: "i1",
      sucesso: false,
    });
    await registrarTentativa(banco, {
      emailHash: "e1",
      ipHash: "i2",
      sucesso: false,
    });
    await registrarTentativa(banco, {
      emailHash: "e1",
      ipHash: "i1",
      sucesso: true,
    });
    assert.deepEqual(
      await falhasRecentes(banco, { emailHash: "e1", ipHash: "i1" }),
      {
        porEmail: 2,
        porIp: 1,
      },
    );
  });

  it("registra chamadas e limpa o que venceu", async () => {
    await registrarChamada(banco, {
      conexaoId: "cx",
      ferramenta: "vendas_do_dia",
      argumentos: { data: "2026-09-10" },
      resultado: "ok",
      duracaoMs: 3,
    });
    await limparVencidos(banco);
    const { rows } = await ensaio.admin.query(
      "SELECT count(*)::int AS n FROM mcp.chamada",
    );
    assert.equal(rows[0].n, 1);
  });
});
