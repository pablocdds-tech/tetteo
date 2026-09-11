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
 *
 * O WHATSAPP trouxe três, e a divisão entre elas é o desenho de segurança:
 *
 *   preparar   o operador escreve o rascunho — e para por aí
 *   autorizar  o responsável escolhe quem recebe e confirma o envio
 *   conectar   o responsável vê o QR Code e mexe na conexão do número
 *
 * Nenhuma delas troca credencial: chave e senha moram só no servidor.
 */
export const PERMISSOES_ASSISTENTE = [
  { chave: "assistente.ver", descricao: "Ver conversas, avisos e eventos" },
  { chave: "assistente.configurar", descricao: "Criar e alterar agentes" },
  {
    chave: "assistente.vincular",
    descricao: "Ligar números de WhatsApp a pessoas",
  },
  {
    chave: "assistente.preparar",
    descricao: "Preparar rascunhos de aviso",
  },
  {
    chave: "assistente.autorizar",
    descricao: "Autorizar destinatários e confirmar o envio de avisos",
  },
  {
    chave: "assistente.conectar",
    descricao: "Conectar o número, ver o QR Code e configurar os eventos",
  },
] as const;
