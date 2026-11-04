import {
  contextoDeFundo,
  pode,
  type ContextoSessao,
} from "@/core/sessao/nucleo";
import { db } from "@/server/db";
import { acceptedEvolutionUrl } from "@/server/atendimento-credenciais";

/** Provisioning requires an explicitly configured administrative key. The legacy
 * instance token cannot create instances and is never adopted as a fallback.
 * The configured legacy binding establishes ownership, not provider privileges.
 * This private configuration is never returned in a GET DTO. */
export async function managedEvolutionFor(
  context: ContextoSessao,
): Promise<{ url: string; apiKey: string } | null> {
  if (
    !context.unidadeAtiva ||
    !context.unidadesVisiveis.some(
      (unit) => unit.id === context.unidadeAtiva?.id,
    ) ||
    !pode(context, "crm.gerenciar") ||
    !pode(context, "assistente.conectar")
  )
    return null;
  const configuredName = process.env.EVOLUTION_INSTANCIA?.trim();
  const apiKey = process.env.AV_EVOLUTION_API_KEY?.trim();
  const configuredUrl =
    process.env.EVOLUTION_URL?.trim() || "http://evolution_api:8080";
  if (
    !configuredName ||
    !apiKey ||
    apiKey.length < 8 ||
    /[\r\n\0]/.test(apiKey) ||
    !acceptedEvolutionUrl(configuredUrl)
  )
    return null;
  const bindings = await db.instanciaWhatsapp.findMany({
    where: {
      nome: configuredName,
      excluidoEm: null,
      provedor: "EVOLUTION_BAILEYS",
    },
    select: { organizacaoId: true, unidadeId: true },
    take: 2,
  });
  if (
    bindings.length !== 1 ||
    bindings[0].organizacaoId !== context.organizacao.id
  )
    return null;
  const authorized = await contextoDeFundo(
    context.usuario.id,
    bindings[0].unidadeId,
  );
  if (
    !authorized ||
    authorized.organizacao.id !== context.organizacao.id ||
    !pode(authorized, "assistente.conectar")
  )
    return null;
  return { url: new URL(configuredUrl).toString().replace(/\/+$/, ""), apiKey };
}
