import { timingSafeEqual } from "node:crypto";

import { corpoDoRegistro } from "@/modules/assistente-privado/schemas/registro";
import {
  UnidadeNaoConfigurada,
  gravarRegistro,
} from "@/modules/assistente-privado/services/registros";

/**
 * A PORTA DOS RECADOS DO OPENCLAW.
 *
 * Fechada por omissão: sem ASSISTENTE_PRIVADO_SEGREDO (32+ caracteres) no
 * servidor, ninguém entra. O segredo é comparado em tempo constante, o corpo
 * tem teto de 16 KB e passa pelo Zod estrito, e a unidade vem da
 * configuração — nunca do recado.
 *
 * Esta porta só grava recado. Não lê nada do sistema e não escreve em outra
 * tabela: um recado não tem como virar pedido, pagamento ou mensagem.
 */

export const LIMITE_DO_CORPO = 16_384;
const MINIMO_DO_SEGREDO = 32;

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.ASSISTENTE_PRIVADO_SEGREDO ?? "";
  if (esperado.length < MINIMO_DO_SEGREDO || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const responder = (status: number, corpo: Record<string, unknown>) =>
  Response.json(corpo, { status });

export async function receberRegistro(request: Request): Promise<Response> {
  if (!segredoConfere(request.headers.get("x-assistente-segredo"))) {
    return responder(401, { erro: "não autorizado" });
  }
  const unidadeId = process.env.ASSISTENTE_PRIVADO_UNIDADE_ID ?? "";
  if (!unidadeId) {
    return responder(503, {
      erro: "configuração pendente: ASSISTENTE_PRIVADO_UNIDADE_ID",
    });
  }

  const bruto = await request.text();
  if (Buffer.byteLength(bruto) > LIMITE_DO_CORPO)
    return responder(413, { erro: "recado grande demais" });

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return responder(400, { erro: "o corpo não é JSON" });
  }

  const leitura = corpoDoRegistro.safeParse(json);
  if (!leitura.success) {
    const campos = [
      ...new Set(leitura.error.issues.map((i) => i.path.join(".") || "(raiz)")),
    ];
    return responder(400, {
      erro: "recado inválido",
      campos: campos.slice(0, 10),
    });
  }

  try {
    return responder(200, {
      ok: true,
      ...(await gravarRegistro(unidadeId, leitura.data)),
    });
  } catch (erro) {
    if (erro instanceof UnidadeNaoConfigurada)
      return responder(503, { erro: erro.message });
    throw erro;
  }
}
