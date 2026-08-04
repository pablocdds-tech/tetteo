import { REDE_INTEIRA, type ContextoSessao } from "@/core/sessao/contexto";

import { MenuUsuario } from "./menu-usuario";
import { SeletorUnidade } from "./seletor-unidade";

/**
 * O topo.
 *
 * Fino, fixo, com quatro coisas: unidade, busca, notificações e perfil. É o
 * elemento que prova, a cada segundo, que você está dentro de um sistema só.
 *
 * Junto com a barra lateral, forma a CASCA — que monta uma vez e nunca
 * remonta. Só o miolo troca ao mudar de App. Esse contraste (miolo muda,
 * moldura parada) é o que o cérebro lê como "sistema operacional".
 */
export function Topo({ contexto }: { contexto: ContextoSessao }) {
  return (
    <header className="border-line bg-surface flex h-[50px] flex-none items-center gap-3 border-b px-4">
      <SeletorUnidade
        unidades={contexto.unidadesVisiveis}
        valorAtual={contexto.unidadeAtiva?.id ?? REDE_INTEIRA}
        podeVerRede={contexto.podeVerRedeInteira}
      />

      {/* Busca e notificações entram nos próximos componentes. O espaço já
          existe para a casca não mudar de forma quando chegarem. */}
      <div className="text-ink-3 border-line bg-surface-2 hidden h-8 max-w-[280px] flex-1 items-center gap-2 rounded-md border px-2.5 text-sm sm:flex">
        <span aria-hidden>🔎</span>
        <span>Buscar…</span>
        <kbd className="border-line-2 text-ink-3 ml-auto rounded border px-1 font-mono text-[11px]">
          Ctrl K
        </kbd>
      </div>

      <div className="ml-auto">
        <MenuUsuario
          nome={contexto.usuario.nome}
          email={contexto.usuario.email}
        />
      </div>
    </header>
  );
}
