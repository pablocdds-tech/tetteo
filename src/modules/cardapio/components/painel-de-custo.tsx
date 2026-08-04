import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

import { calcularMargem, precoParaCmvAlvo } from "../schemas/custo";
import type { FichaCompleta } from "../services/fichas";

/**
 * O PAINEL — a resposta que a ficha existe para dar.
 *
 * Três decisões de desenho aqui, e nenhuma é estética:
 *
 * O aviso de linha sem custo fica NO TOPO, acima do número. Um custo
 * incompleto exibido em fonte grande é pior do que nenhum custo: ele parece
 * conclusivo, e a decisão de preço sai errada com confiança.
 *
 * Os dois custos aparecem lado a lado. A média custeia o que já foi consumido;
 * a última compra diz por quanto se repõe hoje. Num período de alta os dois
 * divergem, e escolher um escondido é como o sistema erra sem ninguém notar.
 *
 * "Margem bruta" vem com a ressalva escrita. Setenta por cento de margem bruta
 * não é setenta por cento de lucro — ainda faltam embalagem, gás, luz, imposto
 * e gente. Deixar essa frase de fora é convidar a decisão errada.
 */
export function PainelDeCusto({ ficha }: { ficha: FichaCompleta }) {
  const { custoMedio, custoUltimo } = ficha;
  const margem = calcularMargem(custoMedio.custoUnitario, ficha.precoVenda);
  const alvo = precoParaCmvAlvo(custoMedio.custoUnitario, 30);

  const diferenca = custoUltimo.custoUnitario - custoMedio.custoUnitario;

  return (
    <div className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-5">
      {custoMedio.linhasComProblema > 0 && (
        <p className="bg-warn-sub text-warn rounded-md px-3 py-2 text-sm">
          {custoMedio.linhasComProblema}{" "}
          {custoMedio.linhasComProblema === 1
            ? "linha não pôde ser custeada"
            : "linhas não puderam ser custeadas"}
          . O valor abaixo está incompleto — o custo real é maior.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
            Custo{" "}
            {ficha.tipo === "PREPARO"
              ? `por ${sigla(ficha.unidadeRendimento)}`
              : "do prato"}
          </span>
          <span className="block text-3xl font-semibold tabular-nums">
            {formatarMoeda(custoMedio.custoUnitario)}
          </span>
          <span className="text-ink-3 block text-xs">
            pelo custo médio dos insumos
          </span>
        </div>

        <div>
          <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
            Repondo hoje
          </span>
          <span className="text-ink-2 block text-xl font-semibold tabular-nums">
            {formatarMoeda(custoUltimo.custoUnitario)}
          </span>
          <span className="text-ink-3 block text-xs">
            {Math.abs(diferenca) < 0.005 ? (
              "igual à média"
            ) : (
              <span className={diferenca > 0 ? "text-bad" : "text-ok"}>
                {diferenca > 0 ? "+" : "−"}
                {formatarMoeda(Math.abs(diferenca))} pela última compra
              </span>
            )}
          </span>
        </div>

        {ficha.tipo === "PRATO" && margem && (
          <>
            <div>
              <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
                CMV teórico
              </span>
              <span
                className={`block text-3xl font-semibold tabular-nums ${
                  margem.cmvPercentual <= 30
                    ? "text-ok"
                    : margem.cmvPercentual <= 40
                      ? "text-warn"
                      : "text-bad"
                }`}
              >
                {margem.cmvPercentual.toLocaleString("pt-BR")}%
              </span>
              <span className="text-ink-3 block text-xs">
                do preço de {formatarMoeda(ficha.precoVenda ?? 0)}
              </span>
            </div>

            <div>
              <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
                Margem bruta
              </span>
              <span className="block text-xl font-semibold tabular-nums">
                {formatarMoeda(margem.lucroBruto)}
              </span>
              <span className="text-ink-3 block text-xs">
                antes de embalagem, gás, luz, imposto e gente
              </span>
            </div>
          </>
        )}
      </div>

      {ficha.tipo === "PRATO" && !margem && (
        <p className="text-ink-3 text-sm">
          Sem preço de venda não há margem. Preencha o preço acima para ver
          quanto do que você cobra é comida.
        </p>
      )}

      {ficha.tipo === "PRATO" &&
        margem &&
        margem.cmvPercentual > 35 &&
        alvo && (
          <p className="text-ink-2 border-line border-t pt-3 text-sm">
            Para o ingrediente ser 30% do preço, este prato precisaria sair a{" "}
            <strong className="tabular-nums">{formatarMoeda(alvo)}</strong>.
            Trinta por cento é referência comum de pizzaria, não uma regra —
            vale comparar com o que a concorrência cobra antes de mexer.
          </p>
        )}

      <p className="text-ink-3 border-line border-t pt-3 text-xs">
        Este é o CMV <strong>teórico</strong>: o que o prato deveria custar. O
        CMV <strong>real</strong> sai do Estoque, contando o que sumiu de
        verdade. Comparar os dois no mês exige saber quantos pratos foram
        vendidos — e isso chega quando o PDV entrar.
      </p>

      {ficha.usadaEm.length > 0 && (
        <div className="border-line border-t pt-3">
          <span className="text-ink-3 text-xs font-semibold tracking-wide uppercase">
            Usada em
          </span>
          <p className="text-ink-2 mt-1 text-sm">
            {ficha.usadaEm.map((f) => f.nome).join(", ")}
          </p>
          <p className="text-ink-3 mt-1 text-xs">
            Mexer nesta receita muda o custo{" "}
            {ficha.usadaEm.length === 1 ? "dessa ficha" : "dessas fichas"} na
            hora.
          </p>
        </div>
      )}

      <p className="text-ink-3 text-xs">
        Rende {formatarQuantidade(ficha.rendimento)}{" "}
        {sigla(ficha.unidadeRendimento)} · custo da receita inteira{" "}
        {formatarMoeda(custoMedio.custoTotal)}
      </p>
    </div>
  );
}
