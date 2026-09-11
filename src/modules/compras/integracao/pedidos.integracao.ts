import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { SemPermissao } from "@/lib/erros";
import { db } from "@/server/db";

import { salvarAlcada } from "../services/alcadas";
import { criarAdendo, criarAlteracao } from "../services/alteracoes";
import { aplicarSugestao, escolher } from "../services/comparacao";
import {
  AcimaDaAlcada,
  PedidoMudou,
  ajustarItemPendente,
  aprovarPedido,
  gerarPedidos,
  listarPedidos,
  obterPedido,
} from "../services/pedidos";
import { registrarPeloComprador } from "../services/propostas";
import { moverRodada } from "../services/rodadas";

import { criarCenario, limparBanco, type Cenario } from "./cenario";
import { respostaBruta, rodadaEmCotacao } from "./fluxo";

let c: Cenario;

beforeEach(async () => {
  await limparBanco();
  c = await criarCenario();
});

after(async () => {
  await db.$disconnect();
});

/**
 * A: molho em caixa 12 × 900 g por R$ 95,40, mussarela em peça de 1 kg por
 * R$ 32, frete R$ 25. B: molho em caixa de 10 kg por R$ 300, frete zero.
 * Centro pede 20 kg de molho e 10 de mussarela; Sul pede 5 de molho e 6 L de
 * óleo — que ninguém vende.
 */
async function emRevisao() {
  const r = await rodadaEmCotacao(c);
  const a = r.sol(c.fornecedores.a.id);
  const b = r.sol(c.fornecedores.b.id);
  await registrarPeloComprador(
    r.comprador,
    a.id,
    respostaBruta(
      [
        {
          id: a.item("Molho de tomate"),
          pecas: "12",
          conteudo: "900",
          unidadeConteudo: "G",
          preco: "95,40",
        },
        {
          id: a.item("Mussarela"),
          nomeEmbalagem: "Peça",
          pecas: "1",
          conteudo: "1",
          unidadeConteudo: "KG",
          preco: "32",
        },
      ],
      { frete: "25" },
    ),
    { origem: "COMPRADOR_DIGITOU" },
  );
  await registrarPeloComprador(
    r.comprador,
    b.id,
    respostaBruta(
      [
        {
          id: b.item("Molho de tomate"),
          pecas: "1",
          conteudo: "10",
          unidadeConteudo: "KG",
          preco: "300",
        },
      ],
      { frete: "0" },
    ),
    { origem: "COMPRADOR_DIGITOU" },
  );
  await moverRodada(r.comprador, r.id, { versao: 3, para: "REVISAO" });
  const oleo = await db.itemDaRodada.findFirstOrThrow({
    where: { rodadaId: r.id, insumoId: c.insumos.oleo.id },
  });
  const molho = await db.itemDaRodada.findFirstOrThrow({
    where: { rodadaId: r.id, insumoId: c.insumos.molho.id },
  });
  return { ...r, a, b, oleoId: oleo.id, molhoId: molho.id };
}

async function comPedidos() {
  const r = await emRevisao();
  await aplicarSugestao(r.comprador, r.id);
  await gerarPedidos(r.comprador, r.id, { ignorar: [r.oleoId] });
  const pedidos = await db.pedido.findMany({ include: { itens: true } });
  const centro = pedidos.find((p) => p.unidadeId === c.centro.id)!;
  const sul = pedidos.find((p) => p.unidadeId === c.sul.id)!;
  const diretor = await c.ctx(c.diretor, null);
  return { ...r, centro, sul, diretor };
}

describe("gerar pedidos", () => {
  test("um por loja × fornecedor, com snapshot e total conferido", async () => {
    const { centro, sul } = await comPedidos();
    assert.equal(await db.pedido.count(), 2);

    assert.equal(centro.status, "AGUARDANDO_APROVACAO");
    assert.equal(centro.fornecedorNome, "Distribuidora Exemplo A");
    assert.equal(centro.total.toString(), "535.8"); // 190,80 + 320 + 25
    assert.equal(sul.total.toString(), "120.4"); // 95,40 + 25

    const molho = centro.itens.find((i) => i.insumoNome === "Molho de tomate")!;
    assert.equal(molho.embalagens.toString(), "2");
    assert.equal(molho.quantidade.toString(), "21.6");
    assert.equal(molho.adicional.toString(), "1.6");
    assert.match(molho.origemPreco, /Proposta v1/);

    // Mudar o cadastro depois NÃO reescreve o pedido.
    await db.fornecedor.update({
      where: { id: c.fornecedores.a.id },
      data: { nome: "Nome Novo Ltda", telefonePedidos: "5500000000077" },
    });
    await db.itemDeProposta.updateMany({ data: { precoEmbalagem: "1" } });
    const depois = await db.pedido.findUniqueOrThrow({
      where: { id: centro.id },
      include: { itens: true },
    });
    assert.equal(depois.fornecedorNome, "Distribuidora Exemplo A");
    assert.equal(depois.total.toString(), "535.8");
    assert.equal(
      depois.itens
        .find((i) => i.insumoNome === "Molho de tomate")!
        .precoEmbalagem.toString(),
      "95.4",
    );
  });

  test("item sem fornecedor escolhido não vira pedido — o sistema diz qual", async () => {
    const r = await emRevisao();
    await aplicarSugestao(r.comprador, r.id);
    await assert.rejects(() => gerarPedidos(r.comprador, r.id), /Óleo de soja/);
  });

  test("gerar duas vezes não duplica", async () => {
    const r = await comPedidos();
    await assert.rejects(
      () => gerarPedidos(r.comprador, r.id, { ignorar: [r.oleoId] }),
      /já foram gerados/,
    );
    assert.equal(await db.pedido.count(), 2);
  });

  test("escolher fora da sugestão exige justificativa", async () => {
    const r = await emRevisao();
    await aplicarSugestao(r.comprador, r.id);
    await assert.rejects(
      () =>
        escolher(r.comprador, r.id, {
          itemDaRodadaId: r.molhoId,
          fornecedorId: c.fornecedores.b.id,
          justificativa: null,
        }),
      /diferente da sugestão/,
    );
    await escolher(r.comprador, r.id, {
      itemDaRodadaId: r.molhoId,
      fornecedorId: c.fornecedores.b.id,
      justificativa: "A marca do A não passou no teste da massa",
    });
    const escolha = await db.escolhaDeItem.findUniqueOrThrow({
      where: { itemDaRodadaId: r.molhoId },
    });
    assert.equal(escolha.seguiuSugestao, false);
    assert.equal(escolha.fornecedorId, c.fornecedores.b.id);
  });
});

