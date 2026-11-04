"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Botao } from "@/design-system/botao";
import type { LinhaDaFolha } from "./folha-de-checklist";

const nomes: Record<string, string> = {
  NAO_SOLICITADA: "Aguardando conferência",
  PENDENTE: "IA analisando",
  APROVADO: "Aprovado",
  REPROVADO: "Reprovado",
  INCONCLUSIVO: "Precisa de revisão",
  INDISPONIVEL: "Conferência indisponível",
};
const campo =
  "border-line-2 bg-surface min-h-11 w-full rounded-md border px-3 py-2 text-base";

export function ConferenciaChecklist({
  respostaId,
  linhas,
  podeRevisar,
}: {
  respostaId: string;
  linhas: LinhaDaFolha[];
  podeRevisar: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const itens = linhas.filter((l) => l.analisarIA && !l.naoSeAplica);
  const analisando = itens.some((l) =>
    ["PENDENTE", "NAO_SOLICITADA"].includes(l.resultadoIA),
  );
  useEffect(() => {
    if (!analisando) return;
    let tentativas = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++tentativas >= 12) clearInterval(timer);
    }, 5000);
    return () => clearInterval(timer);
  }, [analisando, router]);
  if (itens.length === 0) return null;

  async function enviar(caminho: string, corpo?: object) {
    setOcupado(true);
    setAviso("");
    try {
      const res = await fetch(`/api/checklists/${respostaId}/${caminho}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo ?? {}),
      });
      const resultado = await res.json();
      if (!res.ok)
        throw new Error(
          resultado.erro ?? "Não foi possível conferir. Tente novamente.",
        );
      setAviso(
        caminho === "revisar"
          ? "Revisão registrada no histórico."
          : resultado.configurada === false
            ? "A conferência por IA ainda precisa ser configurada. O gestor pode revisar os itens abaixo."
            : "Conferência atualizada. Confira o resultado de cada item.",
      );
      router.refresh();
    } catch (erro) {
      setAviso(
        erro instanceof Error ? erro.message : "Sem conexão. Tente novamente.",
      );
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="border-line mt-6 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Conferência das evidências</h2>
          <p className="text-ink-3 mt-1 text-sm">
            {itens.filter((i) => i.resultadoIA === "APROVADO").length} de{" "}
            {itens.length} aprovados. Checklist respondido e conferência
            aprovada são etapas distintas.
          </p>
        </div>
        {podeRevisar && (
          <Botao
            type="button"
            peso="secundario"
            carregando={ocupado}
            onClick={() => void enviar("conferir")}
          >
            Conferir com IA
          </Botao>
        )}
      </div>
      <ul className="divide-line mt-3 divide-y">
        {itens.map((item) => (
          <li key={`${item.id}-${item.versao}`} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{item.textoItem}</h3>
              <span
                className={`rounded-sm px-2 py-1 text-sm font-semibold ${item.resultadoIA === "APROVADO" ? "bg-ok-sub text-ok" : item.resultadoIA === "REPROVADO" ? "bg-bad-sub text-bad" : "bg-warn-sub text-warn"}`}
              >
                {nomes[item.resultadoIA] ?? "Precisa de revisão"}
              </span>
            </div>
            <p className="text-ink-3 mt-1 text-sm">
              Critério: {item.criterioIA}
            </p>
            {item.motivoIA && (
              <p className="text-ink-2 mt-2 text-sm whitespace-pre-wrap">
                {item.motivoIA}
              </p>
            )}
            {item.confiancaIA !== null && (
              <p className="text-ink-3 mt-1 text-xs">
                Confiança informada pela IA:{" "}
                {Math.round(item.confiancaIA * 100)}%
              </p>
            )}
            {item.revisadoPorId && (
              <p className="text-ink-2 mt-1 text-sm">
                Resultado confirmado por revisão humana. O parecer anterior
                permanece no histórico.
              </p>
            )}
            {podeRevisar && (
              <details className="mt-2">
                <summary className="text-accent min-h-11 cursor-pointer py-2 text-sm font-semibold">
                  Registrar revisão do gestor
                </summary>
                <form
                  className="mt-2 flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const dados = new FormData(e.currentTarget);
                    void enviar("revisar", {
                      itemId: item.respostaItemId,
                      resultado: dados.get("resultado"),
                      motivo: dados.get("motivo"),
                      versaoEsperada: item.versao,
                    });
                  }}
                >
                  <label className="text-ink-2 text-sm">
                    Resultado
                    <select
                      name="resultado"
                      className={campo}
                      defaultValue="INCONCLUSIVO"
                    >
                      <option value="INCONCLUSIVO">
                        Precisa de nova evidência
                      </option>
                      <option value="APROVADO">Aprovado</option>
                      <option value="REPROVADO">Reprovado</option>
                    </select>
                  </label>
                  <label className="text-ink-2 text-sm">
                    Motivo da revisão
                    <textarea
                      name="motivo"
                      required
                      minLength={8}
                      maxLength={1000}
                      rows={3}
                      className={campo}
                    />
                  </label>
                  <Botao type="submit" peso="secundario" disabled={ocupado}>
                    Salvar revisão
                  </Botao>
                </form>
              </details>
            )}
          </li>
        ))}
      </ul>
      {aviso && (
        <p role="status" className="text-ink-2 mt-2 text-sm">
          {aviso}
        </p>
      )}
    </section>
  );
}
