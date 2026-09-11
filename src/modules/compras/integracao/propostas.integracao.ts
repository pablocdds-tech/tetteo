import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { db } from "@/server/db";

import { corpoParaEnvio } from "../services/fila";
import {
  dadosDoLink,
  registrarPeloComprador,
  registrarPeloLink,
} from "../services/propostas";
import { moverRodada } from "../services/rodadas";
import {
  convidar,
  linkParaCopiar,
  reemitirLink,
  revogarLink,
} from "../services/solicitacoes";

import { criarCenario, limparBanco, type Cenario } from "./cenario";
import { respostaBruta, rodadaEmCotacao } from "./fluxo";

process.env.APP_URL ||= "https://app.exemplo.test";

let c: Cenario;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

const daqui = (segundos: number) => new Date(Date.now() + segundos * 1000);

async function convidado() {
  const r = await rodadaEmCotacao(c);
  const a = r.sol(c.fornecedores.a.id);
  const mensagem = await convidar(r.comprador, a.id);
  const link = await linkParaCopiar(r.comprador, a.id);
  return { ...r, a, mensagem, codigo: link.split("#")[1] };
}

describe("o convite e o link", () => {
  test("o código só existe no link — nem no banco, nem na fila", async () => {
    const { a, mensagem, codigo } = await convidado();
    assert.equal(mensagem.estado, "NA_FILA");
    assert.equal(codigo.length, 43);

    const guardada = await db.solicitacaoDeCotacao.findUniqueOrThrow({
      where: { id: a.id },
    });
    assert.notEqual(guardada.tokenHash, codigo);
    assert.ok(!guardada.tokenCifrado!.includes(codigo));
    assert.equal(guardada.status, "CONVIDADO");

    const m = await db.mensagemAoFornecedor.findUniqueOrThrow({
      where: { id: mensagem.mensagemId },
    });
    assert.ok(m.corpo.includes("{{LINK}}"));
    assert.ok(!m.corpo.includes(codigo));
    assert.equal(m.destino, "5500000000001");
    assert.ok((await corpoParaEnvio(m.id)).includes(`#${codigo}`));
  });

  test("a página do fornecedor mostra só o que é dele", async () => {
    const { codigo } = await convidado();
    const r = await dadosDoLink(codigo);
    assert.ok(r.ok);
    const texto = JSON.stringify(r.vista);

    // O Sul pediu molho E óleo; A vende molho, então o Sul aparece — mas só
    // com o molho. Óleo nenhum fornecedor vende.
    assert.deepEqual(r.vista.itens.map((i) => i.nome).sort(), [
      "Molho de tomate",
      "Mussarela",
    ]);
    assert.ok(!texto.includes("Óleo"));
    assert.ok(!texto.includes("Distribuidora Exemplo B"));
    assert.ok(!texto.includes("Laticínio Exemplo"));
    const molho = r.vista.itens.find((i) => i.nome === "Molho de tomate")!;
    assert.deepEqual(molho.porLoja.map((p) => p.loja).sort(), [
      "Loja Exemplo Centro",
      "Loja Exemplo Sul",
    ]);
  });
});

