import { Agent, request } from "node:https";
import { createHash } from "node:crypto";
import type { TransacaoBancaria } from "@/lib/extrato-bancario";
import { normalizarPem, normalizarTransacao } from "./normalizar";

type Config = { envKey: string; ambiente: string; id: string; cnpj: string };
const tokens = new Map<string, { token: string; ate: number }>();

function configuracao(c: Config) {
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(c.envKey))
    throw new Error("Identificador de credenciais inválido.");
  const obter = (s: string) => {
    const v = process.env[`INTER_${c.envKey}_${s}`];
    if (!v) throw new Error(`Configure INTER_${c.envKey}_${s} no host.`);
    return v;
  };
  return {
    client: obter("CLIENT_ID"),
    secret: obter("CLIENT_SECRET"),
    cert: normalizarPem(obter("CERT"), "CERTIFICATE"),
    key: normalizarPem(obter("KEY"), "PRIVATE KEY"),
  };
}

/** Apenas endpoints de consulta; sem redirects, sem log do corpo ou segredos. */
export async function clienteInter(c: Config) {
  const conf = configuracao(c);
  const host =
    c.ambiente === "producao"
      ? "cdpj.partners.bancointer.com.br"
      : "cdpj-sandbox.partners.uatinter.co";
  const agente = new Agent({ cert: conf.cert, key: conf.key, keepAlive: true });
  const cacheKey = createHash("sha256")
    .update(JSON.stringify([c.id, c.ambiente, conf]))
    .digest("hex");
  const chamar = (
    caminho: string,
    token?: string,
    body?: string,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: host,
          path: caminho,
          method: body ? "POST" : "GET",
          agent: agente,
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body
              ? {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Content-Length": Buffer.byteLength(body),
                }
              : {}),
          },
        },
        (res) => {
          const partes: Buffer[] = [];
          let tamanho = 0;
          res.on("data", (p: Buffer) => {
            tamanho += p.length;
            if (tamanho > 5 * 1024 * 1024) {
              req.destroy();
              reject(new Error("Resposta do Inter excede o limite."));
            } else partes.push(p);
          });
          res.on("error", () =>
            reject(new Error("Resposta do Inter interrompida.")),
          );
          res.on("end", () => {
            if (
              !res.statusCode ||
              res.statusCode < 200 ||
              res.statusCode >= 300
            ) {
              if (res.statusCode === 401) tokens.delete(cacheKey);
              reject(
                new Error(
                  `Inter retornou HTTP ${res.statusCode ?? "desconhecido"}. Confira credenciais, certificado e permissões.`,
                ),
              );
              return;
            }
            try {
              const json = JSON.parse(Buffer.concat(partes).toString("utf8"));
              if (!json || typeof json !== "object" || Array.isArray(json))
                throw new Error();
              resolve(json);
            } catch {
              reject(new Error("Resposta do Inter em formato inesperado."));
            }
          });
        },
      );
      const tempo = setTimeout(() => req.destroy(new Error("timeout")), 30000);
      req.on("close", () => clearTimeout(tempo));
      req.on("error", () =>
        reject(
          new Error(
            "Falha na conexão Inter. Confira internet, certificado mTLS e validade da integração.",
          ),
        ),
      );
      if (body) req.write(body);
      req.end();
    });
  try {
    let cache = tokens.get(cacheKey);
    if (!cache || cache.ate <= Date.now()) {
      const t = await chamar(
        "/oauth/v2/token",
        undefined,
        new URLSearchParams({
          client_id: conf.client,
          client_secret: conf.secret,
          grant_type: "client_credentials",
          scope: "extrato.read",
        }).toString(),
      );
      if (
        typeof t.access_token !== "string" ||
        typeof t.expires_in !== "number" ||
        t.expires_in <= 60
      )
        throw new Error("Token Inter inválido.");
      cache = {
        token: t.access_token,
        ate: Date.now() + (t.expires_in - 60) * 1000,
      };
      if (tokens.size > 100) tokens.clear();
      tokens.set(cacheKey, cache);
    }
    const token = cache.token;
    return {
      fechar: () => agente.destroy(),
      testar: async () => {
        const saldo = await chamar("/banking/v2/saldo", token);
        if (
          typeof saldo.disponivel !== "number" ||
          !Number.isFinite(saldo.disponivel)
        )
          throw new Error("Consulta de saldo Inter em formato inesperado.");
      },
      extrato: async (
        de: string,
        ate: string,
      ): Promise<TransacaoBancaria[]> => {
        const transacoes: TransacaoBancaria[] = [];
        const ids = new Set<string>();
        for (let pagina = 0; pagina < 10; pagina++) {
          // O contrato oficial limita a paginação tradicional a 10 mil itens
          // e a API a dez consultas por minuto.
          if (pagina > 0)
            await new Promise((resolve) => setTimeout(resolve, 6500));
          const q = new URLSearchParams({
            dataInicio: de,
            dataFim: ate,
            pagina: String(pagina),
            tamanhoPagina: "1000",
          });
          const dados = await chamar(
            `/banking/v2/extrato/completo?${q}`,
            token,
          );
          if (!Array.isArray(dados.transacoes))
            throw new Error(
              "Extrato Inter sem lista de transações reconhecida.",
            );
          for (const bruto of dados.transacoes) {
            const t = normalizarTransacao(bruto, c.id, c.cnpj);
            if (ids.has(t.id))
              throw new Error(
                "Extrato contém identificadores repetidos. Sincronização interrompida para evitar baixa incorreta.",
              );
            ids.add(t.id);
            transacoes.push(t);
          }
          if (transacoes.length > 10000)
            throw new Error(
              "Extrato excede 10 mil transações. Reduza a janela de consulta.",
            );
          const total = dados.totalPaginas ?? dados.numeroDePaginas;
          if (
            typeof total === "number" &&
            Number.isInteger(total) &&
            total >= 0
          ) {
            if (pagina + 1 >= total) return transacoes;
          } else if (dados.transacoes.length < 1000) return transacoes;
        }
        throw new Error(
          "Limite de páginas do Inter atingido; extrato não processado.",
        );
      },
    };
  } catch (erro) {
    agente.destroy();
    throw erro;
  }
}