describe("aprovar", () => {
  test("duas aprovações ao mesmo tempo: uma passa, e sai uma mensagem só", async () => {
    const { centro, diretor } = await comPedidos();
    const resultado = await Promise.allSettled([
      aprovarPedido(diretor, centro.id, 1),
      aprovarPedido(diretor, centro.id, 1),
    ]);
    assert.equal(resultado.filter((r) => r.status === "fulfilled").length, 1);
    const recusa = resultado.find((r) => r.status === "rejected");
    assert.ok(recusa && recusa.reason instanceof PedidoMudou);

    assert.equal(
      await db.mensagemAoFornecedor.count({
        where: { referenciaId: centro.id },
      }),
      1,
    );
    assert.equal(
      await db.aprovacaoDeCompra.count({ where: { pedidoId: centro.id } }),
      1,
    );
  });

  test("a alçada é conferida no servidor — inclusive para o Diretor", async () => {
    const { sul, diretor, comprador } = await comPedidos();

    // Comprador não tem compras.aprovar.
    await assert.rejects(
      () => aprovarPedido(comprador, sul.id, 1),
      SemPermissao,
    );

    // Um Aprovador com alçada de R$ 100 não aprova R$ 120,40.
    const papel = await db.papel.create({
      data: {
        organizacaoId: c.org.id,
        nome: "Aprovador",
        permissoes: {
          create: [{ chave: "compras.ver" }, { chave: "compras.aprovar" }],
        },
      },
    });
    const pessoa = await db.usuario.create({
      data: {
        nome: "Aprovador Exemplo",
        email: `aprovador.${Date.now()}@exemplo.test`,
        status: "ATIVO",
      },
    });
    await db.acesso.create({
      data: {
        usuarioId: pessoa.id,
        organizacaoId: c.org.id,
        unidadeId: null,
        papelId: papel.id,
      },
    });
    await salvarAlcada(diretor, papel.id, "100,00");
    const aprovador = await c.ctx(pessoa, null);
    await assert.rejects(
      () => aprovarPedido(aprovador, sul.id, 1),
      AcimaDaAlcada,
    );

    // Com alçada cadastrada para o papel dele, o Diretor também obedece.
    await salvarAlcada(diretor, c.papeis.Diretor, "50,00");
    await assert.rejects(
      () => aprovarPedido(diretor, sul.id, 1),
      AcimaDaAlcada,
    );
    await salvarAlcada(diretor, c.papeis.Diretor, null);
    await aprovarPedido(diretor, sul.id, 1);

    const aprovacao = await db.aprovacaoDeCompra.findFirstOrThrow({
      where: { pedidoId: sul.id },
    });
    assert.equal(aprovacao.alcadaVersao, 2);
  });

  test("ajuste muda a versão: aprovar a versão velha é recusado; aprovado, não se edita", async () => {
    const { centro, diretor, comprador } = await comPedidos();
    const molho = centro.itens.find((i) => i.insumoNome === "Molho de tomate")!;

    await ajustarItemPendente(comprador, centro.id, molho.id, "3");
    await assert.rejects(
      () => aprovarPedido(diretor, centro.id, 1),
      PedidoMudou,
    );
    await aprovarPedido(diretor, centro.id, 2);

    await assert.rejects(
      () => ajustarItemPendente(comprador, centro.id, molho.id, "4"),
      /não se edita/,
    );
    const depois = await db.pedido.findUniqueOrThrow({
      where: { id: centro.id },
    });
    assert.equal(depois.total.toString(), "631.2"); // 3 × 95,40 + 320 + 25
  });

  test("outra loja não vê o pedido", async () => {
    const { centro } = await comPedidos();
    const gerenteSul = await c.ctx(c.gerenteSul, c.sul);
    const lista = await listarPedidos(gerenteSul);
    assert.deepEqual(
      lista.map((p) => p.loja),
      ["Loja Exemplo Sul"],
    );
    assert.equal(await obterPedido(gerenteSul, centro.id), null);
  });

  test("decidido o último, a rodada vai para envio", async () => {
    const { centro, sul, diretor, id } = await comPedidos();
    await aprovarPedido(diretor, centro.id, 1);
    let rodada = await db.rodadaDeCompra.findUniqueOrThrow({ where: { id } });
    assert.equal(rodada.estado, "REVISAO");
    await aprovarPedido(diretor, sul.id, 1);
    rodada = await db.rodadaDeCompra.findUniqueOrThrow({ where: { id } });
    assert.equal(rodada.estado, "DESPACHANDO");
  });
});

