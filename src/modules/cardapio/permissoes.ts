/**
 * O vocabulário de permissões do App de Cardápio.
 *
 * Quem define o significado é o App, não o Core. O Core só guarda a string e
 * responde sim/não — ele nunca sabe o que "editar ficha técnica" quer dizer.
 *
 * A separação que importa é a mesma do Estoque: RECEITA e DINHEIRO são coisas
 * diferentes. O pizzaiolo precisa da ficha aberta no tablet para saber que a
 * margherita leva 200 g de mussarela; ele não precisa saber que a margherita
 * custa R$ 12,40 e é vendida com 77% de margem.
 */
export const PERMISSOES_CARDAPIO = [
  { chave: "cardapio.ver", descricao: "Ver insumos, pratos e fichas técnicas" },
  {
    chave: "cardapio.editar",
    descricao: "Cadastrar e alterar insumos e fichas",
  },
  { chave: "cardapio.excluir", descricao: "Excluir insumos e fichas" },
  {
    chave: "cardapio.custos",
    descricao: "Ver custo, preço e margem das fichas",
  },
] as const;
