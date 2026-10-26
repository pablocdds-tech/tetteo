import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/financeiro/components/aviso-unidade";
import {
  FormContaBanco,
  FormEmpresaBanco,
  FormTransferenciaBanco,
} from "@/modules/financeiro/components/formularios-bancos";
import {
  listarEmpresasBancarias,
  listarSaldosBancarios,
  assinaturaEmpresa,
} from "@/modules/financeiro/services/bancos";
import {
  centavos,
  reais,
  diaNoFuso,
} from "@/modules/financeiro/schemas/bancos";
import { db } from "@/server/db";
import { MarcaBanco } from "@/modules/financeiro/components/marca-banco";

export default async function PaginaContasBancarias({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "financeiro.ver")) notFound();
  if (!ctx.unidadeAtiva) return <AvisoUnidade acao="Ver as contas bancárias" />;
  const [empresas, contas, unidade, filtro] = await Promise.all([
    listarEmpresasBancarias(ctx),
    listarSaldosBancarios(ctx),
    db.unidade.findUniqueOrThrow({
      where: { id: ctx.unidadeAtiva.id },
      select: { fusoHorario: true },
    }),
    searchParams,
  ]);
  const hoje = diaNoFuso(new Date(), unidade.fusoHorario);
  const editar = pode(ctx, "financeiro.lancar");
  const empresaSelecionada = empresas.some((e) => e.id === filtro.empresa)
    ? filtro.empresa!
    : filtro.empresa === "pendentes" || !empresas.length
      ? "pendentes"
      : empresas[0].id;
  const visiveis = contas.filter((c) =>
    empresaSelecionada === "pendentes"
      ? !c.empresaId
      : c.empresaId === empresaSelecionada,
  );
  const total = reais(visiveis.reduce((s, c) => s + centavos(c.saldo), 0n));
  return (
    <div className="mx-auto w-full max-w-5xl">
      <p className="text-ink-3 text-sm">{ctx.unidadeAtiva.nome} / Financeiro</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Contas bancárias
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            Cada saldo no seu CNPJ, todos na mesma operação.
          </p>
        </div>
        <div className="text-right">
          <span className="text-ink-3 text-xs">
            Saldo registrado ·{" "}
            {empresaSelecionada === "pendentes"
              ? "contas a vincular"
              : "empresa selecionada"}
          </span>
          <strong className="mt-1 block text-3xl font-semibold tabular-nums">
            {formatarMoeda(Number(total))}
          </strong>
        </div>
      </div>
      <p className="text-ink-3 mt-4 text-sm">
        Saldos calculados pelas aberturas, baixas e transferências registradas
        no Tetteo. Confira com os extratos dos bancos; este cadastro não conecta
        sua conta automaticamente.
      </p>
      {editar && pode(ctx, "financeiro.quitar") && (
        <details
          className="border-line bg-surface-2 mt-6 rounded-xl border p-4"
          open={contas.length >= 2 ? undefined : false}
        >
          <summary className="cursor-pointer font-semibold">
            Transferir entre contas
          </summary>
          <FormTransferenciaBanco
            hoje={hoje}
            chave={randomUUID()}
            contas={visiveis
              .filter((c) => c.empresa?.ativa)
              .map((c) => ({
                id: c.id,
                nome: c.nome,
                empresaId: c.empresaId,
                ativa: c.ativa,
                empresaNome: c.empresa?.nome ?? "",
              }))}
          />
        </details>
      )}
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="text-ink-2 flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-semibold">
          Empresa
          <select
            name="empresa"
            defaultValue={empresaSelecionada}
            className="border-line-2 bg-surface h-10 rounded-md border px-3"
          >
            <option value="pendentes">Contas a vincular a um CNPJ</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome} · {e.cnpj}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="border-line-2 bg-surface h-10 rounded-md border px-4 text-sm font-semibold"
        >
          Filtrar
        </button>
      </form>
      {visiveis.length === 0 ? (
        <div className="border-line-2 mt-4 rounded-xl border border-dashed p-8 text-center">
          <h2 className="font-semibold">As contas começam aqui</h2>
          <p className="text-ink-3 mx-auto mt-2 max-w-md text-sm">
            {empresas.length
              ? "Cadastre Santander, PagBank, Cappta ou o caixa físico e informe o saldo na data de início."
              : "Cadastre os CNPJs da operação. Depois, adicione as contas de cada empresa e as contas pessoais usadas pela loja."}
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {visiveis.map((c) => (
            <Link
              key={c.id}
              href={`/financeiro/contas/${c.id}`}
              className="border-line bg-surface hover:border-line-2 focus-visible:outline-accent rounded-xl border p-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <div className="flex items-start gap-3">
                <span
                  className="border-l-4 pl-2"
                  style={{ borderColor: c.cor }}
                >
                  <MarcaBanco nome={`${c.banco ?? ""} ${c.nome}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{c.nome}</h2>
                  <p className="text-ink-3 mt-1 truncate text-xs">
                    {c.banco ?? (c.tipo === "CAIXA" ? "Caixa físico" : "Conta")}{" "}
                    · {c.titularidade ?? "Titular a revisar"}
                    {!c.ativa ? " · Inativa" : ""}
                  </p>
                </div>
                <span className="text-accent shrink-0 text-sm" aria-hidden>
                  ↗
                </span>
              </div>
              <strong className="mt-6 block text-2xl font-semibold tabular-nums">
                {formatarMoeda(Number(c.saldo))}
              </strong>
              <div className="border-line mt-4 border-t pt-3">
                <p
                  className={`text-xs ${c.empresa ? "text-ink-2" : "text-warn"}`}
                >
                  {c.empresa
                    ? `${c.empresa.nome} · ${c.empresa.cnpj}`
                    : "Vincule esta conta a um CNPJ para transferir"}
                </p>
                {c.compensacao && (
                  <p className="text-ink-3 mt-1 text-xs">
                    Compensação entre empresas
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      {editar && (
        <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
          <details className="border-line rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">
              Adicionar conta bancária ou caixa
            </summary>
            <FormContaBanco empresas={empresas} hoje={hoje} />
          </details>
          <details
            className="border-line rounded-xl border p-4"
            open={empresas.length === 0}
          >
            <summary className="cursor-pointer font-semibold">
              Empresas da operação{" "}
              <span className="text-ink-3 font-normal">
                · {empresas.length} CNPJ(s)
              </span>
            </summary>
            <ul className="mt-4 space-y-3">
              {empresas.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.nome}</span>
                  <span className="text-ink-3 block text-xs">
                    {e.cnpj} · {e.regime.replaceAll("_", " ")}
                    {e.emiteNota ? " · Emite notas" : ""}
                    {!e.ativa ? " · Inativa" : ""}
                  </span>
                  <details className="mt-2">
                    <summary className="text-accent cursor-pointer text-xs font-semibold">
                      Editar empresa
                    </summary>
                    <FormEmpresaBanco
                      key={assinaturaEmpresa(e)}
                      empresa={{ ...e, assinatura: assinaturaEmpresa(e) }}
                    />
                  </details>
                </li>
              ))}
            </ul>
            <FormEmpresaBanco />
          </details>
        </div>
      )}
    </div>
  );
}