describe("a resposta pelo link", () => {
  test("12 × 900 g vira 10,8 kg no servidor, e a versão 1 fica gravada", async () => {
    const { a, codigo } = await convidado();
    const r = await registrarPeloLink(
      codigo,
      respostaBruta(
        [
          {
            id: a.item("Molho de tomate"),
            pecas: "12",
            conteudo: "900",
            unidadeConteudo: "G",
            preco: "95,40",
          },
          { id: a.item("Mussarela"), situacao: "INDISPONIVEL" },
        ],
        { frete: "25" },
      ),
    );
    assert.deepEqual(r, { ok: true, versao: 1 });

    const ofertas = await db.itemDeProposta.findMany({
      where: { versao: { solicitacaoId: a.id } },
    });
    const molho = ofertas.find(
      (o) => o.itemDaSolicitacaoId === a.item("Molho de tomate"),
    )!;
    assert.equal(molho.fator?.toString(), "10.8");
    assert.equal(molho.precoUnitario?.toString(), "8.833333");
    const muss = ofertas.find(
      (o) => o.itemDaSolicitacaoId === a.item("Mussarela"),
    )!;
    assert.equal(muss.situacao, "INDISPONIVEL");

    const s = await db.solicitacaoDeCotacao.findUniqueOrThrow({
      where: { id: a.id },
    });
    assert.equal(s.status, "RESPONDIDA");
    assert.equal(s.versaoAtual, 1);
  });

  test("nova resposta é versão nova; a anterior não muda", async () => {
    const { a, codigo } = await convidado();
    const molho = a.item("Molho de tomate");
    await registrarPeloLink(
      codigo,
      respostaBruta([{ id: molho, preco: "10" }]),
    );
    const segunda = await registrarPeloLink(
      codigo,
      respostaBruta([{ id: molho, preco: "9,50" }]),
      daqui(11),
    );
    assert.deepEqual(segunda, { ok: true, versao: 2 });

    const versoes = await db.versaoDeProposta.findMany({
      where: { solicitacaoId: a.id },
      include: { itens: true },
      orderBy: { numero: "asc" },
    });
    assert.equal(versoes.length, 2);
    assert.equal(versoes[0].itens[0].precoEmbalagem?.toString(), "10");
    assert.equal(versoes[1].itens[0].precoEmbalagem?.toString(), "9.5");
  });

  test("dois envios em menos de 10 segundos: o segundo espera", async () => {
    const { a, codigo } = await convidado();
    const bruta = respostaBruta([
      { id: a.item("Molho de tomate"), preco: "10" },
    ]);
    await registrarPeloLink(codigo, bruta);
    const r = await registrarPeloLink(codigo, bruta);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.mensagem : "", /Aguarde/);
  });

  test("item de outra solicitação é recusado, e conta como tentativa inválida", async () => {
    const r = await rodadaEmCotacao(c);
    const a = r.sol(c.fornecedores.a.id);
    const b = r.sol(c.fornecedores.b.id);
    await convidar(r.comprador, a.id);
    const codigo = (await linkParaCopiar(r.comprador, a.id)).split("#")[1];

    const res = await registrarPeloLink(
      codigo,
      respostaBruta([{ id: b.item("Molho de tomate"), preco: "1" }]),
    );
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.mensagem : "", /não foi pedido/);
    const s = await db.solicitacaoDeCotacao.findUniqueOrThrow({
      where: { id: a.id },
    });
    assert.equal(s.tentativasInvalidas, 1);
    assert.equal(await db.versaoDeProposta.count(), 0);
  });

  test("preço zero pelo link é recusado", async () => {
    const { a, codigo } = await convidado();
    const r = await registrarPeloLink(
      codigo,
      respostaBruta([{ id: a.item("Molho de tomate"), preco: "0" }]),
    );
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.erros?.[`preco:${a.item("Molho de tomate")}`]);
  });

  test("revogado não aceita; reemitido, o novo vale e o antigo não", async () => {
    const { a, codigo, comprador } = await convidado();
    const bruta = respostaBruta([
      { id: a.item("Molho de tomate"), preco: "10" },
    ]);

    await revogarLink(comprador, a.id, "Mandei para o número errado");
    const revogado = await registrarPeloLink(codigo, bruta);
    assert.match(!revogado.ok ? revogado.mensagem : "", /desativado/);

    await reemitirLink(comprador, a.id);
    const novo = (await linkParaCopiar(comprador, a.id)).split("#")[1];
    assert.notEqual(novo, codigo);
    const antigo = await registrarPeloLink(codigo, bruta);
    assert.match(!antigo.ok ? antigo.mensagem : "", /não é válido/);
    assert.deepEqual(await registrarPeloLink(novo, bruta), {
      ok: true,
      versao: 1,
    });
  });

  test("vencido não aceita", async () => {
    const { a, codigo } = await convidado();
    await db.solicitacaoDeCotacao.update({
      where: { id: a.id },
      data: { tokenExpiraEm: new Date(Date.now() - 1000) },
    });
    const r = await registrarPeloLink(
      codigo,
      respostaBruta([{ id: a.item("Molho de tomate"), preco: "10" }]),
    );
    assert.match(!r.ok ? r.mensagem : "", /prazo/);
    const vista = await dadosDoLink(codigo);
    assert.equal(vista.ok, false);
  });

  test("dez envios inválidos seguidos bloqueiam o link", async () => {
    const { a, codigo } = await convidado();
    for (let i = 0; i < 10; i++) {
      await registrarPeloLink(codigo, { itens: "lixo" });
    }
    const r = await registrarPeloLink(
      codigo,
      respostaBruta([{ id: a.item("Molho de tomate"), preco: "10" }]),
    );
    assert.match(!r.ok ? r.mensagem : "", /bloqueado/);
  });

  test("código que nem parece código não chega ao banco", async () => {
    const r = await registrarPeloLink("../../etc", {});
    assert.equal(r.ok, false);
  });
});