describe("depois de aprovado", () => {
  test("adendo leva só o novo, com a sequência seguinte e mensagem própria", async () => {
    const { centro, diretor, comprador } = await comPedidos();
    await aprovarPedido(diretor, centro.id, 1);

    const adendoId = await criarAdendo(
      comprador,
      centro.id,
      [{ insumoId: c.insumos.molho.id, necessario: "5" }],
      "Faltou para o sábado",
    );
    const adendo = await db.pedido.findUniqueOrThrow({
      where: { id: adendoId },
      include: { itens: true },
    });
    assert.equal(adendo.tipo, "ADENDO");
    assert.equal(adendo.sequencia, 2);
    assert.equal(adendo.pedidoOrigemId, centro.id);
    assert.equal(adendo.itens.length, 1);
    assert.equal(adendo.itens[0].embalagens.toString(), "1");
    assert.match(adendo.itens[0].origemPreco, /Mesmo preço/);

    await aprovarPedido(diretor, adendoId, 1);
    const m = await db.mensagemAoFornecedor.findFirstOrThrow({
      where: { referenciaId: adendoId },
    });
    assert.equal(m.chave, `pedido:${adendoId}:2`);
    assert.equal(m.tipo, "ADENDO");
    assert.match(m.corpo, /Adendo PC-\d{4}\/2/);
    assert.doesNotMatch(m.corpo, /Mussarela/);

    const original = await db.pedido.findUniqueOrThrow({
      where: { id: centro.id },
    });
    assert.equal(original.ultimaSequencia, 2);
  });

  test("alteração só diminui; duas ao mesmo tempo ganham sequências diferentes", async () => {
    const { centro, diretor, comprador } = await comPedidos();
    await aprovarPedido(diretor, centro.id, 1);
    const molho = centro.itens.find((i) => i.insumoNome === "Molho de tomate")!;
    const mussarela = centro.itens.find((i) => i.insumoNome === "Mussarela")!;

    await assert.rejects(
      () =>
        criarAlteracao(comprador, centro.id, {
          tipo: "ALTERACAO",
          linhas: [{ itemDePedidoId: molho.id, embalagensDepois: "3" }],
          motivo: "Mais movimento",
        }),
      /adendo/,
    );

    await Promise.all([
      criarAlteracao(comprador, centro.id, {
        tipo: "ALTERACAO",
        linhas: [{ itemDePedidoId: molho.id, embalagensDepois: "1" }],
        motivo: "Chegou molho de outra loja",
      }),
      criarAlteracao(comprador, centro.id, {
        tipo: "ALTERACAO",
        linhas: [{ itemDePedidoId: mussarela.id, embalagensDepois: "8" }],
        motivo: "Cardápio do fim de semana mudou",
      }),
    ]);
    const alteracoes = await db.alteracaoDePedido.findMany({
      where: { pedidoId: centro.id },
    });
    assert.deepEqual(alteracoes.map((a) => a.sequencia).sort(), [2, 3]);

    const mensagens = await db.mensagemAoFornecedor.findMany({
      where: { tipo: "ALTERACAO" },
    });
    assert.equal(mensagens.length, 2);
    assert.ok(mensagens.some((m) => /de 2 caixa para 1 caixa/.test(m.corpo)));

    const item = await db.itemDePedido.findUniqueOrThrow({
      where: { id: molho.id },
    });
    assert.equal(item.quantidadeCancelada.toString(), "10.8");
  });

  test("cancelar o que já foi aprovado vai ao fornecedor como cancelamento", async () => {
    const { sul, diretor, comprador } = await comPedidos();
    await aprovarPedido(diretor, sul.id, 1);
    await criarAlteracao(comprador, sul.id, {
      tipo: "CANCELAMENTO",
      linhas: [],
      motivo: "A loja fecha para reforma",
    });
    const pedido = await db.pedido.findUniqueOrThrow({ where: { id: sul.id } });
    assert.equal(pedido.status, "CANCELADO");
    const m = await db.mensagemAoFornecedor.findFirstOrThrow({
      where: { tipo: "CANCELAMENTO" },
    });
    assert.match(m.corpo, /cancelado/i);
  });
});
