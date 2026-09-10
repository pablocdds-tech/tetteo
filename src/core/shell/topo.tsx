import type { AppNaBarra } from "./apps";
import { Busca } from "./busca";
import { Caminho } from "./caminho";
import { BotaoMenu } from "./navegacao";

/**
 * O TOPO.
 *
 * 56px, com três coisas: o botão Menu (só onde a barra lateral virou gaveta),
 * o caminho e a busca. A conta desceu para o rodapé da barra lateral, onde ela
 * fica junto do resto do que é "seu" — e continua alcançável no celular, pela
 * gaveta.
 *
 * Junto com a barra lateral, forma a CASCA — que monta uma vez e nunca
 * remonta. Só o miolo troca ao mudar de App. Esse contraste (miolo muda,
 * moldura parada) é o que o cérebro lê como "sistema operacional".
 *
 * `sticky`: o caminho e a busca continuam na tela no meio de uma tabela longa.
 */
export function Topo({ apps }: { apps: AppNaBarra[] }) {
  return (
    <header className="border-line bg-surface desk:px-7 sticky top-0 z-10 flex h-14 flex-none items-center gap-3 border-b px-4">
      <BotaoMenu />

      <Caminho apps={apps} />

      <div className="ml-auto flex flex-none items-center gap-2">
        <Busca apps={apps} />
      </div>
    </header>
  );
}
