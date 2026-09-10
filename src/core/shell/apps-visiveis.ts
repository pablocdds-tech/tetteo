import "server-only";

import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

import type { AppNaBarra } from "./apps";

/**
 * OS APPS QUE ESTA PESSOA ENXERGA.
 *
 * Filtra o registro pelas permissões e devolve a lista pronta e serializável
 * para a casca. O caixa vê os módulos dele, não treze com dez bloqueados —
 * mostrar cadeado é contar o que existe do outro lado.
 *
 * Roda uma vez por requisição, no `layout` da casca, e o resultado desce por
 * `props` para a barra lateral, a gaveta, o topo e a busca. Filtrar de novo em
 * cada um desses lugares abriria a porta para os quatro discordarem.
 */
export function appsVisiveis(contexto: ContextoSessao): AppNaBarra[] {
  return APPS_REGISTRADOS.filter((app) => {
    // Módulos em construção aparecem só para o Diretor: mostram o rumo do
    // sistema sem prometer à equipe o que ainda não existe.
    if (app.emConstrucao && !contexto.ehDiretor) return false;
    return pode(contexto, app.permissaoParaVer);
  }).map((app) => ({
    chave: app.chave,
    nome: app.nome,
    subtitulo: app.subtitulo,
    icone: app.icone,
    cor: app.cor,
    rota: app.rota,
    emConstrucao: app.emConstrucao,
    navegacao: app.navegacao
      .filter((item) => !item.permissao || pode(contexto, item.permissao))
      .map((item) => ({ rota: item.rota, nome: item.nome })),
  }));
}
