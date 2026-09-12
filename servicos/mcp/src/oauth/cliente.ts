import { z } from "zod";

/**
 * QUEM PODE PEDIR ACESSO: o Client ID Metadata Document (CIMD).
 *
 * O Claude se identifica com uma URL (`client_id`) que aponta para um JSON
 * publicado pela Anthropic, com o nome dele e os endereços de retorno. Este
 * servidor busca esse JSON e confere.
 *
 * Buscar uma URL que veio de fora é perigoso: sem cuidado, alguém usaria este
 * servidor para acessar endereços internos da VPS (SSRF). Por isso a ordem é:
 * primeiro o host precisa estar na lista de confiáveis — só então há busca, e
 * ainda assim só https, sem seguir redirecionamento, com tempo e tamanho
 * limitados.
 *
 * O documento fica guardado em memória por alguns minutos. É cache, não
 * sessão: perdê-lo num deploy só custa uma busca a mais.
 */

export type ClienteOAuth = {
  clientId: string;
  nome: string;
  redirectUris: string[];
};

export type BuscarDocumento = (
  url: URL,
  sinal: AbortSignal,
) => Promise<Response>;

export type ResolverCliente = (clientId: string) => Promise<ClienteOAuth>;

export class ErroDeCliente extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeCliente";
  }
}

const LIMITE_BYTES = 64 * 1024;
const TEMPO_MS = 5000;

const documento = z.object({
  client_id: z.string(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
  token_endpoint_auth_method: z.string().optional(),
});

export const buscarNaRede: BuscarDocumento = (url, sinal) =>
  fetch(url, {
    signal: sinal,
    redirect: "error",
    headers: { accept: "application/json" },
  });

async function lerComLimite(
  resposta: Response,
  limite: number,
): Promise<string> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return "";
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      throw new ErroDeCliente("A identificação do cliente é grande demais.");
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf8");
}

export function criarResolvedorDeClientes(opcoes: {
  hostsConfiaveis: readonly string[];
  buscar?: BuscarDocumento;
  validadeMs?: number;
  agora?: () => number;
}): ResolverCliente {
  const buscar = opcoes.buscar ?? buscarNaRede;
  const validade = opcoes.validadeMs ?? 5 * 60_000;
  const agora = opcoes.agora ?? Date.now;
  const guardados = new Map<string, { cliente: ClienteOAuth; ate: number }>();

  return async (clientId) => {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw new ErroDeCliente("O client_id precisa ser uma URL.");
    }
    if (
      url.protocol !== "https:" ||
      url.pathname === "/" ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new ErroDeCliente(
        "O client_id precisa ser uma URL https com caminho.",
      );
    }
    const host = url.hostname.toLowerCase();
    if (!opcoes.hostsConfiaveis.includes(host)) {
      throw new ErroDeCliente(
        `Este servidor só aceita conexões de: ${opcoes.hostsConfiaveis.join(", ")}.`,
      );
    }

    const guardado = guardados.get(clientId);
    if (guardado && guardado.ate > agora()) return guardado.cliente;

    let resposta: Response;
    try {
      resposta = await buscar(url, AbortSignal.timeout(TEMPO_MS));
    } catch {
      throw new ErroDeCliente("Não consegui ler a identificação do cliente.");
    }
    if (!resposta.ok) {
      throw new ErroDeCliente(
        `A identificação do cliente respondeu ${resposta.status}.`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(await lerComLimite(resposta, LIMITE_BYTES));
    } catch (erro) {
      if (erro instanceof ErroDeCliente) throw erro;
      throw new ErroDeCliente(
        "A identificação do cliente não é um JSON válido.",
      );
    }

    const analise = documento.safeParse(json);
    if (!analise.success) {
      throw new ErroDeCliente("A identificação do cliente está incompleta.");
    }
    if (analise.data.client_id !== clientId) {
      throw new ErroDeCliente(
        "A identificação do cliente não corresponde ao client_id.",
      );
    }
    // Sem o campo, o padrão da RFC 7591 é cliente COM segredo. Este servidor
    // só atende quem declara explicitamente que é público.
    if (analise.data.token_endpoint_auth_method !== "none") {
      throw new ErroDeCliente(
        "Só clientes públicos (sem segredo) podem se conectar.",
      );
    }

    const cliente: ClienteOAuth = {
      clientId,
      nome: analise.data.client_name ?? host,
      redirectUris: analise.data.redirect_uris,
    };
    guardados.set(clientId, { cliente, ate: agora() + validade });
    return cliente;
  };
}
