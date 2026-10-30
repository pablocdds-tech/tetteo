import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { transacaoFinanceira } from "@/modules/financeiro/services/integrado";
import { DocumentosPessoa } from "@/modules/financeiro/components/documentos-pessoa";
export default async function Pagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "financeiro.ver")) notFound();
  const { id } = await params;
  const dados = await transacaoFinanceira(
    ctx,
    "financeiro.ver",
    async (tx, u) => {
      const pessoa = await tx.pessoaFinanceira.findFirst({
        where: { id, unidadeId: u, organizacaoId: ctx.organizacao.id },
      });
      if (!pessoa) return null;
      const arquivos = await tx.arquivo.findMany({
        where: {
          organizacaoId: ctx.organizacao.id,
          unidadeId: u,
          entidade: "PessoaFinanceira",
          entidadeId: id,
          excluidoEm: null,
        },
        select: { id: true, nomeOriginal: true },
        orderBy: { criadoEm: "desc" },
      });
      return { pessoa, arquivos };
    },
  );
  if (!dados) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Link className="text-accent text-sm" href="/financeiro/pessoas">
        ← Pessoas
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">
        Documentos de {dados.pessoa.nome}
      </h1>
      <ul className="divide-line mt-5 divide-y">
        {dados.arquivos.map((a) => (
          <li className="py-3" key={a.id}>
            <a
              className="text-accent"
              href={`/api/arquivos/${a.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {a.nomeOriginal}
            </a>
          </li>
        ))}
      </ul>
      {!dados.arquivos.length && (
        <p className="text-ink-3 mt-4">Nenhum documento enviado.</p>
      )}
      {pode(ctx, "financeiro.lancar") && <DocumentosPessoa id={id} />}
    </div>
  );
}
