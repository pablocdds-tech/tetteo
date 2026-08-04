import { z } from "zod";

/**
 * A validação das Configurações.
 *
 * As mensagens dizem O QUE FAZER. Nesta tela quem erra costuma ser o dono, com
 * pressa, num domingo — "campo inválido" não ajuda ninguém.
 */

export const esquemaOrganizacao = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome da rede precisa de pelo menos 2 letras.")
    .max(120, "O nome está longo demais."),
  documento: z.string().trim().max(24).optional(),
});

export const esquemaUnidade = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome da loja precisa de pelo menos 2 letras.")
    .max(80, "O nome está longo demais."),
  /**
   * Curto e sem espaço porque aparece em etiqueta, relatório e conversa de
   * cozinha — "MTZ" cabe onde "Matriz Zona Sul" não cabe.
   */
  codigo: z
    .string()
    .trim()
    .min(2, "O código precisa de pelo menos 2 letras.")
    .max(12, "Use até 12 caracteres — ele aparece em lugares apertados.")
    .regex(
      /^[A-Za-z0-9-]+$/,
      "Use só letras, números e hífen. Sem espaço nem acento.",
    )
    .transform((v) => v.toUpperCase()),
  documento: z.string().trim().max(24).optional(),
  cidade: z.string().trim().max(80).optional(),
  estado: z.string().trim().max(2).optional(),
  telefone: z.string().trim().max(24).optional(),
});

export const esquemaPapel = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "O nome do papel precisa de pelo menos 2 letras.")
    .max(40, "O nome está longo demais."),
  descricao: z.string().trim().max(160).optional(),
  permissoes: z.array(z.string().trim().min(1)).default([]),
});

/**
 * A senha inicial.
 *
 * Doze caracteres, não oito: esta senha vai por WhatsApp para alguém que talvez
 * nunca troque. O mínimo baixo aqui vira a porta de entrada do sistema inteiro.
 */
const senha = z
  .string()
  .min(12, "A senha precisa de pelo menos 12 caracteres.")
  .max(200);

export const esquemaNovoUsuario = z.object({
  nome: z
    .string()
    .trim()
    .min(2, "Informe o nome da pessoa.")
    .max(120, "O nome está longo demais."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Informe um e-mail válido — é com ele que a pessoa entra.")),
  senha,
  papelId: z.string().trim().min(1, "Escolha o papel desta pessoa."),
  /** Vazio significa REDE INTEIRA — o acesso do dono. */
  unidadeId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
});

export const esquemaTrocaDeSenha = z.object({
  usuarioId: z.string().trim().min(1),
  senha,
});

export type DadosOrganizacao = z.infer<typeof esquemaOrganizacao>;
export type DadosUnidade = z.infer<typeof esquemaUnidade>;
export type DadosPapel = z.infer<typeof esquemaPapel>;
export type DadosNovoUsuario = z.infer<typeof esquemaNovoUsuario>;
