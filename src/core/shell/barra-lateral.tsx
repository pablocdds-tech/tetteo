import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

import { NavegacaoLateral, type AppNaBarra } from "./navegacao-lateral";

/**
 * A barra lateral.
 *
 * Não decide nada: filtra o registro de Apps pelas permissões do usuário e
 * entrega a lista pronta. O caixa vê os módulos dele, não treze com dez
 * bloqueados.
 */
export function BarraLateral({ contexto }: { contexto: ContextoSessao }) {
  const visiveis: AppNaBarra[] = APPS_REGISTRADOS.filter((app) => {
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
    navegacao: app.navegacao.filter(
      (item) => !item.permissao || pode(contexto, item.permissao),
    ),
  }));

  return (
    <aside className="bg-surface-2 border-line hidden w-[216px] flex-none flex-col border-r p-3 md:flex">
      <NavegacaoLateral apps={visiveis} />
    </aside>
  );
}
