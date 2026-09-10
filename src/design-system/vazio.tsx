import type { ReactNode } from "react";

import { Icone, type NomeDeIcone } from "./icones";

/**
 * O ESTADO VAZIO.
 *
 * "Nenhum resultado" é uma tela desistindo. O vazio é o único momento em que o
 * sistema tem a atenção inteira de quem chegou — e é onde ele ensina a
 * primeira ação.
 *
 * Três vazios diferentes, e confundi-los é o erro comum:
 *
 *   PRIMEIRO USO   ainda não existe nada. Ensina a criar o primeiro.
 *   SEM RESULTADO  existe, mas o filtro escondeu. Oferece LIMPAR — e nunca
 *                  apaga o que a pessoa digitou, senão ela perde a busca e
 *                  precisa lembrar o que procurava.
 *   TUDO RESOLVIDO nada pendente porque acabou. Isso é uma boa notícia e deve
 *                  parecer uma. Tratar "sem pendências" com a mesma cara de
 *                  "nada encontrado" faz o sistema soar quebrado num dia bom.
 */
export function Vazio({
  icone = "entrada",
  titulo,
  explicacao,
  acao,
  tom = "neutro",
}: {
  icone?: NomeDeIcone;
  titulo: string;
  /** O que fazer a seguir. Uma frase, no imperativo. */
  explicacao: ReactNode;
  acao?: ReactNode;
  tom?: "neutro" | "bom";
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span
        className={`grid size-11 place-items-center rounded-xl ${
          tom === "bom" ? "bg-ok-sub text-ok" : "bg-surface-2 text-ink-3"
        }`}
      >
        <Icone nome={tom === "bom" ? "check" : icone} tamanho={20} />
      </span>

      <div className="max-w-[46ch]">
        <p className="text-[15px] leading-6 font-semibold">{titulo}</p>
        <p className="text-ink-3 mt-1 text-sm leading-5">{explicacao}</p>
      </div>

      {acao && <div className="pt-1">{acao}</div>}
    </div>
  );
}
