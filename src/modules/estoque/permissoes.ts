/**
 * O vocabulário de permissões do App de Estoque.
 *
 * A separação que importa aqui é entre QUANTIDADE e DINHEIRO. Quem conta a
 * câmara fria precisa digitar quilos; não precisa saber quanto a mussarela
 * custa nem qual foi o CMV do mês. São permissões diferentes de propósito.
 */
export const PERMISSOES_ESTOQUE = [
  { chave: "estoque.ver", descricao: "Ver posição de estoque e contagens" },
  { chave: "estoque.contar", descricao: "Fazer e fechar contagens" },
  { chave: "estoque.lancar", descricao: "Lançar notas de entrada" },
  { chave: "estoque.custos", descricao: "Ver custos, valores e o CMV" },
] as const;
