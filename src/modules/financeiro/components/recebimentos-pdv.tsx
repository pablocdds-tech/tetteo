"use client";
import { useState } from "react";
import Link from "next/link";
import type { consultarRecebimentosPdv } from "../services/recebimentos-pdv";
import {
  NOMES_RECEBIMENTO_PDV,
  type RegraRecebimentoPdv,
} from "../schemas/recebimentos-pdv";

type Dados = Awaited<ReturnType<typeof consultarRecebimentosPdv>>;
const campo =
  "border-line-2 bg-surface mt-1 block min-h-11 w-full rounded-md border px-3 py-2 text-sm";
export function RecebimentosPdv({ inicial }: { inicial: Dados }) {
  const [dados, setDados] = useState(inicial),
    [regras, setRegras] = useState<RegraRecebimentoPdv[]>(inicial.regras);
  const [ocupado, setOcupado] = useState(false),
    [erro, setErro] = useState(""),
    [mensagem, setMensagem] = useState("");
  const alterado = JSON.stringify(regras) !== JSON.stringify(dados.regras);
  function mudar(forma: string, campos: Partial<RegraRecebimentoPdv>) {
    setRegras((atual) =>
      atual.map((r) => (r.forma === forma ? { ...r, ...campos } : r)),
    );
  }
  async function enviar(processar = false) {
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      const r = await fetch(
        `/api/financeiro/${processar ? "processar-recebimentos-pdv" : "recebimentos-pdv"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(processar ? {} : { regras }),
        },
      );
      const resposta = await r.json();
      if (!r.ok) throw new Error(resposta.erro ?? "Não foi possível concluir.");
      setMensagem(resposta.mensagem);
      const recarga = await fetch("/api/financeiro/recebimentos-pdv", {
        cache: "no-store",
      });
      if (!recarga.ok)
        throw new Error(
          "Operação concluída. Atualize a página para conferir os dados.",
        );
      const novo: Dados = await recarga.json();
      setDados(novo);
      setRegras(novo.regras);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Operação indisponível.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="space-y-5" aria-busy={ocupado}>
      <p className="text-ink-2 text-sm">
        Configure por unidade. Recebimentos novos do PDV ficam em uma fila
        durável até você processá-los. Vendas anteriores à implantação desta
        fila não são importadas automaticamente.
      </p>
      <p className="text-ink-3 text-sm">
        Cadastre primeiro{" "}
        <Link className="text-accent underline" href="/financeiro/contas">
          empresas e contas
        </Link>{" "}
        e um{" "}
        <Link className="text-accent underline" href="/financeiro/planos">
          plano de receita
        </Link>
        . Você pode salvar um rascunho desativado sem esses cadastros.
      </p>
      <div aria-live="polite">
        {erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-lg p-3 text-sm"
          >
            {erro}
          </p>
        )}
        {mensagem && (
          <p role="status" className="bg-ok-sub text-ok rounded-lg p-3 text-sm">
            {mensagem}
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="space-y-4"
      >
        {regras.map((r) => (
          <fieldset
            disabled={ocupado}
            key={r.forma}
            className="border-line bg-surface space-y-4 rounded-xl border p-4"
          >
            <legend className="px-1 text-base font-semibold">
              {NOMES_RECEBIMENTO_PDV[r.forma]}
            </legend>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={r.ativa}
                onChange={(e) => mudar(r.forma, { ativa: e.target.checked })}
              />
              Ativar {NOMES_RECEBIMENTO_PDV[r.forma]}
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="text-sm">
                Empresa / CNPJ
                <select
                  className={campo}
                  aria-label={`Empresa ${r.forma}`}
                  value={r.empresaId ?? ""}
                  required={r.ativa}
                  onChange={(e) =>
                    mudar(r.forma, {
                      empresaId: e.target.value || null,
                      contaId: null,
                    })
                  }
                >
                  <option value="">Selecione</option>
                  {dados.empresas.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Conta de destino
                <select
                  className={campo}
                  aria-label={`Conta ${r.forma}`}
                  value={r.contaId ?? ""}
                  required={r.ativa}
                  onChange={(e) =>
                    mudar(r.forma, { contaId: e.target.value || null })
                  }
                >
                  <option value="">Selecione</option>
                  {dados.contas
                    .filter((x) => x.empresaId === r.empresaId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                Plano de receita
                <select
                  className={campo}
                  aria-label={`Plano ${r.forma}`}
                  value={r.categoriaId ?? ""}
                  required={r.ativa}
                  onChange={(e) =>
                    mudar(r.forma, { categoriaId: e.target.value || null })
                  }
                >
                  <option value="">Selecione</option>
                  {dados.planos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Taxa contratada (%)
                <input
                  className={campo}
                  aria-label={`Taxa ${r.forma}`}
                  type="number"
                  min="0"
                  max={r.forma === "DINHEIRO" ? "0" : "99.99"}
                  step="0.01"
                  placeholder="Informe, inclusive se for zero"
                  required={r.ativa}
                  value={r.taxaBps === null ? "" : r.taxaBps / 100}
                  onChange={(e) =>
                    mudar(r.forma, {
                      taxaBps:
                        e.target.value === ""
                          ? null
                          : Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <label className="text-sm">
                Prazo (dias corridos)
                <input
                  className={campo}
                  aria-label={`Prazo ${r.forma}`}
                  type="number"
                  min="0"
                  max={r.forma === "DINHEIRO" ? "0" : "365"}
                  step="1"
                  placeholder="Informe, inclusive se for zero"
                  required={r.ativa}
                  value={r.prazoDias ?? ""}
                  onChange={(e) =>
                    mudar(r.forma, {
                      prazoDias:
                        e.target.value === "" ? null : Number(e.target.value),
                      baixarNoRecebimento: false,
                    })
                  }
                />
              </label>
            </div>
            {["DINHEIRO", "PIX"].includes(r.forma) ? (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.baixarNoRecebimento}
                  disabled={r.prazoDias !== 0}
                  onChange={(e) =>
                    mudar(r.forma, { baixarNoRecebimento: e.target.checked })
                  }
                />
                Ao processar, baixar na data confirmada no PDV (exige prazo
                zero).
              </label>
            ) : (
              <p className="text-ink-3 text-sm">
                Cartão gera conta a receber. A baixa acontece após conferir o
                crédito pelo banco ou manualmente.
              </p>
            )}
          </fieldset>
        ))}
        <p className="text-ink-3 text-sm">
          A taxa reduz o valor a receber e aparece como desconto no lançamento.
          Não cadastre a mesma taxa novamente como despesa. Mudanças valem para
          eventos ainda não integrados; lançamentos anteriores preservam sua
          configuração.
        </p>
        <button
          className="bg-accent text-on-accent min-h-11 rounded-md px-4 py-2 font-semibold"
          disabled={ocupado}
        >
          Salvar configuração
        </button>
      </form>
      <div className="border-line space-y-3 border-t pt-5">
        <p className="font-semibold">
          {dados.pendentes} eventos aguardando integração ou conferência
        </p>
        <button
          type="button"
          className="border-line-2 min-h-11 rounded-md border px-4 py-2 text-sm font-semibold"
          disabled={ocupado || alterado || !dados.pendentes}
          onClick={() => void enviar(true)}
        >
          Processar recebimentos
        </button>
        {alterado && (
          <p className="text-ink-3 text-sm">
            Salve as alterações antes de processar.
          </p>
        )}
        <p className="text-ink-3 text-sm">
          Cada lote processa até 50 eventos. Cancelar uma venda não devolve
          dinheiro ao cliente. Se houver baixa, confira a devolução e estorne-a
          no financeiro antes de reprocessar o cancelamento.
        </p>
        {dados.problemas.length > 0 && (
          <ul className="space-y-2 text-sm">
            {dados.problemas.map((p) => (
              <li key={p.id} className="border-line rounded-md border p-3">
                Venda {p.evento.correlacaoId}: {p.ultimoErro}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
