/**
 * O RECADO AO TETTEO.
 *
 * Cada mudança de estado de uma execução vira um POST para o Tetteo, que
 * alimenta o cartão do Painel. O recado é ACESSÓRIO: se o Tetteo estiver
 * fora, a ferramenta segue e o fechamento sai do mesmo jeito. Por isso esta
 * função nunca lança — devolve se mandou ou por que não.
 *
 * O segredo vai só no cabeçalho. Nunca aparece no retorno, em mensagem de
 * erro ou em log.
 */
export async function enviarRegistro({
  url,
  segredo,
  corpo,
  fetchImpl = fetch,
  timeoutMs = 5_000,
}) {
  if (!url || !segredo) return { enviado: false, motivo: "registro desligado" };
  try {
    const resposta = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-assistente-segredo": segredo,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // O recado não precisa do corpo da resposta; descartá-lo devolve a
    // conexão ao reaproveitamento em vez de deixá-la presa.
    await resposta.body?.cancel().catch(() => {});
    if (!resposta.ok)
      return { enviado: false, motivo: `Tetteo respondeu ${resposta.status}` };
    return { enviado: true };
  } catch (erro) {
    if (erro?.name === "TimeoutError" || erro?.name === "AbortError") {
      return { enviado: false, motivo: "o Tetteo não respondeu a tempo" };
    }
    return { enviado: false, motivo: "falha de rede" };
  }
}
