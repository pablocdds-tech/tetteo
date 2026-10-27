import { z } from "zod";
import { normalizeBrazilPhone } from "../services/domain";

const uf = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z.enum([
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
    ]),
  );
const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
export const esquemaEnderecoAtendimento = z
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
const storeId = texto(1, 128).regex(/^[\w-]+$/);
const chave = z.string().uuid();
export const esquemaListaClientesAtendimento = z
  .object({
    storeId,
    busca: texto(0, 100).default(""),
    pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  })
  .strict();
export const esquemaConsultarClienteAtendimento = z
  .object({ storeId, clienteId: z.string().uuid() })
  .strict();
const telefone = texto(10, 30)
  .refine((v) => {
    try {
      normalizeBrazilPhone(v);
      return true;
    } catch {
      return false;
    }
  }, "Telefone brasileiro inválido.")
  .transform(normalizeBrazilPhone);
export const esquemaCriarClienteAtendimento = z
  .object({ storeId, chaveUUID: chave, nome: texto(2, 160), telefone })
  .strict();
export const esquemaCriarEnderecoAtendimento = z
  .object({
    storeId,
    chaveUUID: chave,
    rotulo: texto(1, 60),
    principal: z.boolean(),
    endereco: esquemaEnderecoAtendimento,
  })
  .strict();
export const esquemaAlterarEnderecoAtendimento = esquemaCriarEnderecoAtendimento
  .extend({
    versao: z.number().int().min(1).max(2_000_000_000),
    ativo: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (!d.ativo && d.principal)
      ctx.addIssue({
        code: "custom",
        message: "Um endereço inativo não pode ser principal.",
        path: ["principal"],
      });
  });
