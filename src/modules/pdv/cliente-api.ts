import type { ClienteAtendimentoPdv } from "./cliente-types";

export class ErroClienteAtendimento extends Error {
  constructor(
    mensagem: string,
    public incerta = false,
    public codigo?: string,
    public clienteExistente?: ClienteAtendimentoPdv,
    public operacaoConfirmada = false,
  ) {
    super(mensagem);
  }
}

/** O navegador acessa a API dona do cadastro; o PDV não escreve tabelas do CRM. */
export async function apiClientes<T>(
  unidadeId: string,
  caminho = "",
  opcoes: {
    method?: "GET" | "POST" | "PUT";
    body?: Record<string, unknown>;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const escrita = opcoes.method && opcoes.method !== "GET";
  const url = new URL(
    `/api/crm/atendimento/clientes${caminho}`,
    window.location.origin,
  );
  url.searchParams.set("storeId", unidadeId);
  let resposta: Response;
  try {
    resposta = await fetch(url.pathname + url.search, {
      method: opcoes.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: opcoes.signal,
      ...(escrita
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...opcoes.body, storeId: unidadeId }),
          }
        : {}),
    });
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError") throw erro;
    throw new ErroClienteAtendimento(
      "Não foi possível confirmar a resposta. Mantenha esta tela aberta e tente novamente.",
      !!escrita,
    );
  }
  let dados;
  try {
    dados = await resposta.json();
  } catch {
    throw new ErroClienteAtendimento(
      "A resposta não pôde ser confirmada. Tente novamente.",
      !!escrita,
    );
  }
  if (!resposta.ok)
    throw new ErroClienteAtendimento(
      typeof dados.error === "string"
        ? dados.error
        : "Não foi possível concluir. Atualize os dados antes de continuar.",
      !!escrita && resposta.status >= 500,
      dados.codigo,
      dados.clienteExistente,
      dados.operacaoConfirmada === true,
    );
  return dados as T;
}
