/**
 * O SERVIDOR MCP RESPONDE?
 *
 * O `/health` dele não tem nada sensível: diz a versão, se o banco responde e
 * qual fonte de vendas está em uso. A tela do Tetteo mostra isso para que
 * ninguém precise abrir o painel do Dokploy para saber se a IA consegue
 * consultar.
 *
 * Dois segundos de limite: esta consulta não pode segurar o carregamento da
 * tela. Sem resposta, a tela diz "não respondeu agora" — nunca finge que está
 * tudo bem.
 */

export type SaudeDoMcp = {
  situacao: "ok" | "nao-respondeu" | "sem-endereco";
  endereco: string | null;
  versao?: string;
  fonte?: string;
  banco?: string;
};

type Buscar = (url: string, sinal: AbortSignal) => Promise<Response>;

const buscarNaRede: Buscar = (url, sinal) => fetch(url, { signal: sinal });

export async function consultarSaudeDoMcp(
  env: Record<string, string | undefined> = process.env,
  buscar: Buscar = buscarNaRede,
): Promise<SaudeDoMcp> {
  const endereco = (env.MCP_URL_PUBLICA ?? "").trim().replace(/\/$/, "");
  if (!endereco) return { situacao: "sem-endereco", endereco: null };

  try {
    const resposta = await buscar(
      `${endereco}/health`,
      AbortSignal.timeout(2000),
    );
    if (!resposta.ok) return { situacao: "nao-respondeu", endereco };
    const corpo = (await resposta.json()) as Record<string, unknown>;
    return {
      situacao: "ok",
      endereco,
      versao: typeof corpo.versao === "string" ? corpo.versao : undefined,
      fonte: typeof corpo.fonte === "string" ? corpo.fonte : undefined,
      banco: typeof corpo.banco === "string" ? corpo.banco : undefined,
    };
  } catch {
    return { situacao: "nao-respondeu", endereco };
  }
}
