/**
 * O vocabulário de permissões do App de Cardápio.
 *
 * Quem define o significado é o App, não o Core. O Core só guarda a string e
 * responde sim/não — ele nunca sabe o que "editar ficha técnica" quer dizer.
 */
export const PERMISSOES_CARDAPIO = [
  { chave: "cardapio.ver", descricao: "Ver insumos, pratos e fichas técnicas" },
  {
    chave: "cardapio.editar",
    descricao: "Cadastrar e alterar insumos e pratos",
  },
  { chave: "cardapio.excluir", descricao: "Excluir insumos e pratos" },
] as const;
