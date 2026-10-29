"use client";

import { useState } from "react";
import { Icone } from "@/design-system/icones";
import { estados } from "../schemas/conferencia";
import {
  cenariosConferencia,
  demonstrarConferencia,
  type CenarioConferencia,
} from "../schemas/demonstracao-conferencia";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    valor / 100,
  );
export function DemonstracaoConferencia() {
  const [cenario, setCenario] = useState<CenarioConferencia>("taxa");
  const dados = demonstrarConferencia(cenario);
  const resultado = dados.resultados[0];
  return (
    <section
      className="border-line bg-surface rounded-2xl border p-5 sm:p-6"
      aria-label="Demonstração com dados fictícios"
    >
      <p className="text-info text-xs font-bold tracking-wide uppercase">
        Exemplo fictício · sem gravação
      </p>
      <h2 className="mt-2 text-xl font-bold tracking-tight">
        Entrou no banco. A taxa está certa?
      </h2>
      <p className="text-ink-3 mt-2 max-w-3xl text-sm leading-relaxed">
        Uma venda de R$ 1.250,00, com taxa contratada de 3%. Altere a evidência
        para ver como a conclusão muda.
      </p>
      <div
        className="mt-5 flex flex-wrap gap-2"
        aria-label="Cenários do exemplo"
      >
        {Object.entries(cenariosConferencia).map(([id, nome]) => (
          <button
            key={id}
            aria-pressed={cenario === id}
            onClick={() => setCenario(id as CenarioConferencia)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${cenario === id ? "border-accent bg-accent-sub text-accent" : "border-line-2 hover:bg-surface-2"}`}
          >
            {nome}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          [
            "Venda no PDV",
            "R$ 1.250,00",
            "Contrato: 3,00% · taxa prevista R$ 37,50",
          ],
          [
            "Adquirente",
            "R$ 1.206,25",
            "Taxa cobrada: R$ 43,75 · lote payout-1",
          ],
          [
            "Banco",
            cenario === "semBanco"
              ? "Sem crédito"
              : cenario === "lote"
                ? "R$ 1.691,25"
                : "R$ 1.206,25",
            cenario === "lote"
              ? "Depósito para 2 vendas · alocação por componente"
              : "Conta account-demo · lote payout-1",
          ],
        ].map(([titulo, valor, detalhe]) => (
          <div className="bg-surface-2 rounded-xl p-4" key={titulo}>
            <p className="text-ink-3 text-sm">{titulo}</p>
            <p className="mt-2 text-xl font-bold tabular-nums">{valor}</p>
            <p className="text-ink-3 mt-2 text-xs leading-relaxed">{detalhe}</p>
          </div>
        ))}
      </div>
      <div
        className="bg-warn-sub text-warn mt-4 flex items-start gap-3 rounded-xl p-4"
        role="status"
        aria-live="polite"
      >
        <Icone nome="alerta" className="mt-0.5 shrink-0" />
        <div>
          <strong>
            {estados[resultado.estado]}
            {resultado.diferencaTaxaCentavos != null &&
              ` · ${moeda(resultado.diferencaTaxaCentavos)}`}
          </strong>
          <p className="mt-1 text-sm">
            {cenario === "parcial"
              ? "Cobertura parcial: a diferença de taxa continua visível, mas não é possível fechar o período."
              : cenario === "semBanco"
                ? "A adquirente liquidou. Falta comprovar o crédito na conta."
                : cenario === "duplicado"
                  ? "Duas linhas usam a mesma chave. Nenhuma delas é confirmada automaticamente."
                  : cenario === "lote"
                    ? "R$ 1.206,25 atribuídos à primeira venda e R$ 485,00 à segunda. O crédito total não é contado duas vezes."
                    : "O crédito confirma o líquido recebido. A cobrança excede a taxa contratada em R$ 6,25."}
          </p>
        </div>
      </div>
    </section>
  );
}
