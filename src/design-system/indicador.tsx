import type { ReactNode } from "react";

import { Cartao } from "./cartao";

/**
 * O INDICADOR.
 *
 * Um número em cima de um cartão parece simples. Não é — três decisões aqui
 * separam um painel confiável de um painel bonito e inútil:
 *
 * 1. AUSENTE NÃO É ZERO. `valor={null}` mostra "—", nunca "R$ 0,00". Zero é um
 *    fato ("não houve movimento"); ausência é outro ("não deu para calcular").
 *    Trocar um pelo outro faz o gestor tomar decisão em cima de um dado que
 *    não existe, e ele não tem como perceber.
 *
 * 2. O APOIO NÃO É ENFEITE. Todo número derivado carrega período e origem:
 *    "vencendo em 7 dias · contas em aberto". Sem isso, "R$ 12.400" não
 *    responde nada — é o total do mês? da semana? já pago?
 *
 * 3. SEM COMPARAÇÃO É UMA RESPOSTA. Quando não há período anterior válido,
 *    escreve-se "Sem comparação". Inventar "+12%" contra um mês incompleto é
 *    a forma mais fácil de um painel mentir com números verdadeiros.
 *
 * O número é grande o bastante para ser varrido de longe e pequeno o bastante
 * para caber quatro numa linha sem virar cartaz. Painel não é vitrine.
 */

type Tom = "normal" | "atencao" | "critico" | "positivo";

const TONS: Record<Tom, string> = {
  normal: "text-ink",
  atencao: "text-warn",
  critico: "text-bad",
  positivo: "text-ok",
};

export function Indicador({
  rotulo,
  valor,
  apoio,
  comparacao,
  tom = "normal",
  detalhe,
}: {
  rotulo: string;
  /** `null` quando não foi possível apurar. Vira "—", nunca zero. */
  valor: string | null;
  /** Unidade, período e origem. Obrigatório: número sem contexto não informa. */
  apoio: string;
  /**
   * O texto da comparação com o período anterior. `null` — o padrão — mostra
   * "Sem comparação", que é a verdade quando não há base para comparar.
   */
  comparacao?: string | null;
  tom?: Tom;
  /** Uma etiqueta, um link para a lista completa. */
  detalhe?: ReactNode;
}) {
  const ausente = valor === null;

  return (
    <Cartao className="flex flex-col gap-1 p-4">
      <h3 className="text-ink-2 text-sm leading-5 font-semibold">{rotulo}</h3>

      <p
        className={`text-2xl leading-8 font-semibold tracking-tight tabular-nums ${
          ausente ? "text-ink-3" : TONS[tom]
        }`}
      >
        {ausente ? "—" : valor}
      </p>

      <p className="text-ink-3 text-xs leading-[18px]">
        {ausente ? "Sem dado para o período" : apoio}
      </p>

      <p className="text-ink-3 mt-auto pt-1 text-xs leading-[18px]">
        {comparacao ?? "Sem comparação"}
      </p>

      {detalhe && <div className="pt-1">{detalhe}</div>}
    </Cartao>
  );
}

/** O esqueleto do indicador, do mesmo tamanho do conteúdo que vai chegar. */
export function IndicadorCarregando() {
  return (
    <Cartao className="flex flex-col gap-2 p-4">
      <span className="bg-surface-3 h-5 w-24 animate-pulse rounded-sm" />
      <span className="bg-surface-3 h-8 w-32 animate-pulse rounded-sm" />
      <span className="bg-surface-3 h-[18px] w-40 animate-pulse rounded-sm" />
      <span className="bg-surface-3 mt-1 h-[18px] w-28 animate-pulse rounded-sm" />
    </Cartao>
  );
}
