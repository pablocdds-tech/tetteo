/**
 * O vocabulário da Severina.
 *
 * A separação que importa aqui é entre LER e CONFIGURAR. Ver as conversas é
 * quase inofensivo — é histórico. Configurar agente é a permissão perigosa:
 * quem configura decide o que a Severina fala, para quem, em que horário e,
 * nas fases seguintes, o que ela pode escrever no sistema.
 *
 * Vincular número é permissão separada de propósito. Ligar um telefone a uma
 * pessoa é dizer "quem estiver com este aparelho age como o João" — e isso
 * não é a mesma decisão que escrever o texto de um lembrete.
 */
export const PERMISSOES_ASSISTENTE = [
  { chave: "assistente.ver", descricao: "Ver conversas da Severina" },
  { chave: "assistente.configurar", descricao: "Criar e alterar agentes" },
  {
    chave: "assistente.vincular",
    descricao: "Ligar números de WhatsApp a pessoas",
  },
] as const;
