"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/design-system/botao";

const campo =
  "border-line-2 bg-surface w-full rounded-lg border px-3 py-2 text-sm focus:outline-2 focus:outline-accent";
export function PainelOperacao({
  pedidos,
  logistica,
}: {
  pedidos: boolean;
  logistica: boolean;
}) {
  const [ocupado, setOcupado] = useState(false),
    [resultado, setResultado] = useState(""),
    [erro, setErro] = useState("");
  const router = useRouter();
  async function enviar(tipo: string, dados: unknown) {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    setResultado("");
    try {
      const response = await fetch("/api/saipos/operacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, dados }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Operação não concluída.");
      setResultado(JSON.stringify(data.result, null, 2));
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Operação não concluída.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-6">
      <section className="border-line bg-surface rounded-xl border p-5">
        <h2 className="font-semibold">Consultar o PDV</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Cardápio e garçons vêm diretamente da Saipos. O catálogo retorna um
          link temporário.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["catalogo", "Consultar cardápio"],
            ["garcons", "Consultar garçons"],
            ["comandas", "Consultar comandas"],
          ].map(([consulta, label]) => (
            <Botao
              key={consulta}
              peso="secundario"
              disabled={!pedidos || ocupado}
              onClick={() => enviar("consulta", { consulta })}
            >
              {label}
            </Botao>
          ))}
        </div>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const consulta = String(f.get("consulta")),
              value = String(f.get("referencia"));
            void enviar("consulta", {
              consulta,
              parametros: {
                [consulta === "pedido"
                  ? "order_id"
                  : consulta === "comanda"
                    ? "order_card"
                    : "table"]: value,
              },
            });
          }}
        >
          <label className="text-sm">
            Consultar
            <select name="consulta" className={campo}>
              <option value="pedido">Pedido</option>
              <option value="mesa">Mesa</option>
              <option value="comanda">Comanda</option>
            </select>
          </label>
          <label className="text-sm">
            Identificador
            <input
              name="referencia"
              required
              maxLength={100}
              className={campo}
            />
          </label>
          <Botao type="submit" disabled={!pedidos || ocupado}>
            Consultar
          </Botao>
        </form>
      </section>
      <details className="border-line bg-surface rounded-xl border p-5">
        <summary className="cursor-pointer font-semibold">
          Enviar e operar pedidos
        </summary>
        <p className="text-ink-3 mt-3 text-sm">
          Área de integração do diretor. Envie o contrato do pedido ou de uma
          alteração. O código de loja vem da configuração privada; repetições
          mantêm o mesmo registro. Uma resposta incerta exige conferência no
          PDV.
        </p>
        <FormularioContrato
          tipo="pedido"
          habilitado={pedidos}
          ocupado={ocupado}
          enviar={enviar}
          exemplo={
            '{"acao":"criar","pedido":{"order_id":"identificador-unico","display_id":"001","created_at":"2026-10-26T12:00:00Z","total_discount":0,"customer":{"id":-1,"name":"Consumidor não identificado"},"order_method":{"mode":"TAKEOUT"},"items":[{"integration_code":"CODIGO-PDV","desc_item":"Nome do produto","quantity":1,"unit_price":10}],"payment_types":[{"code":"DIN","amount":10,"type":"OFFLINE"}]}}'
          }
        />
        <p className="text-ink-3 mt-2 text-xs">
          Também aceita adicionar itens, status, cancelar, fechar, transferir e
          converter conforme o contrato. O exemplo precisa dos códigos PDV e
          data reais do teste.
        </p>
      </details>
      <details className="border-line bg-surface rounded-xl border p-5">
        <summary className="cursor-pointer font-semibold">
          Atualizar uma entrega na Saipos
        </summary>
        <p className="text-ink-3 mt-3 text-sm">
          Use o deliveryId recebido pelo Tetteo e os dados reais do entregador.
          O estado só muda após confirmação da Saipos. Cancelar a entrega mantém
          a venda no PDV.
        </p>
        <FormularioContrato
          tipo="tracking"
          habilitado={logistica}
          ocupado={ocupado}
          enviar={enviar}
          exemplo={
            '{"deliveryId":"UUID-DA-ENTREGA","orderId":"UUID-DO-PEDIDO","orderDisplayId":"001","merchant":{"id":"MERCHANT-ID","name":"Nome da loja"},"event":{"type":"PENDING","datetime":"2026-10-26T12:00:00Z"}}'
          }
        />
      </details>
      {ocupado && (
        <p role="status" className="text-ink-3 text-sm">
          Aguardando a Saipos…
        </p>
      )}
      {erro && (
        <p role="alert" className="bg-bad-sub text-bad rounded-lg p-4 text-sm">
          {erro}
        </p>
      )}
      {resultado && (
        <section
          aria-label="Resultado da operação"
          className="border-line bg-surface rounded-xl border p-4"
        >
          <h2 className="mb-2 font-semibold">Resposta da integração</h2>
          <pre className="max-h-96 overflow-auto text-xs break-all whitespace-pre-wrap">
            {resultado}
          </pre>
        </section>
      )}
    </div>
  );
}
function FormularioContrato({
  tipo,
  habilitado,
  ocupado,
  enviar,
  exemplo,
}: {
  tipo: string;
  habilitado: boolean;
  ocupado: boolean;
  enviar: (tipo: string, dados: unknown) => Promise<void>;
  exemplo: string;
}) {
  const [erro, setErro] = useState("");
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(
            String(new FormData(e.currentTarget).get("contrato")),
          );
          setErro("");
          void enviar(tipo, data);
        } catch {
          setErro("O conteúdo precisa ser um JSON válido.");
        }
      }}
    >
      <label className="block text-sm">
        Contrato da operação
        <textarea
          name="contrato"
          required
          maxLength={250000}
          rows={8}
          className={`${campo} mt-1 font-mono`}
          placeholder={exemplo}
          spellCheck={false}
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required className="mt-1" />
        Conferi o ambiente e os dados desta operação.
      </label>
      {erro && (
        <p role="alert" className="text-bad text-sm">
          {erro}
        </p>
      )}
      <Botao type="submit" disabled={!habilitado || ocupado}>
        {ocupado ? "Enviando…" : "Enviar para a Saipos"}
      </Botao>
      {!habilitado && (
        <p className="text-warn text-sm">
          Aguarda configuração privada e liberação do ambiente.
        </p>
      )}
    </form>
  );
}
