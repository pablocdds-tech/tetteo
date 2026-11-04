/**
 * O vocabulário do assistente privado.
 *
 * Uma permissão só, de leitura: o monitor em Configurações > Integrações.
 * Quem configura o assistente é quem tem acesso à VPS — não existe tela de configuração no
 * Tetteo; a página apenas acompanha os registros enviados pelo servidor.
 *
 * O monitor não entra no registro de Apps nem altera as permissões existentes.
 * A permissão ainda não aparece no editor de papéis: hoje, só o Diretor — que
 * tem `*` — vê o cartão. A rota também exige configuracoes.integracoes.
 */
export const PERMISSAO_VER_ASSISTENTE_PRIVADO = "assistente-privado.ver";
