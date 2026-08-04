import { CORINGA } from "./permissoes";

/**
 * AS TRAVAS DE CONFIGURAÇÕES.
 *
 * Esta é a única tela do Tetteo onde um clique errado deixa a pessoa trancada
 * do lado de fora do próprio sistema — e o conserto exigiria mexer no banco à
 * mão, de madrugada, com a pizzaria aberta.
 *
 * As regras moram aqui, puras e testadas, em vez de espalhadas em `if` dentro
 * dos serviços. Cada função devolve `null` quando a ação é permitida, ou a
 * frase que explica o impedimento — escrita para a pessoa, não para o log.
 */

export type AcessoParaTrava = {
  id: string;
  usuarioId: string;
  status: "ATIVO" | "SUSPENSO";
  /** Se o papel deste acesso carrega a permissão coringa. */
  papelTemCoringa: boolean;
};

/** Quantos acessos ATIVOS com poder total a organização ainda teria. */
function donosRestantes(todos: AcessoParaTrava[], excluindoId?: string) {
  return todos.filter(
    (a) => a.id !== excluindoId && a.status === "ATIVO" && a.papelTemCoringa,
  ).length;
}

/**
 * Remover ou suspender um acesso.
 *
 * Duas coisas nunca podem acontecer:
 *
 *   1. Alguém tirar o PRÓPRIO acesso. Parece proteção exagerada até o dia em
 *      que acontece: a sessão continua de pé até o token vencer, a pessoa acha
 *      que deu certo, fecha o navegador — e não entra mais.
 *
 *   2. A organização ficar SEM NENHUM dono. Sem um acesso coringa ativo,
 *      ninguém consegue criar usuário, papel ou unidade nunca mais. É a porta
 *      trancada por dentro com a chave do lado de fora.
 */
export function verificarRemocaoDeAcesso(
  alvo: AcessoParaTrava,
  quemPedeUsuarioId: string,
  todos: AcessoParaTrava[],
): string | null {
  if (alvo.usuarioId === quemPedeUsuarioId) {
    return "Você não pode remover o seu próprio acesso. Peça a outro Diretor para fazer isso.";
  }

  if (alvo.papelTemCoringa && donosRestantes(todos, alvo.id) === 0) {
    return "Este é o último acesso de Diretor. Sem ele ninguém conseguiria mais criar usuários ou papéis — promova outra pessoa antes.";
  }

  return null;
}

/**
 * Trocar o papel de um acesso.
 *
 * Rebaixar o último Diretor é o mesmo problema de removê-lo, com outro nome.
 * E rebaixar a si mesmo tranca a pessoa fora das configurações mesmo mantendo
 * o login — o que é pior, porque não parece um erro.
 */
export function verificarTrocaDePapel(
  alvo: AcessoParaTrava,
  novoPapelTemCoringa: boolean,
  quemPedeUsuarioId: string,
  todos: AcessoParaTrava[],
): string | null {
  const perdeuPoder = alvo.papelTemCoringa && !novoPapelTemCoringa;
  if (!perdeuPoder) return null;

  if (alvo.usuarioId === quemPedeUsuarioId) {
    return "Você não pode rebaixar o seu próprio acesso — perderia o acesso a esta tela.";
  }

  if (donosRestantes(todos, alvo.id) === 0) {
    return "Este é o último Diretor. Promova outra pessoa antes de rebaixá-lo.";
  }

  return null;
}

/**
 * Alterar as permissões de um papel.
 *
 * A trava vale para o papel DONO — o que carrega o coringa —, não para todo
 * papel que veio junto com o sistema. São coisas diferentes que é fácil
 * confundir: Caixa, Cozinha, Gerente e Financeiro também nascem com o sistema,
 * mas existem justamente para serem ajustados à operação de cada rede.
 *
 * Confundir os dois travaria a edição de quatro papéis úteis — e ainda faria a
 * tela afirmar que o Caixa tem acesso total, que é o contrário da verdade.
 */
export function verificarEdicaoDePapel(
  papel: { nome: string; temCoringa: boolean },
  novasPermissoes: string[],
): string | null {
  if (!papel.temCoringa) return null;

  if (!novasPermissoes.includes(CORINGA)) {
    return `"${papel.nome}" é o papel de dono do sistema e precisa manter o acesso total. Para dar menos poder a alguém, crie um papel novo em vez de reduzir este.`;
  }

  return null;
}

/**
 * Excluir um papel.
 *
 * Papel em uso deixaria acessos órfãos. Papel de sistema não se exclui nunca.
 */
export function verificarExclusaoDePapel(
  papel: { nome: string; ehSistema: boolean },
  acessosQueUsam: number,
): string | null {
  if (papel.ehSistema) {
    return `"${papel.nome}" é um papel do sistema e não pode ser excluído.`;
  }

  if (acessosQueUsam > 0) {
    return `${acessosQueUsam} ${acessosQueUsam === 1 ? "pessoa usa" : "pessoas usam"} este papel. Mude ${acessosQueUsam === 1 ? "ela" : "elas"} para outro papel antes de excluir.`;
  }

  return null;
}

/**
 * Desativar uma unidade.
 *
 * Não é destrutivo — a unidade some das telas e do seletor, e o histórico
 * dela continua inteiro. Mas se for a última, o sistema fica sem lugar
 * nenhum onde contar estoque ou lançar nota.
 */
export function verificarDesativacaoDeUnidade(
  unidadesAtivas: number,
): string | null {
  if (unidadesAtivas <= 1) {
    return "Esta é a única unidade ativa. O Tetteo precisa de pelo menos uma loja para funcionar — crie a próxima antes de desativar esta.";
  }
  return null;
}
