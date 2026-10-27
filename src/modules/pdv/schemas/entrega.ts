import { z } from "zod";
import type { AreaEntrega, EntregaEntrada } from "../entrega-types";
import { ErroPdv } from "./erro";

export const UFS_ENTREGA = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
export const LIMITE_CADASTROS_ENTREGA = 200;
export function normalizarEntrega(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}
const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const uf = z.string().trim().toUpperCase().pipe(z.enum(UFS_ENTREGA));
export const esquemaTelefoneEntrega = texto(0, 25)
  .regex(/^[+\d\s().-]*$/, "Informe somente números e sinais de telefone.")
  .refine(
    (v) => v === "" || /\d/.test(v),
    "Informe um telefone brasileiro válido ou deixe em branco.",
  )
  .transform((v) => {
    const digitos = v.replace(/\D/g, "");
    return digitos.startsWith("55") && [12, 13].includes(digitos.length)
      ? digitos.slice(2)
      : digitos;
  })
  .refine(
    (v) => v === "" || /^[1-9]\d(?:9\d{8}|[2-5]\d{7})$/.test(v),
    "Informe um telefone brasileiro válido ou deixe em branco.",
  );
export const esquemaEnderecoEntrega = z
  .object({
    logradouro: texto(2, 150),
    numero: texto(1, 20),
    complemento: texto(0, 150),
    bairro: texto(2, 80),
    cidade: texto(2, 80),
    uf,
    cep: texto(0, 12)
      .regex(
        /^(?:\d{5}-?\d{3})?$/,
        "Informe um CEP com oito dígitos ou deixe em branco.",
      )
      .transform((v) => v.replace(/\D/g, "")),
    referencia: texto(0, 300),
  })
  .strict();
export const esquemaEntregaEntrada = z
  .object({
    destinatario: texto(2, 160),
    telefone: esquemaTelefoneEntrega,
    endereco: esquemaEnderecoEntrega,
    areaId: z.string().uuid().optional(),
    versaoArea: z.number().int().min(1).max(2_000_000_000).optional(),
    freteCentavos: z.number().int().min(0).max(100_000_000),
    prazoMinutos: z.number().int().min(1).max(1440),
    motivoFreteManual: texto(0, 300),
  })
  .strict()
  .superRefine((d, ctx) => {
    if ((d.areaId === undefined) !== (d.versaoArea === undefined))
      ctx.addIssue({
        code: "custom",
        message: "Informe a área e sua versão juntas.",
        path: ["areaId"],
      });
    if (!d.areaId && d.motivoFreteManual.length < 3)
      ctx.addIssue({
        code: "custom",
        message: "Informe o motivo do frete manual.",
        path: ["motivoFreteManual"],
      });
  });
export const esquemaEntrega = esquemaEntregaEntrada;
export const esquemaEntregaSnapshot = esquemaEntregaEntrada.safeExtend({
  areaNome: texto(1, 100).nullable(),
  previstoEm: z.iso.datetime(),
});
export const esquemaAreaEntrega = z
  .object({
    id: z.string().uuid(),
    versao: z.number().int().min(0).max(2_000_000_000),
    nome: texto(2, 100),
    cidade: texto(2, 80),
    uf,
    bairros: z.array(texto(2, 80)).max(100),
    freteCentavos: z.number().int().min(0).max(100_000_000),
    prazoMinutos: z.number().int().min(1).max(1440),
    ativa: z.boolean(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (new Set(d.bairros.map(normalizarEntrega)).size !== d.bairros.length)
      ctx.addIssue({
        code: "custom",
        message: "Há bairros repetidos nesta área.",
        path: ["bairros"],
      });
  });
export const esquemaEntregador = z
  .object({
    id: z.string().uuid(),
    versao: z.number().int().min(0).max(2_000_000_000),
    nome: texto(2, 100),
    telefone: esquemaTelefoneEntrega,
    ativo: z.boolean(),
  })
  .strict();
export const esquemaAtribuirEntregador = z
  .object({
    pedidoId: texto(1, 100),
    versaoPedido: z.number().int().min(1).max(2_000_000_000),
    entregadorId: z.string().uuid().nullable(),
  })
  .strict();
export function conferirAreaEntrega(
  area: AreaEntrega,
  entrada: EntregaEntrada,
) {
  if (!area.ativa)
    throw new ErroPdv(
      "Esta área de entrega está inativa. Escolha outra área ou informe um frete manual.",
    );
  if (
    area.versao !== entrada.versaoArea ||
    area.freteCentavos !== entrada.freteCentavos ||
    area.prazoMinutos !== entrada.prazoMinutos
  )
    throw new ErroPdv(
      "A área de entrega mudou. Atualize o frete e o prazo antes de concluir.",
    );
  if (
    normalizarEntrega(area.cidade) !==
      normalizarEntrega(entrada.endereco.cidade) ||
    area.uf !== entrada.endereco.uf
  )
    throw new ErroPdv(
      "O endereço não pertence à cidade e ao estado desta área de entrega.",
    );
  if (
    area.bairros.length &&
    !area.bairros.some(
      (b) =>
        normalizarEntrega(b) === normalizarEntrega(entrada.endereco.bairro),
    )
  )
    throw new ErroPdv(
      "O bairro informado não pertence à área de entrega selecionada.",
    );
}
