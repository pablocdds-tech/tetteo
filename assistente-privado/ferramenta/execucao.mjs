import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

/**
 * A EXECUÇÃO — o que impede o relatório duplicado.
 *
 * A CHAVE é o resumo do conteúdo do arquivo + loja + período. Mesma entrada,
 * mesma chave, mesmos arquivos: chamar de novo, reiniciar o container no
 * meio, repetir a pergunta — nada disso gera um segundo relatório.
 *
 * Os números ficam em `<chave>.dados.json` desde o cálculo. Se o modelo cair
 * antes de redigir, nada se perde: o texto pode ser pedido depois.
 *
 * A TRAVA vale por chave, marcada com dono único para evitar que quem a julgou
 * abandonada delete a trava de outro que ainda está rodando. Uma trava de
 * processo morto vence pelo horário do arquivo (não pelo conteúdo, que pode ter
 * ficado pela metade) e é trocada.
 */

export const VENCIMENTO_DA_TRAVA_MS = 10 * 60_000;
export const LIMITE_PARA_INTERROMPIDO_MS = 15 * 60_000;

export class EmAndamento extends Error {
  constructor(chave) {
    super(`Já existe uma execução em andamento para a chave ${chave}.`);
    this.name = "EmAndamento";
  }
}

export function chaveDaExecucao({ conteudo, loja, de, ate }) {
  return createHash("sha256")
    .update(`${loja}\n${de}\n${ate}\n`)
    .update(conteudo)
    .digest("hex")
    .slice(0, 16);
}

export function caminhos(pastaTrabalho, chave) {
  const relatorios = path.join(pastaTrabalho, "relatorios");
  return {
    relatorios,
    dados: path.join(relatorios, `${chave}.dados.json`),
    relatorio: path.join(relatorios, `${chave}.md`),
    estado: path.join(relatorios, `${chave}.estado.json`),
    trava: path.join(relatorios, ".travas", `${chave}.trava`),
  };
}

async function lerJson(arquivo) {
  try {
    return JSON.parse(await readFile(arquivo, "utf8"));
  } catch (erro) {
    if (erro.code === "ENOENT") return null;
    throw erro;
  }
}

async function existe(arquivo) {
  try {
    await stat(arquivo);
    return true;
  } catch (erro) {
    if (erro.code === "ENOENT") return false;
    throw erro;
  }
}

/** Escreve ao lado e renomeia: ninguém lê meio arquivo. */
async function gravarAtomico(arquivo, conteudo) {
  await mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporario, conteudo, "utf8");
  await rename(temporario, arquivo);
}

export async function lerExecucao(pastaTrabalho, chave) {
  const c = caminhos(pastaTrabalho, chave);
  return {
    dados: await lerJson(c.dados),
    estadoGravado: await lerJson(c.estado),
    temRelatorio: await existe(c.relatorio),
  };
}

export async function gravarDados(pastaTrabalho, chave, dados) {
  await gravarAtomico(
    caminhos(pastaTrabalho, chave).dados,
    JSON.stringify(dados, null, 2),
  );
}

export async function gravarRelatorio(pastaTrabalho, chave, texto) {
  await gravarAtomico(caminhos(pastaTrabalho, chave).relatorio, texto);
}

export async function marcarEstado(
  pastaTrabalho,
  chave,
  estado,
  agora = new Date(),
) {
  await gravarAtomico(
    caminhos(pastaTrabalho, chave).estado,
    JSON.stringify({ estado, em: agora.toISOString() }),
  );
}

export function estadoAtual(
  { dados, estadoGravado, temRelatorio },
  agora = new Date(),
) {
  if (!dados) return null;
  if (temRelatorio) return "concluido";
  if (estadoGravado?.estado === "cancelado") return "cancelado";
  if (dados.estado === "sem_dados") return "sem_dados";
  const calculadoEm = Date.parse(dados.calculadoEm);
  if (
    Number.isFinite(calculadoEm) &&
    agora.getTime() - calculadoEm > LIMITE_PARA_INTERROMPIDO_MS
  ) {
    return "interrompido";
  }
  return "calculado";
}

export async function comTrava(
  pastaTrabalho,
  chave,
  fn,
  { vencimentoMs = VENCIMENTO_DA_TRAVA_MS } = {},
) {
  const { trava } = caminhos(pastaTrabalho, chave);
  await mkdir(path.dirname(trava), { recursive: true });
  // Cada execução marca a trava com um dono único: só quem a pôs pode tirá-la.
  const dono = `${process.pid}-${randomUUID()}`;

  const tentar = async () => {
    const arquivo = await open(trava, "wx");
    try {
      await arquivo.writeFile(
        JSON.stringify({ dono, em: new Date().toISOString() }),
      );
    } finally {
      await arquivo.close();
    }
  };

  const adquirir = async () => {
    try {
      await tentar();
      return;
    } catch (erro) {
      if (erro.code !== "EEXIST") throw erro;
    }
    let mtimeMs = null;
    try {
      ({ mtimeMs } = await stat(trava));
    } catch (erro) {
      // A trava sumiu entre a tentativa e a leitura: o dono terminou agora.
      if (erro.code !== "ENOENT") throw erro;
    }
    if (mtimeMs !== null && Date.now() - mtimeMs <= vencimentoMs)
      throw new EmAndamento(chave);
    if (mtimeMs !== null) await unlink(trava).catch(() => {});
    try {
      await tentar();
    } catch (erro) {
      if (erro.code === "EEXIST") throw new EmAndamento(chave);
      throw erro;
    }
  };

  await adquirir();
  try {
    return await fn();
  } finally {
    // Só apaga se a trava ainda for NOSSA: se alguém a julgou abandonada e pôs
    // a dele no lugar, apagar agora liberaria uma terceira execução.
    const atual = await readFile(trava, "utf8")
      .then((texto) => JSON.parse(texto))
      .catch(() => null);
    if (atual?.dono === dono) await unlink(trava).catch(() => {});
  }
}
