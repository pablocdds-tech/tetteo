/**
 * O vocabulário do assistente privado.
 *
 * Uma permissão só, de leitura: o cartão do Painel. Quem configura o
 * assistente é quem tem acesso à VPS — não existe tela de configuração no
 * Tetteo, e por isso não existe permissão de configurar.
 *
 * O módulo não entra no registro de Apps (não tem tela própria, e um item na
 * lista levaria a uma página "em construção" que não diz a verdade). Por isso
 * a permissão ainda não aparece no editor de papéis: hoje, só o Diretor — que
 * tem `*` — vê o cartão. Quando o módulo ganhar tela, o manifesto a declara.
 */
export const PERMISSAO_VER_ASSISTENTE_PRIVADO = "assistente-privado.ver";
