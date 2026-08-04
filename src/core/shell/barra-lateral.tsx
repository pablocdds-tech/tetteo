import Link from "next/link";

import { pode, type ContextoSessao } from "@/core/sessao/contexto";
import { AREAS, APPS_REGISTRADOS } from "@/registro-de-apps";

import { ItemNav } from "./item-nav";

/**
 * A barra lateral.
 *
 * Não decide nada: exibe o resultado do registro de Apps filtrado pelas
 * permissões do usuário. O caixa vê três ícones, não dezoito com quinze
 * bloqueados.
 *
 * A ORDEM É FIXA. As pessoas decoram posição, não nome — depois de duas
 * semanas, o gerente clica no terceiro ícone sem ler. Reordenar sozinha por
 * "mais usados" destruiria essa memória.
 */
export function BarraLateral({ contexto }: { contexto: ContextoSessao }) {
  const visiveis = APPS_REGISTRADOS.filter((app) => {
    // Apps em construção só aparecem para o Diretor: mostram o rumo do
    // sistema sem prometer à equipe o que ainda não existe.
    if (app.emConstrucao && !contexto.ehDiretor) return false;
    return pode(contexto, app.permissaoParaVer);
  });

  return (
    <aside className="bg-surface-2 border-line hidden w-[216px] flex-none flex-col gap-0.5 border-r p-3 md:flex">
      <Link
        href="/"
        className="mb-3 flex items-center gap-2.5 rounded-md px-2 py-1"
      >
        <span className="bg-accent text-accent-ink grid size-6 place-items-center rounded-md text-sm font-bold">
          T
        </span>
        <span className="font-bold tracking-tight">Tetteo</span>
      </Link>

      {AREAS.map((area) => {
        const doGrupo = visiveis.filter((a) => a.area === area.chave);
        if (doGrupo.length === 0) return null;

        return (
          <div key={area.chave}>
            <p className="text-ink-3 px-2 pt-3 pb-1 font-mono text-xs tracking-[0.12em] uppercase">
              {area.nome}
            </p>
            {doGrupo.map((app) => (
              <ItemNav
                key={app.chave}
                rota={app.rota}
                nome={app.nome}
                cor={app.cor.frente}
                emConstrucao={app.emConstrucao}
              />
            ))}
          </div>
        );
      })}
    </aside>
  );
}
