import type { ManifestoDoApp } from "@/core/registry/tipos";

/**
 * O VOCABULÁRIO DE CONFIGURAÇÕES.
 *
 * Configurações não é um App: é parte do Kernel. Não define vocabulário de
 * negócio, não pode ser desinstalada, e mexe nas tabelas que sustentam todo o
 * resto — organização, unidade, usuário, papel.
 *
 * Por isso a permissão de EDITAR aqui é a mais perigosa do sistema: quem a
 * tem pode dar a si mesmo qualquer outra. Ela não deveria estar em papel
 * nenhum além de Diretor.
 */
export const PERMISSOES_CONFIGURACOES = [
  {
    chave: "configuracoes.ver",
    descricao: "Ver configurações, unidades e usuários",
  },
  {
    chave: "configuracoes.editar",
    descricao: "Alterar unidades, usuários e papéis",
  },
  {
    chave: "configuracoes.auditoria",
    descricao: "Ver o histórico de quem mudou o quê",
  },
] as const;

export type GrupoDePermissoes = {
  chaveApp: string;
  nome: string;
  icone: string;
  cor: { fundo: string; frente: string };
  permissoes: { chave: string; descricao: string }[];
};

/**
 * O catálogo completo de permissões, montado a partir dos MANIFESTOS.
 *
 * Não existe tabela de permissões no banco de propósito: ela viraria uma cópia
 * desatualizada disto aqui, com alguém sincronizando na mão. O código é a
 * fonte — instalar um App novo faz as permissões dele aparecerem no editor de
 * papéis sozinhas, sem migração e sem cadastro.
 */
export function catalogoDePermissoes(
  apps: ManifestoDoApp[],
): GrupoDePermissoes[] {
  return apps
    .map((app) => ({
      chaveApp: app.chave,
      nome: app.nome,
      icone: app.icone,
      cor: app.cor,
      // Um App pode declarar a mesma chave duas vezes por descuido; a tela não
      // pode mostrar caixinha repetida.
      permissoes: app.permissoes.filter(
        (p, i, todas) => todas.findIndex((o) => o.chave === p.chave) === i,
      ),
    }))
    .filter((g) => g.permissoes.length > 0);
}

/** Toda chave válida do sistema — usada para recusar o que não existe. */
export function chavesValidas(apps: ManifestoDoApp[]): Set<string> {
  const chaves = new Set<string>();
  for (const app of apps) {
    for (const p of app.permissoes) chaves.add(p.chave);
  }
  return chaves;
}

/**
 * A permissão coringa do Diretor.
 *
 * Vive aqui como constante e não como texto solto espalhado: quem procurar
 * "quem pode tudo?" acha num lugar só.
 */
export const CORINGA = "*";
