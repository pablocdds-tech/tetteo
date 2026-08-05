import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_ASSISTENTE } from "./permissoes";

/**
 * Severina.
 *
 * Deixa de ser "atendimento virtual" e passa a ser o que de fato faz: um
 * AUDITOR que fala com a equipe. Confere, cobra, alerta, lembra — para que a
 * loja funcione. Cliente é outra conversa, e depende de Cardápio, Delivery e
 * CRM, que ainda são ícone sem código.
 *
 * A aba "Treinamento" do manifesto antigo virou "Agentes": é a mesma tela.
 * Manter as duas criaria a dúvida "configuro em qual?" — o mesmo erro que
 * duplicou trinta produtos no sistema antigo.
 *
 * Consolida: uma Severina para a rede inteira, um número só. A loja de cada
 * conversa vem do AGENTE, não do telefone — é isso que faz quem trabalha em
 * duas lojas não precisar ser perguntado toda vez.
 */
export const manifestoSeverina: ManifestoDoApp = {
  chave: "assistente",
  nome: "Severina",
  subtitulo: "Avisos & conversas da equipe",
  icone: "✨",
  cor: { fundo: "#4F46E5", frente: "#FFFFFF" },
  area: "apoio",
  rota: "/assistente",
  navegacao: [
    { rota: "/assistente", nome: "Conversas" },
    {
      rota: "/assistente/agentes",
      nome: "Agentes",
      permissao: "assistente.configurar",
    },
    {
      rota: "/assistente/vinculos",
      nome: "Números",
      permissao: "assistente.vincular",
    },
  ],
  permissaoParaVer: "assistente.ver",
  permissoes: [...PERMISSOES_ASSISTENTE],
  comportamentoNaRede: "consolida",

  /// Sai daqui quando o primeiro aviso tiver saído sozinho, no horário, sem
  /// ninguém apertar nada. Até lá a equipe não vê um módulo que promete
  /// cobrar e não cobra.
  emConstrucao: true,
};
