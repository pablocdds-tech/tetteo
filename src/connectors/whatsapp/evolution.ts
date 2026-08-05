/**
 * A PONTE COM O WHATSAPP.
 *
 * Só este arquivo sabe o que é "Evolution API". Nenhum App ouviu falar dela —
 * o linter recusa `modules/` importando `connectors/`. Trocar de provedor de
 * WhatsApp um dia é reescrever esta pasta, e nada mais.
 *
 * Fala com a Evolution POR DENTRO da rede do Docker (`evolution_api:8080`):
 * não sai da máquina, não passa pela internet, não gasta TLS. A URL pública
 * (`https://evo.…`) existe só para o navegador ler o QR Code.
 */

const URL_BASE = process.env.EVOLUTION_URL ?? "http://evolution_api:8080";
const CHAVE = process.env.EVOLUTION_API_KEY ?? "";
const INSTANCIA = process.env.EVOLUTION_INSTANCIA ?? "severina-teste";

export type ResultadoEnvio =
  { ok: true; idExterno: string } | { ok: false; erro: string };

async function chamar(caminho: string, corpo?: unknown): Promise<unknown> {
  const resposta = await fetch(`${URL_BASE}${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: {
      apikey: CHAVE,
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    // O relógio tem um minuto para a rodada inteira. Pendurar aqui trava a
    // fila e a cobrança das 7h não sai para mais ninguém.
    signal: AbortSignal.timeout(20_000),
  });

  const texto = await resposta.text();
  if (!resposta.ok) {
    // Recorta a resposta: erro da Evolution às vezes vem com o payload todo
    // dentro, e isso acabaria gravado na coluna de erro da mensagem.
    throw new Error(`Evolution ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

/**
 * `para` é o telefone em E.164 sem "+": "5584981336549". Quem normaliza é
 * `lib/telefone`; aqui já chega pronto.
 */
export async function enviarTexto(
  para: string,
  texto: string,
): Promise<ResultadoEnvio> {
  try {
    const resposta = (await chamar(`/message/sendText/${INSTANCIA}`, {
      number: para,
      text: texto,
    })) as { key?: { id?: string } } | null;

    const idExterno = resposta?.key?.id;
    // Sem id não dá para casar a confirmação de entrega depois — e uma
    // mensagem marcada como enviada sem prova é pior do que uma falha.
    if (!idExterno) return { ok: false, erro: "resposta sem id de mensagem" };

    return { ok: true, idExterno };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O número ainda está conectado?
 *
 * WhatsApp por QR Code depende de um celular ligado. A queda não avisa: ela
 * aparece como "ninguém recebeu o aviso de hoje". Esta função é o que permite
 * a tela dizer isso antes da reclamação.
 */
export async function estadoDaConexao(): Promise<{
  conectado: boolean;
  estado: string;
}> {
  try {
    const r = (await chamar(`/instance/connectionState/${INSTANCIA}`)) as {
      instance?: { state?: string };
    } | null;
    const estado = r?.instance?.state ?? "desconhecido";
    return { conectado: estado === "open", estado };
  } catch (e) {
    return {
      conectado: false,
      estado: e instanceof Error ? e.message : "erro",
    };
  }
}
