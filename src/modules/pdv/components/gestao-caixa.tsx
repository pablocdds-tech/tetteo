"use client";

import { useRouter } from "next/navigation";
import { LinkIntegrado as Link } from "@/core/shell/link-integrado";
import { useState, useTransition } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { lerNumeroBr } from "@/lib/numero";

import { abrirCaixaAcao, fecharCaixaAcao, movimentarCaixaAcao } from "../acoes";
import type { CaixaPdv } from "../types";

const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (valor: string) => new Date(valor).toLocaleString("pt-BR");
type Operacao = "ABRIR" | "SANGRIA" | "SUPRIMENTO" | "FECHAR";
const titulos: Record<Operacao, string> = {
  ABRIR: "Abrir caixa",
  SANGRIA: "Registrar sangria",
  SUPRIMENTO: "Registrar suprimento",
  FECHAR: "Fechar e conferir caixa",
};

export function GestaoCaixa({
  caixa,
  caixasAnteriores,
  locais,
  podeOperar,
}: {
  caixa: CaixaPdv | null;
  caixasAnteriores: CaixaPdv[];
  locais: { id: string; nome: string }[];
  podeOperar: boolean;
}) {
  const router = useRouter();
  const [operacao, setOperacao] = useState<Operacao | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [localId, setLocalId] = useState(
    locais.length === 1 ? locais[0].id : "",
  );
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [pendente, iniciar] = useTransition();
  const [anterior, setAnterior] = useState<CaixaPdv | null>(null);
  const numero = lerNumeroBr(valor);
  const centavos = typeof numero === "number" ? Math.round(numero * 100) : null;

  function abrir(tipo: Operacao) {
    setValor("");
    setMotivo("");
    setErro("");
    setSucesso("");
    setOperacao(tipo);
  }

  function confirmar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!operacao || pendente) return;
    if (
      centavos === null ||
      !Number.isSafeInteger(centavos) ||
      centavos < 0 ||
      (numero !== null &&
        numero !== undefined &&
        Math.abs(numero * 100 - centavos) > 0.00001)
    ) {
      setErro("Informe um valor válido, com até duas casas decimais.");
      return;
    }
    if (operacao === "ABRIR" && !localId) {
      setErro("Selecione o local de estoque que atenderá este caixa.");
      return;
    }
    if (
      (operacao === "SANGRIA" || operacao === "SUPRIMENTO") &&
      (!motivo.trim() || centavos <= 0)
    ) {
      setErro("Informe um valor maior que zero e o motivo da movimentação.");
      return;
    }
    setErro("");
    iniciar(async () => {
      try {
        const resultado =
          operacao === "ABRIR"
            ? await abrirCaixaAcao({
                saldoInicialCentavos: centavos,
                localEstoqueId: localId,
              })
            : operacao === "FECHAR"
              ? await fecharCaixaAcao({
                  caixaId: caixa!.id,
                  valorContadoCentavos: centavos,
                  observacao: motivo.trim(),
                })
              : await movimentarCaixaAcao({
                  caixaId: caixa!.id,
                  tipo: operacao,
                  valorCentavos: centavos,
                  motivo: motivo.trim(),
                });
        if (resultado.erro) setErro(resultado.erro);
        else {
          setSucesso(resultado.ok ?? "Caixa atualizado.");
          setOperacao(null);
          router.refresh();
        }
      } catch {
        setErro(
          "Não foi possível confirmar a operação. Atualize o caixa antes de tentar novamente.",
        );
      }
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caixa</h1>
          <p className="text-ink-3 mt-1 text-sm">
            Abertura, movimentações em dinheiro e conferência do expediente.
          </p>
        </div>
        {podeOperar && !caixa && (
          <Botao onClick={() => abrir("ABRIR")} disabled={locais.length === 0}>
            Abrir caixa
          </Botao>
        )}
      </header>
      {sucesso && (
        <p
          role="status"
          className="bg-ok-sub text-ok rounded-lg px-4 py-3 text-sm"
        >
          {sucesso}
        </p>
      )}
      <section className="border-line bg-surface overflow-hidden rounded-xl border">
        <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="font-semibold">
              {caixa ? "Caixa em operação" : "Caixa fechado"}
            </h2>
            <p className="text-ink-3 mt-1 text-sm">
              {caixa
                ? `Aberto por ${caixa.operador} em ${data(caixa.abertoEm)}`
                : "Abra o caixa antes de registrar a primeira venda."}
            </p>
          </div>
          <span
            className={`${caixa ? "bg-ok-sub text-ok" : "bg-surface-2 text-ink-2"} rounded-full px-3 py-1 text-sm font-medium`}
          >
            {caixa ? "Aberto" : "Fechado"}
          </span>
        </div>
        {caixa ? (
          <>
            <dl className="grid gap-6 px-5 py-6 sm:grid-cols-3">
              <div>
                <dt className="text-ink-3 text-sm">Fundo inicial</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {moeda(caixa.saldoInicialCentavos)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3 text-sm">
                  Dinheiro esperado em caixa
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {moeda(caixa.saldoEsperadoCentavos)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3 text-sm">Saída de estoque</dt>
                <dd className="mt-1 font-medium">
                  {locais.find((local) => local.id === caixa.localEstoqueId)
                    ?.nome ?? "Local vinculado na abertura"}
                </dd>
              </div>
            </dl>
            {podeOperar && (
              <div className="border-line flex flex-wrap gap-2 border-t px-5 py-4">
                <Botao peso="secundario" onClick={() => abrir("SUPRIMENTO")}>
                  Suprimento
                </Botao>
                <Botao peso="secundario" onClick={() => abrir("SANGRIA")}>
                  Sangria
                </Botao>
                <Botao className="sm:ml-auto" onClick={() => abrir("FECHAR")}>
                  Fechar caixa
                </Botao>
              </div>
            )}
          </>
        ) : (
          <div className="text-ink-3 px-5 py-8 text-sm">
            {locais.length === 0 ? (
              <>
                Cadastre um local de estoque para vincular as saídas das vendas.{" "}
                <Link className="text-accent underline" href="/estoque">
                  Ir para locais de estoque
                </Link>
                .
              </>
            ) : (
              "O saldo inicial é o dinheiro disponível para troco. Cartão e Pix são registrados separadamente nas vendas."
            )}
          </div>
        )}
      </section>
      {caixa && (
        <section className="border-line bg-surface overflow-hidden rounded-xl border">
          <h2 className="border-line border-b px-5 py-4 font-semibold">
            Movimentações do caixa
          </h2>
          {caixa.movimentos.length ? (
            <div className="divide-line divide-y">
              {caixa.movimentos.map((movimento) => (
                <div
                  key={movimento.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {movimento.tipo === "SANGRIA"
                        ? "Sangria"
                        : movimento.tipo === "SUPRIMENTO"
                          ? "Suprimento"
                          : movimento.tipo}
                    </p>
                    <p className="text-ink-3 mt-0.5 text-sm">
                      {movimento.motivo}
                    </p>
                    <p className="text-ink-3 mt-1 text-xs">
                      {data(movimento.criadoEm)}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {movimento.tipo === "SANGRIA" ? "− " : "+ "}
                    {moeda(movimento.valorCentavos)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ink-3 px-5 py-6 text-sm">
              Nenhuma sangria ou suprimento registrado neste caixa.
            </p>
          )}
        </section>
      )}
      <section className="border-line bg-surface overflow-hidden rounded-xl border">
        <h2 className="border-line border-b px-5 py-4 font-semibold">
          Caixas anteriores
        </h2>
        {caixasAnteriores.length ? (
          <div className="divide-line divide-y">
            {caixasAnteriores.map((sessao) => (
              <button
                type="button"
                key={sessao.id}
                onClick={() => setAnterior(sessao)}
                className="hover:bg-surface-2 focus-visible:outline-accent flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              >
                <span>
                  <span className="block text-sm font-medium">
                    {data(sessao.abertoEm)}
                  </span>
                  <span className="text-ink-3 mt-1 block text-sm">
                    {sessao.operador} ·{" "}
                    {sessao.fechadoEm
                      ? `Fechado em ${data(sessao.fechadoEm)}`
                      : "Em aberto"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">
                    {moeda(
                      sessao.valorContadoCentavos ??
                        sessao.saldoEsperadoCentavos,
                    )}
                  </span>
                  <span
                    className={`mt-1 block text-sm ${sessao.diferencaCentavos ? "text-warn" : "text-ink-3"}`}
                  >
                    {sessao.diferencaCentavos === null
                      ? "Sem conferência"
                      : sessao.diferencaCentavos === 0
                        ? "Conferido sem diferença"
                        : `Diferença: ${moeda(sessao.diferencaCentavos)}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-ink-3 px-5 py-6 text-sm">
            Os fechamentos aparecerão aqui após o primeiro expediente.
          </p>
        )}
      </section>
      <PainelLateral
        aberto={operacao !== null}
        aoFechar={() => {
          if (!pendente) setOperacao(null);
        }}
        podeFechar={() => !pendente}
        titulo={operacao ? titulos[operacao] : "Caixa"}
        rodape={
          <>
            <Botao
              peso="secundario"
              disabled={pendente}
              onClick={() => setOperacao(null)}
            >
              Voltar
            </Botao>
            <Botao form="operacao-caixa" type="submit" carregando={pendente}>
              Confirmar{" "}
              {operacao === "FECHAR"
                ? "fechamento"
                : operacao === "ABRIR"
                  ? "abertura"
                  : "movimentação"}
            </Botao>
          </>
        }
      >
        <form id="operacao-caixa" onSubmit={confirmar} className="space-y-5">
          {operacao === "ABRIR" && (
            <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
              Local de saída do estoque
              <select
                value={localId}
                onChange={(evento) => setLocalId(evento.target.value)}
                required
                className="border-line-2 bg-surface text-ink h-10 w-full rounded-md border px-3 font-normal"
              >
                <option value="">Selecione um local</option>
                {locais.map((local) => (
                  <option key={local.id} value={local.id}>
                    {local.nome}
                  </option>
                ))}
              </select>
              <span className="text-ink-3 text-sm font-normal">
                As receitas dos produtos serão baixadas deste local.
              </span>
            </label>
          )}
          {operacao === "FECHAR" && caixa && (
            <div className="bg-surface-2 rounded-lg p-4">
              <p className="text-ink-3 text-sm">Dinheiro esperado</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {moeda(caixa.saldoEsperadoCentavos)}
              </p>
              <p className="text-ink-3 mt-2 text-sm">
                Conte o dinheiro físico, incluindo o fundo de troco.
              </p>
            </div>
          )}
          <Campo
            rotulo={
              operacao === "ABRIR"
                ? "Saldo inicial (R$)"
                : operacao === "FECHAR"
                  ? "Dinheiro contado (R$)"
                  : "Valor (R$)"
            }
            value={valor}
            onChange={(evento) => setValor(evento.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            required
            autoComplete="off"
            disabled={pendente}
          />
          {operacao !== "ABRIR" && (
            <Campo
              rotulo={
                operacao === "FECHAR" ? "Observação da conferência" : "Motivo"
              }
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              maxLength={500}
              required={operacao !== "FECHAR"}
              disabled={pendente}
            />
          )}
          {operacao === "FECHAR" && caixa && centavos !== null && (
            <p
              className={`text-sm ${centavos === caixa.saldoEsperadoCentavos ? "text-ok" : "text-warn"}`}
            >
              Diferença da conferência:{" "}
              <strong>{moeda(centavos - caixa.saldoEsperadoCentavos)}</strong>
            </p>
          )}
          {erro && (
            <p
              role="alert"
              className="text-bad bg-bad-sub rounded-lg px-3 py-2 text-sm"
            >
              {erro}
            </p>
          )}
        </form>
      </PainelLateral>
      <PainelLateral
        aberto={anterior !== null}
        aoFechar={() => setAnterior(null)}
        titulo="Conferência do caixa"
        rodape={
          <Link href="/pdv/vendas" className={estiloDeBotao("secundario")}>
            Consultar vendas
          </Link>
        }
      >
        {anterior && (
          <dl className="space-y-4 text-sm">
            {[
              ["Abertura", data(anterior.abertoEm)],
              [
                "Fechamento",
                anterior.fechadoEm ? data(anterior.fechadoEm) : "Em aberto",
              ],
              ["Operador", anterior.operador],
              ["Fundo inicial", moeda(anterior.saldoInicialCentavos)],
              ["Dinheiro esperado", moeda(anterior.saldoEsperadoCentavos)],
              [
                "Dinheiro contado",
                anterior.valorContadoCentavos === null
                  ? "Não informado"
                  : moeda(anterior.valorContadoCentavos),
              ],
              [
                "Diferença",
                anterior.diferencaCentavos === null
                  ? "Sem conferência"
                  : moeda(anterior.diferencaCentavos),
              ],
            ].map(([rotulo, conteudo]) => (
              <div
                key={rotulo}
                className="border-line flex justify-between gap-4 border-b pb-3"
              >
                <dt className="text-ink-3">{rotulo}</dt>
                <dd className="text-right font-medium">{conteudo}</dd>
              </div>
            ))}
          </dl>
        )}
      </PainelLateral>
    </div>
  );
}
