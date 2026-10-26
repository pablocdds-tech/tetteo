import { z } from "zod";

/** Centavos inteiros: limite compatível com Decimal(14,2), sem ponto flutuante. */
export function centavos(
  valor: { toString(): string } | string | number,
): bigint {
  const texto = String(valor);
  if (!/^-?\d+(\.\d{1,2})?$/.test(texto))
    throw new Error("Valor monetário inválido.");
  const [inteiro, decimal = ""] = texto.replace("-", "").split(".");
  return (
    (BigInt(inteiro) * 100n + BigInt(decimal.padEnd(2, "0"))) *
    (texto.startsWith("-") ? -1n : 1n)
  );
}

export function reais(valor: bigint): string {
  const absoluto = valor < 0n ? -valor : valor;
  return `${valor < 0n ? "-" : ""}${absoluto / 100n}.${String(absoluto % 100n).padStart(2, "0")}`;
}

export function identidadeBancaria(
  banco: string,
  agencia: string,
  numero: string,
): string {
  const normalizar = (valor: string) =>
    valor
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase();
  const nome = normalizar(banco);
  const marca = nome.includes("SANTANDER")
    ? "SANTANDER"
    : /PAGBANK|PAGSEGURO/.test(nome)
      ? "PAGBANK"
      : nome.includes("CAPPTA")
        ? "CAPPTA"
        : nome;
  return [
    marca,
    normalizar(agencia).replace(/^0+(?=\d)/, ""),
    normalizar(numero).replace(/^0+(?=\d)/, ""),
  ].join("|");
}

export function dataBancaria(texto: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto))
    throw new Error("Informe uma data válida.");
  const data = new Date(texto + "T00:00:00Z");
  if (
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== texto ||
    texto < "2000-01-01" ||
    texto > "2100-12-31"
  ) {
    throw new Error("Informe uma data válida entre 2000 e 2100.");
  }
  return data;
}

export function diaNoFuso(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

/** O instante do início do dia da operação, mesmo em servidor UTC. */
export function inicioNoFuso(texto: string, fuso: string): Date {
  const data = dataBancaria(texto);
  let instante = data.getTime();
  for (let i = 0; i < 3; i++) {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instante));
    const parte = (tipo: string) =>
      Number(partes.find((p) => p.type === tipo)?.value);
    const aparente = Date.UTC(
      parte("year"),
      parte("month") - 1,
      parte("day"),
      parte("hour"),
      parte("minute"),
      parte("second"),
    );
    instante += data.getTime() - aparente;
  }
  return new Date(instante);
}

