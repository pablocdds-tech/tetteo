import {
  chavesDoWebhook,
  configuracaoEvolution,
} from "@/connectors/whatsapp/configuracao";
import { verificarPasse } from "@/connectors/whatsapp/passe";
import {
  interpretarWebhook,
  LIMITE_DO_CORPO,
  type EventoDaEvolution,
} from "@/connectors/whatsapp/webhook-evolution";
import type { EventoNormalizado } from "@/modules/assistente/schemas/evento";
import {
  conexaoPorNome,
  type ConexaoInterna,
} from "@/modules/assistente/services/conexao";
import {
  processarEvento,
  registrarEvento,
} from "@/modules/assistente/services/eventos";
import { vinculoPorContato } from "@/modules/assistente/services/vinculos";

/**
 * A ENTRADA DO WEBHOOK — as travas, na ordem, e o que cada uma responde.
 *
 *   503  senha do webhook não configurada no servidor
 *   403  chegou pelo proxy público (a Evolution fala pela rede interna)
 *   415  não é JSON
 *   401  sem passe, ou passe que não confere
 *   413  corpo maior que 256 KB, contado na leitura
 *   400  JSON quebrado, ou fora do formato da 2.3.7
 *   422  tipo que o Tetteo não assina — o QR Code inclusive
 *   404  instância que não está no cadastro, ou não é a da credencial
 *   200  gravado (ou repetido), e processado DEPOIS da resposta
 *
 * A Evolution 2.3.7 não repete 400, 401, 403, 404 e 422 — é por isso que
 * cada recusa definitiva usa um desses. O 503 ela repete, e é o que se quer:
 * a configuração pode chegar em minutos.
 *
 * Mora em `app/` porque é a única camada que alcança o conector (que lê o
 * formato da Evolution) e a Severina (que grava). Recebe o `agendar` de fora:
 * na rota é o `after()` do Next; no ensaio, uma função que roda na hora.
 */

type Ambiente = Record<string, string | undefined>;

export type DependenciasDoWebhook = {
  agendar: (tarefa: () => Promise<void>) => void;
  agora?: () => Date;
  env?: Ambiente;
};

const FRASES: Record<number, string> = {
  400: "malformado",
  401: "não autorizado",
  403: "origem não aceita",
  404: "instância desconhecida",
  413: "grande demais",
  415: "formato não aceito",
  422: "tipo de evento não aceito",
  500: "falha ao gravar",
  503: "configuração pendente",
};

/** Quem chamou recebe só o código; o motivo vai para o log — sem corpo, sem passe. */
function recusa(status: number, motivo: string): Response {
  console.warn(`[whatsapp] webhook recusado (${status}): ${motivo}`);
  return Response.json({ ok: false, erro: FRASES[status] }, { status });
}

async function lerCorpo(
  request: Request,
  limite: number,
): Promise<{ texto: string } | { grandeDemais: true }> {
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (declarado > limite) return { grandeDemais: true };

  // O cabeçalho pode mentir: conta de verdade, byte a byte.
  const leitor = request.body?.getReader();
  if (!leitor) return { texto: "" };
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return { grandeDemais: true };
    }
    partes.push(value);
  }
  return { texto: new TextDecoder().decode(Buffer.concat(partes)) };
}

/** A credencial do servidor é desta conexão? Senão, o evento não é nosso. */
function conexaoAceita(conexao: ConexaoInterna, env: Ambiente): boolean {
  if (conexao.provedor === "SIMULADO") return env.NODE_ENV !== "production";
  const config = configuracaoEvolution(env);
  return config.tipo === "ok" && config.instancia === conexao.nome;
}

async function normalizar(
  evento: EventoDaEvolution,
  organizacaoId: string,
): Promise<EventoNormalizado> {
  switch (evento.tipo) {
    case "connection.update":
      return {
        tipo: evento.tipo,
        idExterno: evento.idExterno,
        estado: evento.estado,
        codigo: evento.codigo,
        numero: evento.numero,
      };
    case "messages.update":
      return {
        tipo: evento.tipo,
        idExterno: evento.idExterno,
        idMensagem: evento.idMensagem,
        status: evento.status,
        deMim: evento.deMim,
      };
    case "send.message":
      return {
        tipo: evento.tipo,
        idExterno: evento.idExterno,
        idMensagem: evento.idMensagem,
        hashTexto: evento.hashTexto,
        enviadaEm: evento.enviadaEm,
      };
    case "messages.upsert":
      // O contato de quem escreveu só serve para achar o vínculo, e para
      // aqui: dali em diante, o evento sabe "vinculado" ou "ninguém".
      return {
        tipo: evento.tipo,
        idExterno: evento.idExterno,
        idMensagem: evento.idMensagem,
        deMim: evento.deMim,
        grupo: evento.grupo,
        vinculoId:
          evento.deMim || evento.grupo
            ? null
            : await vinculoPorContato(organizacaoId, evento.remetente),
      };
  }
}

export async function receberWebhook(
  request: Request,
  {
    agendar,
    agora = () => new Date(),
    env = process.env,
  }: DependenciasDoWebhook,
): Promise<Response> {
  const senhas = chavesDoWebhook(env);
  if (senhas.length === 0) {
    return recusa(503, "WHATSAPP_WEBHOOK_CHAVE não configurada");
  }

  // O Next preenche `x-forwarded-for/host/proto/port` sozinho em toda
  // requisição (base-server.js). `X-Forwarded-Server` e `X-Real-Ip` só o
  // Traefik põe — e a Evolution, na rede interna, não passa por ele.
  if (
    request.headers.get("x-forwarded-server") ||
    request.headers.get("x-real-ip")
  ) {
    return recusa(403, "chegou pelo proxy público");
  }

  if (
    !(request.headers.get("content-type") ?? "").includes("application/json")
  ) {
    return recusa(415, "content-type não é JSON");
  }

  // O passe antes do corpo: quem não se identificou não faz o servidor ler
  // nem os 256 KB.
  const passe = verificarPasse(
    request.headers.get("authorization"),
    senhas,
    agora(),
  );
  if (!passe.ok) return recusa(401, passe.motivo);

  const corpo = await lerCorpo(request, LIMITE_DO_CORPO);
  if ("grandeDemais" in corpo) return recusa(413, "corpo acima de 256 KB");

  const lido = interpretarWebhook(corpo.texto);
  if (!lido.ok) return recusa(lido.status, lido.motivo);

  // A organização e a loja saem do CADASTRO da instância — nunca do corpo.
  const conexao = await conexaoPorNome(lido.evento.instancia);
  if (!conexao || !conexaoAceita(conexao, env)) {
    return recusa(404, "instância fora do cadastro ou da credencial");
  }

  try {
    const evento = await normalizar(lido.evento, conexao.organizacaoId);
    const momento = agora();
    const gravado = await registrarEvento(conexao, evento, momento);

    if (!gravado.duplicado) {
      // Responde já; processa depois. A Evolution espera até 30 s e repete
      // o que demorou — resposta lenta vira evento duplicado.
      agendar(async () => {
        await processarEvento(gravado.id, agora(), evento);
      });
    }
    return Response.json({ ok: true, duplicado: gravado.duplicado });
  } catch (erro) {
    return recusa(500, erro instanceof Error ? erro.name : "erro ao gravar");
  }
}
