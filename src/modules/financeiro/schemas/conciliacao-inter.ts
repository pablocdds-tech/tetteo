import type { TransacaoBancaria } from "@/lib/extrato-bancario";
import { centavos, dataBancaria } from "./bancos";

export type CandidatoInter = {
  id: string;
  empresaId: string | null;
  direcao: "PAGAR" | "RECEBER";
  vencimento: Date;
  saldo: string;
  documento: string | null;
};

/** Nunca transfere unidade ou altera o cadastro para forçar um casamento. */
export function encontrarCandidatos(
  transacao: TransacaoBancaria,
  candidatos: CandidatoInter[],
  empresaId: string,
): CandidatoInter[] {
  const dia = dataBancaria(transacao.data).getTime();
  let encontrados = candidatos.filter(
    (c) =>
      c.empresaId === empresaId &&
      c.direcao === transacao.direcao &&
      Math.abs(
        dataBancaria(c.vencimento.toISOString().slice(0, 10)).getTime() - dia,
      ) <=
        5 * 86400000 &&
      centavos(c.saldo) > 0n &&
      centavos(c.saldo) === centavos(transacao.valor),
  );
  // Documento conhecido e divergente nunca vira uma baixa por coincidência de valor.
  if (transacao.documento) {
    encontrados = encontrados.filter(
      (c) => c.documento?.replace(/\D/g, "") === transacao.documento,
    );
  }
  if (encontrados.length > 1) {
    const exatos = encontrados.filter(
      (c) => c.vencimento.toISOString().slice(0, 10) === transacao.data,
    );
    if (exatos.length) encontrados = exatos;
  }
  return encontrados;
}

export function valorLiquido(l: {
  valor: { toString(): string };
  desconto: { toString(): string };
  multa: { toString(): string };
  juros: { toString(): string };
}) {
  return (
    centavos(l.valor) -
    centavos(l.desconto) +
    centavos(l.multa) +
    centavos(l.juros)
  );
}
