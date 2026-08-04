import assert from "node:assert/strict";
import { test } from "node:test";

import {
  verificarDesativacaoDeUnidade,
  verificarEdicaoDePapel,
  verificarExclusaoDePapel,
  verificarRemocaoDeAcesso,
  verificarTrocaDePapel,
  type AcessoParaTrava,
} from "./travas";

/**
 * Cada caso abaixo é uma forma de trancar alguém do lado de fora do próprio
 * sistema. O conserto seria mexer no banco à mão — de madrugada, com a
 * pizzaria aberta.
 */

const acesso = (
  id: string,
  usuarioId: string,
  coringa: boolean,
  status: "ATIVO" | "SUSPENSO" = "ATIVO",
): AcessoParaTrava => ({ id, usuarioId, status, papelTemCoringa: coringa });

const pablo = acesso("a1", "u-pablo", true);
const juliana = acesso("a2", "u-juliana", true);
const caixa = acesso("a3", "u-caixa", false);

test("ninguém remove o próprio acesso", () => {
  const erro = verificarRemocaoDeAcesso(pablo, "u-pablo", [
    pablo,
    juliana,
    caixa,
  ]);
  assert.match(erro ?? "", /seu próprio acesso/);
});

test("remover o último Diretor é recusado", () => {
  const erro = verificarRemocaoDeAcesso(juliana, "u-outro", [juliana, caixa]);
  assert.match(erro ?? "", /último acesso de Diretor/);
});

test("com dois Diretores, remover um é permitido", () => {
  assert.equal(
    verificarRemocaoDeAcesso(juliana, "u-pablo", [pablo, juliana, caixa]),
    null,
  );
});

test("Diretor suspenso não conta como dono restante", () => {
  // Suspenso não consegue entrar — deixar sair o último ativo trancaria tudo.
  const suspenso = acesso("a4", "u-ferias", true, "SUSPENSO");
  const erro = verificarRemocaoDeAcesso(juliana, "u-outro", [
    juliana,
    suspenso,
  ]);
  assert.match(erro ?? "", /último acesso de Diretor/);
});

test("remover quem não é Diretor nunca esbarra na trava do último", () => {
  assert.equal(verificarRemocaoDeAcesso(caixa, "u-pablo", [caixa]), null);
});

test("rebaixar a si mesmo é recusado", () => {
  const erro = verificarTrocaDePapel(pablo, false, "u-pablo", [pablo, juliana]);
  assert.match(erro ?? "", /rebaixar o seu próprio/);
});

test("rebaixar o último Diretor é recusado", () => {
  const erro = verificarTrocaDePapel(juliana, false, "u-outro", [
    juliana,
    caixa,
  ]);
  assert.match(erro ?? "", /último Diretor/);
});

test("promover alguém nunca é bloqueado", () => {
  assert.equal(
    verificarTrocaDePapel(caixa, true, "u-pablo", [pablo, caixa]),
    null,
  );
});

test("trocar entre dois papéis sem coringa é livre", () => {
  assert.equal(
    verificarTrocaDePapel(caixa, false, "u-pablo", [pablo, caixa]),
    null,
  );
});

test("o papel DONO não pode perder o coringa", () => {
  const erro = verificarEdicaoDePapel({ nome: "Diretor", temCoringa: true }, [
    "estoque.ver",
    "estoque.contar",
  ]);
  assert.match(erro ?? "", /acesso total/);
});

test("o papel dono pode ser editado desde que mantenha o coringa", () => {
  assert.equal(
    verificarEdicaoDePapel({ nome: "Diretor", temCoringa: true }, [
      "*",
      "estoque.ver",
    ]),
    null,
  );
});

test("papel que veio com o sistema mas NÃO é dono é livremente editável", () => {
  // Caixa, Cozinha, Gerente e Financeiro nascem com o sistema e existem
  // justamente para serem ajustados. Travá-los junto com o Diretor deixaria
  // quatro papéis úteis congelados para sempre.
  assert.equal(
    verificarEdicaoDePapel({ nome: "Cozinha", temCoringa: false }, [
      "estoque.ver",
    ]),
    null,
  );
});

test("papel de sistema não se exclui", () => {
  const erro = verificarExclusaoDePapel(
    { nome: "Diretor", ehSistema: true },
    0,
  );
  assert.match(erro ?? "", /papel do sistema/);
});

test("papel em uso não se exclui, e a mensagem conta quantos", () => {
  const erro = verificarExclusaoDePapel(
    { nome: "Cozinha", ehSistema: false },
    3,
  );
  assert.match(erro ?? "", /3 pessoas usam/);
});

test("papel vazio e comum pode ser excluído", () => {
  assert.equal(
    verificarExclusaoDePapel({ nome: "Antigo", ehSistema: false }, 0),
    null,
  );
});

test("a última unidade ativa não pode ser desativada", () => {
  assert.match(verificarDesativacaoDeUnidade(1) ?? "", /única unidade/);
  assert.equal(verificarDesativacaoDeUnidade(2), null);
});