describe("depois de encerrada a cotação", () => {
  test("o link recusa; o comprador só registra como negociação, com motivo", async () => {
    const { a, codigo, comprador, id } = await convidado();
    const molho = a.item("Molho de tomate");
    await registrarPeloLink(
      codigo,
      respostaBruta([{ id: molho, preco: "10" }]),
    );
    await moverRodada(comprador, id, { versao: 3, para: "REVISAO" });

    const pelaPagina = await registrarPeloLink(
      codigo,
      respostaBruta([{ id: molho, preco: "9" }]),
      daqui(11),
    );
    assert.match(!pelaPagina.ok ? pelaPagina.mensagem : "", /encerrada/);

    await assert.rejects(
      () =>
        registrarPeloComprador(
          comprador,
          a.id,
          respostaBruta([{ id: molho, preco: "9" }]),
          {
            origem: "COMPRADOR_DIGITOU",
          },
        ),
      /negociação registrada/,
    );
    await assert.rejects(
      () =>
        registrarPeloComprador(
          comprador,
          a.id,
          respostaBruta([{ id: molho, preco: "9" }]),
          {
            origem: "NEGOCIACAO",
          },
        ),
      /negociação registrada/,
    );

    const ok = await registrarPeloComprador(
      comprador,
      a.id,
      respostaBruta([{ id: molho, preco: "9" }]),
      { origem: "NEGOCIACAO", motivo: "Vendedor baixou por telefone às 16h" },
    );
    assert.deepEqual(ok, { ok: true, versao: 2 });
    const v2 = await db.versaoDeProposta.findUniqueOrThrow({
      where: { solicitacaoId_numero: { solicitacaoId: a.id, numero: 2 } },
    });
    assert.equal(v2.origem, "NEGOCIACAO");
    assert.equal(v2.motivo, "Vendedor baixou por telefone às 16h");
  });
});

describe("pelo comprador", () => {
  test("preço zero exige autorização e motivo", async () => {
    const r = await rodadaEmCotacao(c);
    const a = r.sol(c.fornecedores.a.id);
    const molho = a.item("Molho de tomate");
    const bruta = respostaBruta([{ id: molho, preco: "0" }]);

    const semAutorizar = await registrarPeloComprador(
      r.comprador,
      a.id,
      bruta,
      {
        origem: "COMPRADOR_DIGITOU",
      },
    );
    assert.equal(semAutorizar.ok, false);

    const semMotivo = await registrarPeloComprador(r.comprador, a.id, bruta, {
      origem: "COMPRADOR_DIGITOU",
      autorizarZero: true,
    });
    assert.equal(semMotivo.ok, false);

    const certo = await registrarPeloComprador(r.comprador, a.id, bruta, {
      origem: "COMPRADOR_DIGITOU",
      autorizarZero: true,
      motivo: "Bonificação da semana, combinada com a Carla",
    });
    assert.ok(certo.ok);
    const oferta = await db.itemDeProposta.findFirstOrThrow({
      where: { itemDaSolicitacaoId: molho },
    });
    assert.equal(oferta.precoZeroAutorizado, true);
    assert.equal(oferta.precoZeroPorId, c.comprador.id);
  });
});
