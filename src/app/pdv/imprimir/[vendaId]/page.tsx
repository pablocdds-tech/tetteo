import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { ImpressaoPdv } from "@/modules/pdv/components/impressao-pdv";
import type { DocumentoImpressaoPdv } from "@/modules/pdv/impressao-types";
import { ErroPdv } from "@/modules/pdv/schemas/erro";
import { esquemaDocumentoImpressao } from "@/modules/pdv/schemas/impressao";
import { obterDocumentoImpressao } from "@/modules/pdv/services/impressoes";

export const metadata: Metadata = {
  title: "Impressão não fiscal · Tetteo",
  robots: { index: false, follow: false },
};

export default async function PaginaImprimirPdv({
  params,
  searchParams,
}: {
  params: Promise<{ vendaId: string }>;
  searchParams: Promise<{ tipo?: string | string[] }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "pdv.ver")) notFound();
  if (!ctx.unidadeAtiva)
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Impressão do PDV</h1>
        <p className="mt-3">
          Selecione uma unidade no sistema antes de abrir o documento.
        </p>
        <Link href="/pdv" className="text-accent mt-4 inline-block underline">
          Voltar ao PDV
        </Link>
      </main>
    );
  const [{ vendaId }, consulta] = await Promise.all([params, searchParams]);
  const entrada = esquemaDocumentoImpressao.safeParse({
    vendaId,
    tipo: consulta.tipo ?? "COMPROVANTE",
  });
  if (!entrada.success) notFound();
  let documento: DocumentoImpressaoPdv;
  try {
    documento = await obterDocumentoImpressao(ctx, entrada.data);
  } catch (erro) {
    if (erro instanceof ErroPdv) notFound();
    throw erro;
  }
  return <ImpressaoPdv inicial={documento} />;
}
