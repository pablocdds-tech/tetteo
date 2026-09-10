import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { formatarMoeda } from "@/lib/numero";

/**
 * A PROJEÇÃO DO CAIXA.
 *
 * Responde a única pergunta que muda uma decisão de compra HOJE: "em que dia
 * o dinheiro acaba?". Começa no saldo real das contas e caminha para a frente
 * somando o que está em aberto.
 *
 * ---------------------------------------------------------------------------
 * TODO GRÁFICO AQUI TEM UMA TABELA.
 *
 * Um `<svg>` com uma linha bonita dentro é, para um leitor de tela, um
 * retângulo vazio. E não é só acessibilidade: quando o gestor quer saber o
 * valor exato do dia 14, ele precisa de um número, não de um pixel. A tabela
 * fica atrás de um `<details>` — presente, alcançável pelo teclado, e sem
 * ocupar a tela de quem só queria ver o formato da curva.
 *
 * O desenho NÃO anima. Um número que precisa ser lido não pode estar se
 * movendo enquanto a pessoa lê.
 * ---------------------------------------------------------------------------
 */

export type DiaProjetado = {
  data: Date;
  entradas: number;
  saidas: number;
  saldo: number;
};

const LARGURA = 720;
const ALTURA = 200;
const MARGEM = { topo: 12, direita: 8, baixo: 24, esquerda: 64 };

const compacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const diaMes = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const diaPorExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function GraficoDeCaixa({
  projecao,
  saldoAtual,
  periodoEmDias,
}: {
  projecao: DiaProjetado[];
  saldoAtual: number;
  periodoEmDias: number;
}) {
  const dias = projecao.length;

  // O primeiro dia em que o saldo projetado fica negativo. É o número que o
  // gestor procura — e por isso ele é dito por EXTENSO, não só desenhado.
  const primeiroNegativo = projecao.find((d) => d.saldo < 0) ?? null;

  const saldos = projecao.map((d) => d.saldo);
  const maximo = Math.max(...saldos, 0);
  const minimo = Math.min(...saldos, 0);
  // Um respiro em cima e embaixo para a linha não encostar na borda.
  const folga = Math.max((maximo - minimo) * 0.12, 1);
  const alto = maximo + folga;
  const baixo = minimo - folga;

  const larguraUtil = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.baixo;

  const x = (i: number) =>
    MARGEM.esquerda +
    (dias <= 1 ? larguraUtil / 2 : (i / (dias - 1)) * larguraUtil);

  const y = (valor: number) =>
    MARGEM.topo + ((alto - valor) / (alto - baixo)) * alturaUtil;

  const linha = projecao
    .map(
      (d, i) =>
        `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.saldo).toFixed(1)}`,
    )
    .join(" ");

  const area =
    dias > 0
      ? `${linha} L${x(dias - 1).toFixed(1)},${y(baixo).toFixed(1)} L${x(0).toFixed(1)},${y(baixo).toFixed(1)} Z`
      : "";

  const yZero = y(0);
  const zeroVisivel = baixo < 0 && alto > 0;

  const marcasX = [0, Math.floor((dias - 1) / 2), dias - 1].filter(
    (i, pos, todos) => i >= 0 && todos.indexOf(i) === pos,
  );

  return (
    <Cartao como="section" className="flex min-w-0 flex-col">
      <TituloDeSecao
        apoio={`Saldo dia a dia pelos próximos ${periodoEmDias} dias · em reais (BRL) · começa no saldo real das contas`}
        acao={
          primeiroNegativo ? (
            <Etiqueta tom="ruim">
              Fica negativo em {diaMes.format(primeiroNegativo.data)}
            </Etiqueta>
          ) : (
            <Etiqueta tom="ok">Não fica negativo no período</Etiqueta>
          )
        }
      >
        Projeção do caixa
      </TituloDeSecao>

      <div className="min-w-0 p-4">
        {dias === 0 ? (
          <p className="text-ink-3 py-8 text-center text-sm">
            Sem contas em aberto para projetar neste período.
          </p>
        ) : (
          <>
            {/* O desenho é decorativo PORQUE a tabela abaixo tem o mesmo dado.
                Marcá-lo como imagem faria o leitor de tela anunciar duas
                vezes a mesma informação. */}
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${LARGURA} ${ALTURA}`}
              className="h-auto w-full"
            >
              <defs>
                <linearGradient
                  id="preenchimento-caixa"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="var(--accent)"
                    stopOpacity="0.18"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--accent)"
                    stopOpacity="0.02"
                  />
                </linearGradient>
              </defs>

              {/* Linhas de apoio: topo, zero (quando aparece) e base. */}
              <line
                x1={MARGEM.esquerda}
                y1={MARGEM.topo}
                x2={LARGURA - MARGEM.direita}
                y2={MARGEM.topo}
                stroke="var(--line)"
                strokeWidth="1"
              />
              <line
                x1={MARGEM.esquerda}
                y1={ALTURA - MARGEM.baixo}
                x2={LARGURA - MARGEM.direita}
                y2={ALTURA - MARGEM.baixo}
                stroke="var(--line)"
                strokeWidth="1"
              />

              <text
                x={MARGEM.esquerda - 8}
                y={MARGEM.topo + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--ink-3)"
              >
                {compacto.format(alto)}
              </text>
              <text
                x={MARGEM.esquerda - 8}
                y={ALTURA - MARGEM.baixo + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--ink-3)"
              >
                {compacto.format(baixo)}
              </text>

              {zeroVisivel && (
                <>
                  <line
                    x1={MARGEM.esquerda}
                    y1={yZero}
                    x2={LARGURA - MARGEM.direita}
                    y2={yZero}
                    stroke="var(--bad)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={MARGEM.esquerda - 8}
                    y={yZero + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="var(--bad)"
                  >
                    R$ 0
                  </text>
                </>
              )}

              <path d={area} fill="url(#preenchimento-caixa)" />
              <path
                d={linha}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {primeiroNegativo && (
                <circle
                  cx={x(projecao.indexOf(primeiroNegativo))}
                  cy={y(primeiroNegativo.saldo)}
                  r="4"
                  fill="var(--bad)"
                />
              )}

              {marcasX.map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={ALTURA - 6}
                  textAnchor={
                    i === 0 ? "start" : i === dias - 1 ? "end" : "middle"
                  }
                  fontSize="11"
                  fill="var(--ink-3)"
                >
                  {diaMes.format(projecao[i].data)}
                </text>
              ))}
            </svg>

            <p className="text-ink-2 mt-3 text-sm leading-5">
              Hoje o caixa tem{" "}
              <strong className="text-ink font-semibold tabular-nums">
                {formatarMoeda(saldoAtual)}
              </strong>
              .{" "}
              {primeiroNegativo
                ? `Mantido o que está lançado, ele fica negativo em ${diaPorExtenso.format(primeiroNegativo.data)}, com ${formatarMoeda(primeiroNegativo.saldo)}.`
                : `Mantido o que está lançado, ele não fica negativo nos próximos ${periodoEmDias} dias.`}
            </p>

            {/* ---- A tabela equivalente ---- */}
            <details className="border-line mt-3 border-t pt-3">
              <summary className="text-ink-2 hover:text-ink focus-visible:outline-accent inline-flex cursor-pointer items-center rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-3">
                Ver os valores da projeção em tabela
              </summary>

              <div
                role="region"
                aria-label="Valores da projeção do caixa"
                tabIndex={0}
                className="focus-visible:outline-accent mt-3 max-h-72 overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    Entradas, saídas e saldo projetado por dia, em reais.
                  </caption>
                  <thead className="bg-surface sticky top-0">
                    <tr className="border-line border-b">
                      <th
                        scope="col"
                        className="text-ink-3 px-2 py-2 text-left text-[12px] leading-[18px] font-medium"
                      >
                        Dia
                      </th>
                      <th
                        scope="col"
                        className="text-ink-3 px-2 py-2 text-right text-[12px] leading-[18px] font-medium"
                      >
                        Entradas
                      </th>
                      <th
                        scope="col"
                        className="text-ink-3 px-2 py-2 text-right text-[12px] leading-[18px] font-medium"
                      >
                        Saídas
                      </th>
                      <th
                        scope="col"
                        className="text-ink-3 px-2 py-2 text-right text-[12px] leading-[18px] font-medium"
                      >
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-line divide-y">
                    {projecao.map((dia) => (
                      <tr key={dia.data.toISOString()}>
                        <th
                          scope="row"
                          className="text-ink-2 px-2 py-1.5 text-left font-normal whitespace-nowrap"
                        >
                          {diaPorExtenso.format(dia.data)}
                        </th>
                        <td className="text-ink-2 px-2 py-1.5 text-right tabular-nums">
                          {dia.entradas === 0
                            ? "—"
                            : formatarMoeda(dia.entradas)}
                        </td>
                        <td className="text-ink-2 px-2 py-1.5 text-right tabular-nums">
                          {dia.saidas === 0 ? "—" : formatarMoeda(dia.saidas)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-right font-medium tabular-nums ${
                            dia.saldo < 0 ? "text-bad" : "text-ink"
                          }`}
                        >
                          {formatarMoeda(dia.saldo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
    </Cartao>
  );
}
