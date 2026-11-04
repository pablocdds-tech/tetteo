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
 * Seis entradas por tarefa. As ferramentas da equipe e os ajustes avançados
 * ficam em suas áreas; a conexão de clientes tem uma entrada explícita.
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
    { rota: "/assistente", nome: "Início", icone: "monitor" },
    {
      rota: "/assistente/inbox",
      nome: "Atendimentos",
      permissao: "crm.ver",
      icone: "entrada",
    },
    {
      rota: "/assistente/conectar",
      nome: "Conectar WhatsApp",
      permissao: "crm.ver",
      icone: "entrada",
    },
    {
      rota: "/assistente/configuracao",
      nome: "Assistente",
      permissao: "crm.ver",
      icone: "brilho",
    },
    {
      rota: "/assistente/monitoramento",
      nome: "Monitoramento",
      permissao: "crm.ver",
      icone: "coracao",
    },
    {
      rota: "/assistente/equipe",
      nome: "Equipe e avisos",
      icone: "entrega",
    },
  ],
  permissaoParaVer: "assistente.ver",
  permissoes: [...PERMISSOES_ASSISTENTE],
  comportamentoNaRede: "consolida",
};
