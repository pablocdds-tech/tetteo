import type { ManifestoDoApp } from "@/core/registry/tipos";

export const manifestoCrm: ManifestoDoApp = {
  chave: "crm",
  nome: "CRM",
  subtitulo: "Clientes & relacionamento",
  icone: "coracao",
  cor: { fundo: "#E11D62", frente: "#FFFFFF" },
  area: "gestao",
  rota: "/crm",
  navegacao: [
    { rota: "/crm", nome: "Contatos" },
    { rota: "/crm/atendimento", nome: "Atendimento virtual" },
    { rota: "/crm/publicos", nome: "Públicos" },
    { rota: "/crm/campanhas", nome: "Campanhas e resultados" },
  ],
  permissaoParaVer: "crm.ver",
  permissoes: [
    {
      chave: "crm.ver",
      descricao: "Ver contatos, atendimento, públicos e campanhas",
    },
    {
      chave: "crm.editar",
      descricao: "Cadastrar contatos, atender conversas e preparar campanhas",
    },
    {
      chave: "crm.gerenciar",
      descricao: "Aprovar campanhas, importar visitas e unificar contatos",
    },
  ],
  comportamentoNaRede: "exige-unidade",
};
