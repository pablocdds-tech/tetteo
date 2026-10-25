// Cliente central de JSON para as rotas autenticadas do próprio Tetteo.
export async function apiJson<T>(
  caminho: string,
  dados?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const resposta = await fetch(caminho, {
    method: dados === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(dados === undefined ? {} : { body: JSON.stringify(dados) }),
  });
  if (resposta.redirected || resposta.status === 401)
    throw new Error("Sua sessão terminou. Entre novamente no sistema.");
  const retorno = await resposta.json();
  if (!resposta.ok)
    throw new Error(retorno.erro ?? "Não foi possível concluir a operação.");
  return retorno as T;
}
