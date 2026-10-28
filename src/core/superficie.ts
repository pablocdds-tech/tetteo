import "server-only";
import { headers } from "next/headers";
import {
  ambienteDaRequisicao,
  configurarDominios,
} from "@/lib/dominios-publicos";

export function dominiosPublicos() {
  return configurarDominios(
    process.env.APP_URL,
    process.env.APP_OPERACAO_URL,
    process.env.APP_OPERACAO_ROTA,
  );
}
export async function superficiePublica() {
  const config = dominiosPublicos();
  const ambiente = ambienteDaRequisicao(await headers(), config);
  return {
    config,
    operacional: ambiente === "operacional",
    reconhecida: ambiente !== null,
  };
}
