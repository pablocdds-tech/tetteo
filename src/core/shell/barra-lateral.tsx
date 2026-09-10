import type { ReactNode } from "react";

import type { AppNaBarra } from "./apps";
import { ConteudoDaNavegacao } from "./navegacao-lateral";

/**
 * A BARRA LATERAL FIXA.
 *
 * Existe a partir de 1180px. Abaixo disso quem assume é a gaveta, com o mesmo
 * conteúdo — ver `navegacao.tsx`.
 *
 * Ela NÃO decide nada e não consulta nada: recebe a lista já filtrada pelas
 * permissões. Quem filtra é `apps-visiveis.ts`, uma vez por requisição, no
 * layout da casca.
 *
 * `sticky` com `h-dvh`: a barra acompanha a rolagem da página em vez de subir
 * junto com ela. Uma navegação que some quando se rola a terceira tela de uma
 * tabela obriga a voltar ao topo para trocar de lugar.
 */
export function BarraLateral({
  apps,
  seletorDeUnidade,
  conta,
}: {
  apps: AppNaBarra[];
  seletorDeUnidade: ReactNode;
  conta: ReactNode;
}) {
  return (
    <aside className="border-line bg-surface desk:flex sticky top-0 hidden h-dvh w-[216px] flex-none flex-col border-r">
      <ConteudoDaNavegacao
        apps={apps}
        seletorDeUnidade={seletorDeUnidade}
        conta={conta}
      />
    </aside>
  );
}
