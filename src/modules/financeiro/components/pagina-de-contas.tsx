import Link from "next/link";

import { formatarMoeda } from "@/lib/numero";

import { FormularioLancamento } from "./formulario-lancamento";
import { ListaContas } from "./lista-contas";
import type { LancamentoNaLista } from "../services/lancamentos";

/**
 * A tela de contas — a mesma para os dois lados.
 *
 * Pagar e receber são a mesma coisa com o sinal trocado: alguém deve, tem
 * valor, tem vencimento, um dia quita. Duas telas quase idênticas divergiriam
 * em três meses, e a correção feita numa não chegaria na outra.
 */
export function PaginaDeContas({
  direcao,
  lancamentos,
  categorias,
  contas,
  fornecedores,
  unidade,
  podeLancar,
  podeQuitar,
  status,
}: {
  direcao: "PAGAR" | "RECEBER";
  lancamentos: LancamentoNaLista[];
  categorias: { id: string; nome: string; tipo: string }[];
  contas: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
  unidade: string;
  podeLancar: boolean;
  podeQuitar: boolean;
  status: "ABERTO" | "QUITADO";
}) {
  const aPagar = direcao === "PAGAR";
  const base = aPagar ? "/financeiro/pagar" : "/financeiro/receber";

  const emAberto = lancamentos.filter((l) => l.status === "ABERTO");
  const total = emAberto.reduce((s, l) => s + l.valor, 0);
  const vencidas = emAberto.filter((l) => l.atrasado);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {aPagar ? "Contas a pagar" : "Contas a receber"}
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {status === "ABERTO"
              ? `${formatarMoeda(total)} em aberto`
              : "Já quitadas"}{" "}
            · {unidade}
          </p>
        </div>

        <div className="flex items-center gap-1 text-sm">
          <Filtro href={base} ativo={status === "ABERTO"}>
            Em aberto
          </Filtro>
          <Filtro href={`${base}?status=quitado`} ativo={status === "QUITADO"}>
            Quitadas
          </Filtro>
        </div>
      </div>

      {status === "ABERTO" && vencidas.length > 0 && (
        <p className="bg-bad-sub text-bad mt-4 rounded-md px-3 py-2 text-sm">
          {vencidas.length}{" "}
          {vencidas.length === 1 ? "conta vencida" : "contas vencidas"} somando{" "}
          {formatarMoeda(vencidas.reduce((s, l) => s + l.valor, 0))}.
        </p>
      )}

      <div className="mt-6">
        <ListaContas
          lancamentos={lancamentos}
          contas={contas}
          podeQuitar={podeQuitar}
          podeLancar={podeLancar}
        />
      </div>

      {podeLancar && status === "ABERTO" && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold">
            {aPagar ? "Nova conta a pagar" : "Novo a receber"}
          </h2>
          <FormularioLancamento
            direcao={direcao}
            categorias={categorias}
            contas={contas}
            fornecedores={fornecedores}
          />
        </section>
      )}
    </div>
  );
}

function Filtro({
  href,
  ativo,
  children,
}: {
  href: string;
  ativo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 font-medium ${
        ativo
          ? "bg-accent text-accent-ink"
          : "text-ink-2 hover:bg-surface-2 border-line-2 border"
      }`}
    >
      {children}
    </Link>
  );
}
