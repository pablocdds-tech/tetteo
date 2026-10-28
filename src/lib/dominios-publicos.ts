export type DominiosPublicos = {
  principal: string;
  operacional: string;
  rotaAplicativo: string;
};

function origem(valor: string) {
  const u = new URL(valor);
  const local =
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname.endsWith(".localhost");
  if (
    (u.protocol !== "https:" && !(local && u.protocol === "http:")) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new Error(
      "Domínios públicos exigem uma origem HTTPS, sem caminho ou credenciais.",
    );
  return u.origin;
}

export function configurarDominios(
  principal?: string,
  operacional?: string,
  rotaAplicativo?: string,
): DominiosPublicos | null {
  if (!operacional?.trim()) return null;
  if (!principal || !rotaAplicativo || !/^\/[a-z0-9-]+$/.test(rotaAplicativo))
    throw new Error(
      "Informe APP_URL e APP_OPERACAO_ROTA para o ambiente operacional.",
    );
  const a = origem(principal),
    b = origem(operacional);
  if (a === b || new URL(a).host === new URL(b).host)
    throw new Error("Os ambientes precisam de domínios distintos.");
  return { principal: a, operacional: b, rotaAplicativo };
}

export function ambienteDaRequisicao(
  h: Pick<Headers, "get">,
  c: DominiosPublicos | null,
): "principal" | "operacional" | null {
  if (!c) return "principal";
  const host = h.get("host")?.toLowerCase();
  const encaminhado = h.get("x-forwarded-host")?.toLowerCase();
  if (!host || host.includes(",") || (encaminhado && encaminhado !== host))
    return null;
  if (host === new URL(c.principal).host) return "principal";
  if (host === new URL(c.operacional).host) return "operacional";
  return null;
}

const abaixo = (p: string, base: string) =>
  p === base || p.startsWith(`${base}/`);
const comuns = [
  "/login",
  "/conta",
  "/recuperar-senha",
  "/redefinir-senha",
  "/sobre",
  "/privacidade",
  "/termos",
];

export function destinoEntreAmbientes(
  c: DominiosPublicos | null,
  ambiente: "principal" | "operacional",
  caminho: string,
  busca: string,
  metodo: string,
): { url?: string; status?: 403 | 404 } | null {
  if (!c) return null;
  const leitura = metodo === "GET" || metodo === "HEAD";
  if (ambiente === "principal")
    return leitura && abaixo(caminho, c.rotaAplicativo)
      ? { url: `${c.operacional}${caminho}${busca}` }
      : null;
  if (caminho === "/")
    return leitura
      ? { url: `${c.operacional}${c.rotaAplicativo}${busca}` }
      : { status: 403 };
  if (
    abaixo(caminho, c.rotaAplicativo) ||
    comuns.includes(caminho) ||
    abaixo(caminho, "/api/crm/atendimento") ||
    abaixo(caminho, "/api/arquivos")
  )
    return null;
  if (abaixo(caminho, "/api")) return { status: 404 };
  return leitura
    ? { url: `${c.principal}${caminho}${busca}` }
    : { status: 403 };
}

export function redirecionamentoAutenticacao(
  url: string,
  baseUrl: string,
  c: DominiosPublicos | null,
) {
  const permitidas = c
    ? [c.principal, c.operacional]
    : [new URL(baseUrl).origin];
  const base = permitidas.includes(new URL(baseUrl).origin)
    ? new URL(baseUrl).origin
    : permitidas[0];
  try {
    const destino = new URL(url, base);
    if (
      !destino.username &&
      !destino.password &&
      permitidas.includes(destino.origin)
    )
      return destino.href;
  } catch {
    /* Destino inválido retoma a origem confiável. */
  }
  return base;
}
