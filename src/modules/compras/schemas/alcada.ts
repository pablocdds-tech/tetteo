import type { Centavos } from "./aritmetica";

/**
 * A ALÇADA — quem aprova até quanto. Regra pura.
 *
 * A alçada mora no BANCO, com versão, e é conferida no SERVIDOR. Esconder o
 * botão na tela é cortesia; o que impede alguém de aprovar acima do limite é
 * esta função, chamada dentro da transação da aprovação.
 */

export type Alcada = {
  id: string;
  papelId: string;
  /** `null` = sem limite. */
  limite: Centavos | null;
  versao: number;
};

/**
 * A alçada que cobre o total, entre as dos papéis da pessoa. Havendo mais de
 * uma, fica a de MAIOR limite (sem limite primeiro): é a que melhor descreve
 * a autoridade de quem aprovou.
 */
export function alcadaQueAprova(
  alcadas: Alcada[],
  papeisDaPessoa: string[],
  total: Centavos,
): Alcada | null {
  const cobrem = alcadas.filter(
    (a) =>
      papeisDaPessoa.includes(a.papelId) && (a.limite === null || a.limite >= total),
  );
  if (cobrem.length === 0) return null;
  return cobrem.reduce((melhor, a) => {
    if (melhor.limite === null) return melhor;
    if (a.limite === null) return a;
    return a.limite > melhor.limite ? a : melhor;
  });
}

/** O limite da pessoa: `undefined` = sem alçada; `null` = sem limite. */
export function limiteDaPessoa(
  alcadas: Alcada[],
  papeisDaPessoa: string[],
): Centavos | null | undefined {
  const minhas = alcadas.filter((a) => papeisDaPessoa.includes(a.papelId));
  if (minhas.length === 0) return undefined;
  if (minhas.some((a) => a.limite === null)) return null;
  return minhas.reduce((m, a) => (a.limite! > m ? a.limite! : m), 0n);
}
