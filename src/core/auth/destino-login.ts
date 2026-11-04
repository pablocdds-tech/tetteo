/** Retorno local após autenticar; recusa URLs externas e formas ambíguas. */
export function destinoAposLogin(
  valor: unknown,
  padrao = "/",
  origens = [process.env.APP_URL, process.env.APP_OPERACAO_URL],
): string {
  if (typeof valor !== "string" || /[\\\u0000-\u0020\u007f]/.test(valor))
    return padrao;
  let destino = valor;
  if (!destino.startsWith("/")) {
    try {
      const url = new URL(destino);
      if (
        !origens.some(
          (origem) => origem && new URL(origem).origin === url.origin,
        )
      )
        return padrao;
      destino = `${url.pathname}${url.search}`;
    } catch {
      return padrao;
    }
  }
  if (!destino.startsWith("/") || destino.startsWith("//")) return padrao;
  // Impede também uma segunda interpretação após decodificar a URL.
  try {
    const decodificado = decodeURIComponent(destino);
    if (
      decodificado.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(decodificado)
    )
      return padrao;
  } catch {
    return padrao;
  }
  if (/^\/(?:login|api\/auth)(?:[/?#]|$)/.test(destino)) return padrao;
  return destino;
}
