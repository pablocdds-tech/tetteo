"use client";
import { useState } from "react";
import { useAmbienteProprio } from "@/core/shell/link-integrado";
import type { DesempenhoPdv as Dados } from "../desempenho-types";
import comum from "./secoes-pdv.module.css";
import styles from "./desempenho-pdv.module.css";
const moeda = (v: number) =>
  (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (v: string) => v.split("-").reverse().join("/");
function comparacao(atual: number, anterior: number) {
  if (!anterior)
    return atual
      ? "Sem base no período anterior"
      : "Sem pedidos nos dois períodos";
  const valor = ((atual - anterior) / anterior) * 100;
  return (
    (valor > 0 ? "+" : "") +
    valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) +
    "%"
  );
}
export function DesempenhoPdv({ dados }: { dados: Dados }) {
  const proprio = useAmbienteProprio();
  const [medida, setMedida] = useState<"valorCentavos" | "pedidos">(
    "valorCentavos",
  );
  const maior = Math.max(1, ...dados.dias.map((d) => d[medida]));
  const maximo = medida === "pedidos" ? Math.ceil(maior / 4) * 4 : maior;
  return (
    <div className={comum.pagina}>
      <h1 className={proprio ? "sr-only" : comum.titulo}>Análise das vendas</h1>
      <form action="/pdv/desempenho" className={styles.filtros}>
        <label>
          Data inicial
          <input
            name="de"
            aria-label="Data inicial"
            type="date"
            defaultValue={dados.de}
            required
            min="2000-01-01"
            max="2100-12-31"
          />
        </label>
        <label>
          Data final
          <input
            name="ate"
            aria-label="Data final"
            type="date"
            defaultValue={dados.ate}
            required
            min="2000-01-01"
            max="2100-12-31"
          />
        </label>
        <button className={comum.primario}>Aplicar período</button>
        <p>
          Comparado a {data(dados.anteriorDe)} – {data(dados.anteriorAte)}
        </p>
      </form>
      <section className={comum.superficie} aria-label="Indicadores de pedidos">
        <div className={styles.indicadores}>
          {[
            {
              nome: "Valor dos pedidos",
              valor: moeda(dados.atual.valorCentavos),
              comparacao: comparacao(
                dados.atual.valorCentavos,
                dados.anterior.valorCentavos,
              ),
            },
            {
              nome: "Pedidos",
              valor: dados.atual.pedidos.toLocaleString("pt-BR"),
              comparacao: comparacao(
                dados.atual.pedidos,
                dados.anterior.pedidos,
              ),
            },
            {
              nome: "Ticket médio",
              valor:
                dados.atual.ticketCentavos === null
                  ? "—"
                  : moeda(dados.atual.ticketCentavos),
              comparacao:
                dados.atual.ticketCentavos !== null &&
                dados.anterior.ticketCentavos !== null
                  ? comparacao(
                      dados.atual.ticketCentavos,
                      dados.anterior.ticketCentavos,
                    )
                  : "Sem base para comparação",
            },
          ].map((i) => (
            <div key={i.nome}>
              <h2>{i.nome}</h2>
              <strong>{i.valor}</strong>
              <small>{i.comparacao}</small>
            </div>
          ))}
        </div>
        <div className={styles.grafico}>
          <div className={comum.barra}>
            <h2>Pedidos por dia</h2>
            <select
              aria-label="Indicador do gráfico"
              value={medida}
              onChange={(e) => setMedida(e.target.value as typeof medida)}
            >
              <option value="valorCentavos">Valor dos pedidos</option>
              <option value="pedidos">Quantidade de pedidos</option>
            </select>
          </div>
          <div
            className={styles.rolagemGrafico}
            tabIndex={0}
            aria-label="Gráfico diário com rolagem horizontal"
          >
            <svg
              viewBox="0 0 900 300"
              role="img"
              aria-label={
                "Evolução diária de " +
                (medida === "pedidos" ? "pedidos" : "valor dos pedidos") +
                " de " +
                data(dados.de) +
                " a " +
                data(dados.ate)
              }
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1="85"
                    x2="885"
                    y1={245 - i * 52}
                    y2={245 - i * 52}
                    stroke="var(--line)"
                  />
                  <text
                    x="75"
                    y={249 - i * 52}
                    textAnchor="end"
                    fill="var(--ink-3)"
                    fontSize="12"
                  >
                    {medida === "pedidos"
                      ? Math.ceil((maximo * i) / 4)
                      : moeda(Math.round((maximo * i) / 4))}
                  </text>
                </g>
              ))}
              {dados.dias.map((d, i) => {
                const largura = 800 / dados.dias.length;
                const altura = (d[medida] / maximo) * 208;
                return (
                  <g key={d.dia}>
                    <rect
                      x={85 + i * largura + largura * 0.2}
                      y={245 - altura}
                      width={largura * 0.6}
                      height={altura}
                      rx="2"
                      fill="var(--accent)"
                    >
                      <title>
                        {data(d.dia) +
                          ": " +
                          (medida === "pedidos"
                            ? d.pedidos + " pedidos"
                            : moeda(d.valorCentavos))}
                      </title>
                    </rect>
                    {(i % Math.max(1, Math.ceil(dados.dias.length / 7)) === 0 ||
                      i === dados.dias.length - 1) && (
                      <text
                        x={85 + (i + 0.5) * largura}
                        y="270"
                        textAnchor="middle"
                        fill="var(--ink-3)"
                        fontSize="12"
                      >
                        {data(d.dia).slice(0, 5)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <details>
            <summary>Ver valores por dia</summary>
            <div className={styles.dadosDiarios}>
              <table className={comum.tabela} style={{ minWidth: 400 }}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pedidos</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.dias.map((d) => (
                    <tr key={d.dia}>
                      <th scope="row">{data(d.dia)}</th>
                      <td>{d.pedidos}</td>
                      <td>{moeda(d.valorCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>
      <p className={comum.legenda}>
        Pedidos pela data de criação, no horário de São Paulo. Inclui frete,
        pedidos locais ainda a receber e pedidos externos; exclui cancelados.
        Valores de pedidos externos não confirmam recebimento no caixa.
      </p>
      <div className={styles.resumos}>
        <Resumo
          titulo="Por tipo de pedido"
          linhas={dados.modalidades.map((i) => ({
            ...i,
            nome:
              i.nome === "ENTREGA"
                ? "Delivery"
                : i.nome === "RETIRADA"
                  ? "Retirada"
                  : "Balcão",
          }))}
        />
        <Resumo titulo="Por origem" linhas={dados.origens} />
        <section className={comum.superficie}>
          <h2 className={styles.tituloTabela}>Produtos mais pedidos</h2>
          <table className={styles.tabelaResumo}>
            <thead>
              <tr>
                <th>Produto</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {dados.produtos.map((p) => (
                <tr key={p.nome}>
                  <td>{p.nome}</td>
                  <td>{p.quantidade.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dados.produtos.length && (
            <p className={styles.semDados}>Sem produtos no período.</p>
          )}
        </section>
      </div>
      <div className={comum.resumo}>
        <span>
          Cancelados
          <strong>
            {dados.atual.cancelados} ·{" "}
            {moeda(dados.atual.valorCanceladoCentavos)}
          </strong>
        </span>
        <span>
          Pedidos locais a receber
          <strong>
            {dados.atual.pendentes} · {moeda(dados.atual.valorPendenteCentavos)}
          </strong>
        </span>
      </div>
    </div>
  );
}
function Resumo({
  titulo,
  linhas,
}: {
  titulo: string;
  linhas: { nome: string; pedidos: number; valorCentavos: number }[];
}) {
  return (
    <section className={comum.superficie}>
      <h2 className={styles.tituloTabela}>{titulo}</h2>
      <table className={styles.tabelaResumo}>
        <thead>
          <tr>
            <th>Descrição</th>
            <th>Pedidos</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.nome}>
              <td>{l.nome}</td>
              <td>{l.pedidos}</td>
              <td>{moeda(l.valorCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!linhas.length && (
        <p className={styles.semDados}>Sem pedidos no período.</p>
      )}
    </section>
  );
}
