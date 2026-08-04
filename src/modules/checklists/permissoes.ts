/**
 * O vocabulário de permissões dos Checklists.
 *
 * A separação que importa aqui é entre RESPONDER e RESOLVER. Quem abre a loja
 * responde o checklist e aponta que a coifa está suja; quem diz que a coifa
 * foi limpa é outra pessoa, depois de olhar. Se fosse a mesma permissão, a
 * pendência viraria autoavaliação — e a única coisa que o módulo faz de
 * verdade é impedir que "não conforme" seja anotado e esquecido.
 */
export const PERMISSOES_CHECKLISTS = [
  {
    chave: "checklists.ver",
    descricao: "Ver checklists, histórico e pendências",
  },
  { chave: "checklists.responder", descricao: "Responder e fechar checklists" },
  {
    chave: "checklists.editar",
    descricao: "Criar e alterar modelos e rotinas",
  },
  { chave: "checklists.resolver", descricao: "Dar baixa em pendências" },
] as const;
