import { z } from "zod";

/**
 * A CONFIGURAÇÃO DO SERVIDOR, lida uma vez e validada na subida.
 *
 * Um servidor que sobe com a URL pública errada publica metadados OAuth que o
 * Claude rejeita sem dizer por quê — a pessoa só vê "não consegui conectar".
 * Por isso a validação acontece na largada, e o erro nomeia a variável. Nunca
 * o valor: `DATABASE_URL` carrega a senha do banco.
 */

const lista = (texto: string) =>
  texto
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const esquema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, {
    error: "precisa começar com postgresql://",
  }),
  MCP_URL_PUBLICA: z.string().min(1),
  MCP_HOSTS_PERMITIDOS: z.string().optional(),
  MCP_CLIENTES_CONFIAVEIS: z.string().default("claude.ai,claude.com"),
  MCP_FONTE: z.enum(["ficticia"]).default("ficticia"),
});

export type Config = {
  ambiente: "development" | "production" | "test";
  porta: number;
  bancoUrl: string;
  /** A origem pública, sem barra final. É o `issuer` do OAuth. */
  emissor: string;
  urlPublica: URL;
  /** O recurso canônico (RFC 8707): o endereço onde o Claude fala MCP. */
  urlMcp: URL;
  hostsPermitidos: string[];
  clientesConfiaveis: string[];
  fonte: "ficticia";
};

export function lerConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const analise = esquema.safeParse(env);
  if (!analise.success) {
    const problemas = analise.error.issues
      .map((problema) => `${problema.path.join(".")}: ${problema.message}`)
      .join("; ");
    throw new Error(`Configuração inválida — ${problemas}`);
  }
  const e = analise.data;

  let url: URL;
  try {
    url = new URL(e.MCP_URL_PUBLICA);
  } catch {
    throw new Error("Configuração inválida — MCP_URL_PUBLICA não é uma URL");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "Configuração inválida — MCP_URL_PUBLICA deve ser só a origem, sem caminho (ex.: https://mcp.exemplo.com.br)",
    );
  }
  if (e.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error(
      "Configuração inválida — em produção MCP_URL_PUBLICA precisa ser https",
    );
  }

  const emissor = url.origin;
  return {
    ambiente: e.NODE_ENV,
    porta: e.PORT,
    bancoUrl: e.DATABASE_URL,
    emissor,
    urlPublica: new URL(emissor),
    urlMcp: new URL("/mcp", emissor),
    hostsPermitidos: lista(
      e.MCP_HOSTS_PERMITIDOS ?? `${url.hostname},localhost,127.0.0.1`,
    ),
    clientesConfiaveis: lista(e.MCP_CLIENTES_CONFIAVEIS),
    fonte: e.MCP_FONTE,
  };
}
