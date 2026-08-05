import { formatarMoeda } from "@/lib/numero";

import type { BlocoDoDre, Dre } from "../schemas/dre";

/**
 * O DRE na tela.
 *
 * Ordem fixa, de cima para baixo, com o percentual sobre a receita bruta ao
 * lado de cada linha. É o percentual que torna a leitura possível: R$ 28 mil de
 * folha não diz nada sozinho; 28% do faturamento diz tudo, e é o número que se
 * compara com qualquer outra casa.
 *
 * As linhas de RESULTADO são visualmente mais pesadas que as de categoria.
 * Quem abre este relatório procura três números — lucro bruto, resultado
 * operacional, resultado do período — e o resto é justificativa.
 */
export function QuadroDre({ dre }: { dre: Dre }) {
  const p = (v: number | null) =>
    v === null ? "" : `${v.toLocaleString("pt-BR")}%`;

  return (
    <div className="border-line divide-line divide-y rounded-xl border">
      <Linha
        rotulo="Receita bruta"
        valor={dre.receitaBruta}
        percentual="100%"
        forte
      />
      <Detalhe bloco={dre.blocoReceita} />

      <Linha
        rotulo="(−) Deduções sobre a venda"
        valor={-dre.deducoes}
        percentual={p(dre.percentuais.deducoes)}
      />
      <Detalhe bloco={dre.blocoDeducoes} />

      <Linha
        rotulo="Receita líquida"
        valor={dre.receitaLiquida}
        percentual={p(
          dre.receitaBruta > 0
            ? Math.round((dre.receitaLiquida / dre.receitaBruta) * 1000) / 10
            : null,
        )}
        forte
      />

      <Linha
        rotulo="(−) CMV — custo da mercadoria vendida"
        valor={-dre.cmv}
        percentual={p(dre.percentuais.cmv)}
        nota="vem da contagem de estoque, não das compras"
      />

      <Linha
        rotulo="Lucro bruto"
        valor={dre.lucroBruto}
        percentual={p(dre.percentuais.lucroBruto)}
        forte
        destaque
      />

      {dre.despesas.map((bloco) => (
        <div key={bloco.grupo}>
          <Linha
            rotulo={`(−) ${bloco.rotulo}`}
            valor={-bloco.total}
            percentual={p(bloco.percentual)}
          />
          <Detalhe bloco={bloco} />
        </div>
      ))}

      <Linha
        rotulo="Resultado operacional"
        valor={dre.resultadoOperacional}
        percentual={p(
          dre.receitaBruta > 0
            ? Math.round((dre.resultadoOperacional / dre.receitaBruta) * 1000) /
                10
            : null,
        )}
        forte
      />

      {dre.financeiras !== 0 && (
        <Linha rotulo="(−) Financeiras" valor={-dre.financeiras} />
      )}

      <Linha
        rotulo="Resultado do período"
        valor={dre.resultado}
        percentual={p(dre.percentuais.resultado)}
        forte
        destaque
      />
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  percentual,
  forte,
  destaque,
  nota,
}: {
  rotulo: string;
  valor: number;
  percentual?: string;
  forte?: boolean;
  destaque?: boolean;
  nota?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 ${
        forte ? "bg-surface-2 font-semibold" : ""
      }`}
    >
      <span className="min-w-0 flex-1 text-sm">
        {rotulo}
        {nota && (
          <span className="text-ink-3 block text-xs font-normal">{nota}</span>
        )}
      </span>
      <span className="text-ink-3 w-16 text-right text-xs tabular-nums">
        {percentual}
      </span>
      <span
        className={`w-32 text-right tabular-nums ${
          destaque ? "text-base" : "text-sm"
        } ${valor < 0 ? "text-bad" : destaque ? "text-ok" : ""}`}
      >
        {formatarMoeda(valor)}
      </span>
    </div>
  );
}

function Detalhe({ bloco }: { bloco: BlocoDoDre }) {
  if (bloco.linhas.length === 0) return null;

  return (
    <div className="bg-surface">
      {bloco.linhas.map((l) => (
        <div
          key={l.categoria}
          className="text-ink-3 flex items-center gap-3 px-4 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1 truncate pl-4">{l.categoria}</span>
          <span className="w-16 text-right tabular-nums">
            {l.percentual !== null
              ? `${l.percentual.toLocaleString("pt-BR")}%`
              : ""}
          </span>
          <span className="w-32 text-right tabular-nums">
            {formatarMoeda(l.valor)}
          </span>
        </div>
      ))}
    </div>
  );
}
