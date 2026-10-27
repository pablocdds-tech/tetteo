import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
  hkdfSync,
} from "node:crypto";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { ErroCw } from "./config";

export function hashCw(valor: string) {
  return createHash("sha256").update(valor).digest("hex");
}
export function igualCw(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hashCw(a)), Buffer.from(hashCw(b)));
}
export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
function chave() {
  const valor = process.env.CARDAPIOWEB_ENCRYPTION_KEY;
  if (!valor && process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32)
    return Buffer.from(
      hkdfSync(
        "sha256",
        process.env.AUTH_SECRET,
        "tetteo",
        "cardapioweb:v1",
        32,
      ),
    );
  if (!valor || !/^[a-f0-9]{64}$/i.test(valor))
    throw new ErroCw(
      "configuracao",
      "Configure a chave de proteção Cardápio Web no servidor.",
    );
  return Buffer.from(valor, "hex");
}
export function cifrarCw(valor: string, contexto: string) {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  cifra.setAAD(Buffer.from(contexto));
  const corpo = Buffer.concat([cifra.update(valor, "utf8"), cifra.final()]);
  return [iv, cifra.getAuthTag(), corpo]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decifrarCw(valor: string, contexto: string) {
  try {
    const partes = valor.split(".");
    if (partes.length !== 3) throw new Error();
    const [iv, tag, corpo] = partes.map((v) => Buffer.from(v, "base64url"));
    const cifra = createDecipheriv("aes-256-gcm", chave(), iv);
    cifra.setAAD(Buffer.from(contexto));
    cifra.setAuthTag(tag);
    return Buffer.concat([cifra.update(corpo), cifra.final()]).toString("utf8");
  } catch {
    throw new ErroCw(
      "credencial",
      "Não foi possível abrir a credencial Cardápio Web. Revise a chave no servidor.",
    );
  }
}

export function escopoCw(contexto: ContextoSessao) {
  if (
    !contexto.permissoes.has("*") &&
    !contexto.permissoes.has("configuracoes.cardapioweb")
  )
    throw new ErroCw(
      "permissao",
      "Você não tem permissão para gerenciar integrações.",
    );
  const unidadeId = contexto.unidadeAtiva?.id;
  if (!unidadeId || !contexto.unidadesVisiveis.some((u) => u.id === unidadeId))
    throw new ErroCw(
      "unidade",
      "Selecione uma unidade autorizada para conectar o Cardápio Web.",
    );
  return {
    organizacaoId: contexto.organizacao.id,
    unidadeId,
    usuarioId: contexto.usuario.id,
  };
}
export type EscopoCw = ReturnType<typeof escopoCw>;
export function validarRetornoCw(
  params: URLSearchParams,
  cookie: string | undefined,
) {
  const state = params.get("state") || "";
  const code = params.get("code") || "";
  if (
    params.has("error") ||
    params.getAll("state").length !== 1 ||
    params.getAll("code").length !== 1 ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !cookie ||
    !igualCw(state, cookie) ||
    !code ||
    code.length > 4096
  )
    throw new ErroCw(
      "state",
      "A autorização não foi concluída neste navegador. Reinicie a conexão.",
    );
  return { state, code };
}
export function contextoCw(
  escopo: Pick<EscopoCw, "organizacaoId" | "unidadeId">,
  ambiente: string,
  clientId: string,
) {
  return JSON.stringify([
    "cardapioweb:v1",
    escopo.organizacaoId,
    escopo.unidadeId,
    ambiente,
    clientId,
  ]);
}
