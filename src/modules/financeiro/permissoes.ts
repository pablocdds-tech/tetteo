/**
 * O vocabulário de permissões do App Financeiro.
 *
 * Duas separações importam aqui, e as duas são sobre CONFIANÇA, não sobre
 * conveniência:
 *
 * LANÇAR e QUITAR. Cadastrar uma conta a pagar é trabalho administrativo;
 * dizer que ela foi paga é afirmar que o dinheiro saiu. Quando as duas coisas
 * são da mesma pessoa sem ninguém olhando, o sistema deixa de servir de
 * controle e passa a servir de fachada.
 *
 * VER e VER O RESULTADO. Quem lança contas precisa enxergar contas; não
 * precisa saber a margem da casa. Numa pizzaria familiar isso parece
 * exagero — até o dia em que entra um gerente que não é da família.
 */
export const PERMISSOES_FINANCEIRO = [
  { chave: "financeiro.ver", descricao: "Ver contas a pagar e a receber" },
  { chave: "financeiro.lancar", descricao: "Cadastrar contas e categorias" },
  {
    chave: "financeiro.quitar",
    descricao: "Dar baixa em pagamentos e recebimentos",
  },
  {
    chave: "financeiro.resultado",
    descricao: "Ver o resultado e a margem da casa",
  },
] as const;
