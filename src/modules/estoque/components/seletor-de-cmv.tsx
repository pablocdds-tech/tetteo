"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * As duas pontas e o faturamento.
 *
 * O estado vive na URL, não no componente: assim o número que você está
 * olhando tem endereço próprio e pode ser mandado para o contador ou aberto
 * de novo amanhã e dar o mesmo resultado.
 *
 * O faturamento fica de fora do banco de propósito. Ele vem do PDV e vai ser
 * puxado de lá quando a integração existir — guardar uma cópia digitada agora
 * criaria uma segunda verdade sobre a mesma venda.
 */
export function SeletorDeCmv({
  contagens,
  de,
  ate,
  faturamento,
}: {
  contagens: { id: string; rotulo: string }[];
  de: string;
  ate: string;
  faturamento: string;
}) {
  const router = useRouter();
  const [inicial, setInicial] = useState(de);
  const [final, setFinal] = useState(ate);
  const [faturado, setFaturado] = useState(faturamento);

  function aplicar() {
    const q = new URLSearchParams({ de: inicial, ate: final });
    if (faturado.trim()) q.set("faturamento", faturado.trim());
    router.push(`/estoque/cmv?${q.toString()}`);
  }

  return (
    <div className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex w-full flex-col gap-1.5">
          <label htmlFor="de" className="text-ink-2 text-sm font-semibold">
            Contagem inicial
          </label>
          <select
            id="de"
            value={inicial}
            onChange={(e) => setInicial(e.target.value)}
            className={ESTILO_SELECT}
          >
            {contagens.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div className="flex w-full flex-col gap-1.5">
          <label htmlFor="ate" className="text-ink-2 text-sm font-semibold">
            Contagem final
          </label>
          <select
            id="ate"
            value={final}
            onChange={(e) => setFinal(e.target.value)}
            className={ESTILO_SELECT}
          >
            {contagens.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
        <Campo
          rotulo="Faturamento do período"
          inputMode="decimal"
          value={faturado}
          onChange={(e) => setFaturado(e.target.value)}
          placeholder="Ex.: 48.500,00"
          ajuda="Opcional. Serve para ver o CMV em porcentagem — vem do PDV quando a integração entrar."
        />
        <Botao type="button" onClick={aplicar} className="mb-6">
          Calcular
        </Botao>
      </div>
    </div>
  );
}
