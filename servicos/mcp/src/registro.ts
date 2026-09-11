/**
 * O REGISTRO DO SERVIDOR: uma linha JSON por evento, que o Dokploy guarda.
 *
 * Duas regras que não se negociam. Nada de token, código, senha ou e-mail aqui
 * dentro — as chaves perigosas são apagadas pelo NOME, porque ninguém lembra
 * de limpar o valor em todo lugar que registra. E nada de query string: quem
 * registra uma requisição passa `req.path`, nunca `req.url`.
 */

export type Nivel = "info" | "aviso" | "erro";

export type Registro = Record<
  Nivel,
  (mensagem: string, dados?: Record<string, unknown>) => void
>;

const PROIBIDAS =
  /token|senha|password|secret|segredo|authorization|cookie|code|codigo|verifier|email/i;

function limpar(valor: unknown, profundidade = 0): unknown {
  if (valor instanceof Error) {
    return { nome: valor.name, mensagem: valor.message, pilha: valor.stack };
  }
  if (profundidade > 4 || valor === null || typeof valor !== "object") {
    return valor;
  }
  if (Array.isArray(valor)) {
    return valor.map((item) => limpar(item, profundidade + 1));
  }
  return Object.fromEntries(
    Object.entries(valor).map(([chave, item]) => [
      chave,
      PROIBIDAS.test(chave) ? "[omitido]" : limpar(item, profundidade + 1),
    ]),
  );
}

export function criarRegistro(
  escrever: (linha: string) => void = (linha) =>
    process.stdout.write(`${linha}\n`),
): Registro {
  const emitir =
    (nivel: Nivel) =>
    (mensagem: string, dados: Record<string, unknown> = {}) => {
      escrever(
        JSON.stringify({
          hora: new Date().toISOString(),
          nivel,
          mensagem,
          ...(limpar(dados) as Record<string, unknown>),
        }),
      );
    };
  return { info: emitir("info"), aviso: emitir("aviso"), erro: emitir("erro") };
}

/** Para testes que não querem poluir a saída. */
export const registroSilencioso: Registro = {
  info() {},
  aviso() {},
  erro() {},
};
