import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { AvisoUnidade } from "./aviso-unidade";
import {
  FinanceiroIntegrado,
  type DadosFinanceiroIntegrado,
} from "./financeiro-integrado";
import { consultarFinanceiro, detalheFinanceiro } from "../services/integrado";
import { assinaturaEmpresa } from "../services/bancos";
import { FormContaBanco, FormEmpresaBanco } from "./formularios-bancos";

export async function PaginaFinanceiroIntegrado({
  secao = "lancamentos",
  searchParams = Promise.resolve({}),
  id,
  novo = false,
}: {
  secao?: string;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  id?: string;
  novo?: boolean;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "financeiro.ver")) notFound();
  if (secao === "integracoes" && !ctx.ehDiretor) notFound();
  if (
    ["dre", "fluxo", "relatorios"].includes(secao) &&
    !pode(ctx, "financeiro.resultado")
  )
    notFound();
  if (!ctx.unidadeAtiva) return <AvisoUnidade acao="Abrir o financeiro" />;
  const filtro = await searchParams;
  const resultado = await consultarFinanceiro(ctx, filtro);
  const dados = JSON.parse(
    JSON.stringify(resultado, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  ) as DadosFinanceiroIntegrado;
  const detalhe = id
    ? JSON.parse(JSON.stringify(await detalheFinanceiro(ctx, id)))
    : undefined;
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <FinanceiroIntegrado
      key={JSON.stringify([dados, detalhe, secao, novo])}
      inicial={dados}
      secao={secao}
      detalheInicial={detalhe}
      novo={novo}
    >
      {secao === "contas" && pode(ctx, "financeiro.lancar") && (
        <div className="space-y-3">
          <details className="border-line bg-surface rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">
              Cadastrar estabelecimento / CNPJ
            </summary>
            <FormEmpresaBanco />
          </details>
          <details className="border-line bg-surface rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">
              Cadastrar conta bancária ou caixa
            </summary>
            <FormContaBanco empresas={dados.empresas} hoje={hoje} />
          </details>
          {resultado.empresas.map((e) => (
            <details
              className="border-line bg-surface rounded-xl border p-4"
              key={e.id}
            >
              <summary className="cursor-pointer text-sm font-semibold">
                Revisar empresa: {e.nome} · {e.cnpj}
              </summary>
              <FormEmpresaBanco
                empresa={{ ...e, assinatura: assinaturaEmpresa(e) }}
              />
            </details>
          ))}
          {dados.contas.map((c) => (
            <details
              className="border-line bg-surface rounded-xl border p-4"
              key={c.id}
            >
              <summary className="cursor-pointer text-sm font-semibold">
                Revisar conta: {c.nome}
              </summary>
              <FormContaBanco
                empresas={dados.empresas}
                hoje={hoje}
                conta={{ ...c, dataInicial: c.iniciadaEm.slice(0, 10) }}
              />
            </details>
          ))}
        </div>
      )}
    </FinanceiroIntegrado>
  );
}
