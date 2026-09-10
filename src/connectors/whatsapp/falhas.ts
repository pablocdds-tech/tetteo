/**
 * O PEDIDO CHEGOU OU NÃO?
 *
 * É a pergunta que decide se repetir um envio é seguro. A 2.3.7 não aceita
 * chave de idempotência no `sendText`: se o Tetteo repetir um pedido que já
 * saiu, o gerente recebe duas mensagens iguais, e não há como a Evolution
 * perceber.
 *
 *   nao-chegou   a conexão nem abriu, ou o provedor recusou antes de
 *                processar (429, 408) → repetir é seguro
 *   incerto      pode ter saído e a resposta sumiu (tempo esgotado, conexão
 *                caída no meio, 5xx) → NÃO repete sozinho; consulta primeiro
 *   recusado     chegou e foi negado (credencial, instância, número)
 *                → repetir não resolve
 *
 * Na dúvida, "incerto". É o lado que custa uma pergunta a mais, e não uma
 * mensagem a mais.
 */

export type EntradaDeFalha =
  | { tipo: "rede"; codigo?: string }
  | { tipo: "tempo" }
  | { tipo: "http"; status: number };

export type ClasseDeFalha = "nao-chegou" | "incerto" | "recusado";

/** Códigos em que a conexão TCP nunca se completou. */
const NAO_CHEGOU = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function classificarFalha(entrada: EntradaDeFalha): ClasseDeFalha {
  if (entrada.tipo === "tempo") return "incerto";

  if (entrada.tipo === "rede") {
    return entrada.codigo && NAO_CHEGOU.has(entrada.codigo)
      ? "nao-chegou"
      : "incerto";
  }

  if (entrada.status === 429 || entrada.status === 408) return "nao-chegou";
  if (entrada.status >= 500) return "incerto";
  return "recusado";
}

/**
 * Traduz o que o `fetch` do Node joga em uma entrada classificável.
 *
 * O tempo esgotado do `AbortSignal.timeout` chega como `TimeoutError`; a
 * falha de conexão chega como `TypeError("fetch failed")` com o código de
 * verdade escondido em `cause.code`.
 */
export function entradaDoErro(erro: unknown): EntradaDeFalha {
  if (!erro || typeof erro !== "object") return { tipo: "rede" };

  const { name, cause, code } = erro as {
    name?: unknown;
    cause?: { code?: unknown };
    code?: unknown;
  };
  if (name === "TimeoutError" || name === "AbortError")
    return { tipo: "tempo" };

  const codigo =
    typeof cause?.code === "string"
      ? cause.code
      : typeof code === "string"
        ? code
        : undefined;
  return codigo ? { tipo: "rede", codigo } : { tipo: "rede" };
}
