import type { ManifestoDoApp } from "@/core/registry/tipos";

import { PERMISSOES_ASSISTENTE } from "./permissoes";

/**
 * Severina.
 *
 * Atendimento aos clientes e avisos da equipe compartilham a navegação.
 * As rotas app/ compõem os módulos; permissões e contas continuam separadas.
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
  subtitulo: "Atendimento & operação",
  icone: "brilho",
  cor: { fundo: "#4F46E5", frente: "#FFFFFF" },
  area: "apoio",
  rota: "/assistente",
  navegacao: [
    { rota: "/assistente", nome: "Overview", icone: "monitor" },
    {
      rota: "/assistente/inbox",
      nome: "Inbox",
      permissao: "crm.ver",
      icone: "entrada",
    },
    {
      rota: "/assistente/escalacoes",
      nome: "Escalações",
      permissao: "crm.ver",
      icone: "alerta",
    },
    {
      rota: "/assistente/disparos",
      nome: "Feed de Disparos",
      icone: "entrega",
    },
    {
      rota: "/assistente/skills",
      nome: "Skills / Tom de voz",
      permissao: "crm.ver",
      icone: "brilho",
    },
    {
      rota: "/assistente/qualidade",
      nome: "Qualidade",
      permissao: "crm.ver",
      icone: "olho",
    },
    {
      rota: "/assistente/saude",
      nome: "Saúde da Operação",
      permissao: "crm.ver",
      icone: "coracao",
    },
    {
      rota: "/assistente/evolution",
      nome: "Chips Evolution",
      permissao: "crm.ver",
      icone: "entrada",
    },
    {
      rota: "/assistente/meta-whatsapp",
      nome: "Meta WhatsApp",
      permissao: "crm.ver",
      icone: "brilho",
    },
    {
      rota: "/assistente/configuracao",
      nome: "Configuração",
      permissao: "crm.ver",
      icone: "engrenagem",
    },
    {
      rota: "/assistente/conversas-equipe",
      nome: "Conversas da equipe",
      grupo: "Equipe",
    },
    { rota: "/assistente/eventos", nome: "Eventos da equipe", grupo: "Equipe" },
    {
      rota: "/assistente/whatsapp",
      nome: "WhatsApp da equipe",
      grupo: "Equipe",
    },
    {
      rota: "/assistente/agentes",
      nome: "Agentes de aviso",
      grupo: "Equipe",
      permissao: "assistente.configurar",
    },
    {
      rota: "/assistente/vinculos",
      nome: "Números da equipe",
      grupo: "Equipe",
      permissao: "assistente.vincular",
    },
  ],
  permissaoParaVer: "assistente.ver",
  permissoes: [...PERMISSOES_ASSISTENTE],
  comportamentoNaRede: "consolida",
};
