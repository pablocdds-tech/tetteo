import { redirect } from "next/navigation";

/**
 * Endereço antigo: a cotação de 04/08 virou RODADA, com o MESMO id (a
 * migração de 10/09/2026 preservou os ids). Link colado no WhatsApp é
 * contrato — continua abrindo o lugar certo.
 */
export default async function CotacaoAntiga({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/compras/rodadas/${id}`);
}