export function cnpjValido(valor: string): boolean {
  if (!/^\d{14}$/.test(valor) || /^(\d)\1+$/.test(valor)) return false;
  const digito = (base: string) => {
    let peso = base.length - 7;
    const soma = [...base].reduce((s, n) => {
      const v = s + Number(n) * peso--;
      if (peso < 2) peso = 9;
      return v;
    }, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return (
    digito(valor.slice(0, 12)) === Number(valor[12]) &&
    digito(valor.slice(0, 13)) === Number(valor[13])
  );
}

const texto = (max: number) =>
  z
    .string({ error: "Informe um texto válido." })
    .trim()
    .max(max, `Use até ${max} caracteres.`);
const data = z.string().refine((v) => {
  try {
    dataBancaria(v);
    return true;
  } catch {
    return false;
  }
}, "Data inválida.");
const dinheiro = z
  .string()
  .trim()
  .transform((v) =>
    v.includes(",")
      ? /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(v)
        ? v.replace(/\./g, "").replace(",", ".")
        : "inválido"
      : v,
  )
  .refine(
    (v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v),
    "Informe um valor como 1.234,56.",
  );

export const esquemaEmpresaBancaria = z.object({
  nome: texto(80).min(2, "Informe o nome da empresa."),
  razaoSocial: texto(140).min(2, "Informe a razão social."),
  cnpj: texto(30)
    .transform((v) => v.replace(/\D/g, ""))
    .refine(cnpjValido, "CNPJ inválido."),
  regime: z.enum(
    [
      "SIMPLES",
      "LUCRO_PRESUMIDO",
      "LUCRO_PRESUMIDO_RETORNO_SIMPLES",
      "LUCRO_REAL",
      "DESCONHECIDO",
    ],
    { error: "Escolha o regime atual da empresa." },
  ),
  emiteNota: z.boolean(),
  ativa: z.boolean().default(true),
});

export const esquemaContaBancaria = z
  .object({
    nome: texto(60).min(2, "Informe o nome da conta."),
    empresaId: texto(100).min(1, "Escolha o CNPJ responsável."),
    modalidade: z.enum(
      ["CORRENTE", "POUPANCA", "DINHEIRO", "APLICACAO", "OUTRO"],
      { error: "Escolha o tipo de conta." },
    ),
    banco: texto(80),
    agencia: texto(30),
    numero: texto(40),
    titularidade: z.enum(["PJ", "PF"], { error: "Escolha a titularidade." }),
    nomeTitular: texto(140).min(2, "Informe o titular."),
    saldoInicial: dinheiro,
    dataInicial: data,
    cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Escolha uma cor."),
    ativa: z.boolean(),
    compensacao: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (
      d.modalidade !== "DINHEIRO" &&
      !d.compensacao &&
      (!d.banco || !d.numero)
    )
      ctx.addIssue({
        code: "custom",
        path: ["banco"],
        message: "Informe o banco e o número da conta.",
      });
    if (
      d.compensacao &&
      (d.modalidade !== "OUTRO" ||
        d.titularidade !== "PJ" ||
        !/^-?0+(?:\.0{1,2})?$/.test(d.saldoInicial) ||
        d.numero ||
        d.agencia)
    )
      ctx.addIssue({
        code: "custom",
        path: ["compensacao"],
        message:
          "A conta de compensação deve ser PJ, do tipo Outro, sem agência/número e com saldo inicial zero.",
      });
  });

export const esquemaTransferencia = z
  .object({
    origemId: texto(100).min(1, "Escolha a conta de origem."),
    destinoId: texto(100).min(1, "Escolha a conta de destino."),
    valor: dinheiro.refine((v) => {
      try {
        return centavos(v) > 0n;
      } catch {
        return false;
      }
    }, "O valor deve ser maior que zero."),
    data,
    descricao: texto(200).min(3, "Descreva a transferência."),
    chave: z.uuid("Reabra o formulário e tente novamente."),
  })
  .refine((d) => d.origemId !== d.destinoId, {
    path: ["destinoId"],
    message: "Escolha duas contas diferentes.",
  });

export type DadosContaBancaria = z.infer<typeof esquemaContaBancaria>;
export type DadosTransferencia = z.infer<typeof esquemaTransferencia>;

type ContaParaTransferir = {
  id: string;
  empresaId: string | null;
  ativa: boolean;
  dataInicial: string;
  empresaAtiva: boolean;
};
export function validarParTransferencia(
  origem: ContaParaTransferir | undefined,
  destino: ContaParaTransferir | undefined,
  data: string,
  hoje: string,
  estorno = false,
) {
  dataBancaria(data);
  if (!origem || !destino || origem.id === destino.id)
    throw new Error("Escolha duas contas desta unidade.");
  if (!origem.empresaId || !destino.empresaId)
    throw new Error("Vincule as duas contas a um CNPJ antes de transferir.");
  if (origem.empresaId !== destino.empresaId)
    throw new Error(
      "Transferências entre CNPJs são bloqueadas. Use contas de compensação e repasses a pagar/receber.",
    );
  if (
    !estorno &&
    (!origem.ativa ||
      !destino.ativa ||
      !origem.empresaAtiva ||
      !destino.empresaAtiva)
  )
    throw new Error("As contas e a empresa precisam estar ativas.");
  if (data > hoje) throw new Error("A transferência não pode estar no futuro.");
  if (data < origem.dataInicial || data < destino.dataInicial)
    throw new Error(
      "A transferência não pode anteceder o saldo inicial das contas.",
    );
}
