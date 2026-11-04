import type { ContaParaContar } from "./numeros";

export const SITUACOES = [
  "todas",
  "vencidas",
  "abertas",
  "quitadas",
  "pagar-vencidas",
  "pagar-a-vencer",
] as const;

export type Situacao = (typeof SITUACOES)[number];

export function lerSituacao(valor: string | string[] | undefined): Situacao {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return SITUACOES.includes(texto as Situacao) ? (texto as Situacao) : "todas";
}

export function caiNaSituacao(conta: ContaParaContar, situacao: Situacao) {
  if (situacao === "todas") return true;
  if (situacao === "quitadas") return conta.status === "QUITADO";
  if (conta.status !== "ABERTO") return false;
  if (situacao === "abertas") return true;
  if (situacao === "vencidas") return conta.atrasado;
  if (conta.direcao !== "PAGAR") return false;
  return situacao === "pagar-vencidas" ? conta.atrasado : !conta.atrasado;
}
