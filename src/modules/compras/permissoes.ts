/**
 * O vocabulário de permissões do App de Compras.
 *
 * A separação que importa: COTAR e PEDIR são gestos diferentes. Levantar preço
 * é trabalho de quem está no telefone com o fornecedor; emitir o pedido
 * compromete dinheiro da casa. Numa pizzaria pequena é a mesma pessoa, e ela
 * simplesmente recebe as duas — mas quando deixa de ser, a separação já está
 * pronta e ninguém precisa refazer o módulo.
 */
export const PERMISSOES_COMPRAS = [
  { chave: "compras.ver", descricao: "Ver fornecedores, cotações e pedidos" },
  { chave: "compras.cotar", descricao: "Criar cotações e lançar os preços" },
  { chave: "compras.pedir", descricao: "Emitir e enviar pedidos de compra" },
  {
    chave: "compras.fornecedores",
    descricao: "Cadastrar e alterar fornecedores",
  },
] as const;
