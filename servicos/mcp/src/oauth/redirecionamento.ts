/**
 * PARA ONDE O CÓDIGO DE AUTORIZAÇÃO PODE VOLTAR.
 *
 * O código só vale para quem o recebe — se ele voltar para o endereço errado,
 * quem está lá troca por uma chave. Por isso a comparação é EXATA, com uma
 * única exceção, a do loopback (`localhost`, `127.0.0.1`): programas no
 * computador da pessoa, como o Claude Code, abrem uma porta diferente a cada
 * vez, e a RFC 8252 manda ignorar a porta nesse caso.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function ehLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

function lerUrl(texto: string): URL | null {
  try {
    return new URL(texto);
  } catch {
    return null;
  }
}

export function redirecionamentoPermitido(
  pedido: string,
  registrados: readonly string[],
): boolean {
  const alvo = lerUrl(pedido);
  if (!alvo || alvo.hash || alvo.username || alvo.password) return false;
  // Fora do loopback, só https: um código em http viaja à vista.
  if (!ehLoopback(alvo) && alvo.protocol !== "https:") return false;

  return registrados.some((registrado) => {
    const base = lerUrl(registrado);
    if (!base) return false;
    if (ehLoopback(alvo) && ehLoopback(base)) {
      return (
        alvo.hostname === base.hostname &&
        alvo.pathname === base.pathname &&
        alvo.search === base.search
      );
    }
    return alvo.href === base.href && pedido === registrado;
  });
}

/** Como a tela de consentimento nomeia o destino. */
export function descreverDestino(redirectUri: string): string {
  const url = lerUrl(redirectUri);
  if (!url) return redirectUri;
  return ehLoopback(url)
    ? "este computador (um programa rodando nele, como o Claude Code)"
    : url.hostname;
}
