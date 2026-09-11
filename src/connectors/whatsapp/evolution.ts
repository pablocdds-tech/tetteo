import { normalizarTelefone } from "@/lib/telefone";

import { configuracaoEvolution } from "./configuracao";
import { classificarFalha, entradaDoErro, type EntradaDeFalha } from "./falhas";
import { limparTexto } from "./sanitizar";
import {
  VALIDADE_DO_QR_MS,
  type ConfiguracaoDeEventos,
  type MensagemAchada,
  type ProvedorWhatsapp,
  type QrCode,
  type Resultado,
  type ResultadoConsulta,
  type ResultadoEnvio,
} from "./tipos";

/**
 * A PONTE COM O WHATSAPP — Evolution API 2.3.7, modalidade Baileys.
 *
 * Só esta pasta sabe o que é "Evolution API". Nenhum App ouviu falar dela — o
 * linter recusa `modules/` importando `connectors/`. Trocar de provedor um dia
 * é escrever outro arquivo que cumpra `ProvedorWhatsapp`, e nada mais.
 *
 * Fala com a Evolution POR DENTRO da rede do Docker (`evolution_api:8080`):
 * não sai da máquina e não passa pela internet. Nem o navegador fala com ela:
 * até o QR Code passa por aqui, dentro da resposta de uma ação do servidor.
 *
 * Cada caminho, método e corpo abaixo foi lido do código da etiqueta 2.3.7,
 * não da documentação — as duas divergem (ver o desenho, §3). Com a chave DA
 * INSTÂNCIA: na 2.3.7 ela vale em toda rota com `{instance}` no caminho.
 *
 * O que este arquivo nunca chama: `logout` e `delete` da instância. São as
 * únicas rotas que tiram o número do ar.
 */

export type CredencialEvolution = {
  url: string;
  instancia: string;
  chave: string;
};

export type LimitesEvolution = {
  limiteConsultaMs?: number;
  limiteEnvioMs?: number;
  limiteQrMs?: number;
};

/** Consulta de estado é o que a tela espera: rápido, ou "sem resposta". */
const CONSULTA_MS = 4_000;
/**
 * O envio pode demorar (a 2.3.7 confere se o número tem WhatsApp antes), mas
 * não pode pendurar o relógio da Severina, que tem um minuto por rodada.
 */
const ENVIO_MS = 15_000;
/** O `connect` espera 2 s antes de responder, quando precisa abrir socket. */
const QR_MS = 15_000;

type Resposta =
  | { tipo: "resposta"; status: number; corpo: unknown; texto: string }
  | { tipo: "falha"; entrada: EntradaDeFalha; motivo: string };

function duracao(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`;
}

function descreverFalhaDeRede(entrada: EntradaDeFalha, limiteMs: number) {
  if (entrada.tipo === "tempo") {
    return `A Evolution não respondeu em ${duracao(limiteMs)}.`;
  }
  if (entrada.tipo === "rede" && entrada.codigo) {
    return `Não foi possível falar com a Evolution (${entrada.codigo}).`;
  }
  return "A conexão com a Evolution caiu no meio do pedido.";
}

/** Só origem e caminho: consulta de URL é onde costuma morar um token. */
function mascararUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const lida = new URL(url);
    return `${lida.origin}${lida.pathname}`;
  } catch {
    return "(endereço inválido)";
  }
}

function segundosParaData(carimbo: unknown): Date | null {
  const valor =
    typeof carimbo === "number"
      ? carimbo
      : typeof carimbo === "string" && /^\d+$/.test(carimbo)
        ? Number(carimbo)
        : null;
  if (valor === null || valor <= 0) return null;
  return new Date(valor < 1e12 ? valor * 1000 : valor);
}

function textoDaMensagem(mensagem: unknown): string | null {
  if (!mensagem || typeof mensagem !== "object") return null;
  const m = mensagem as {
    conversation?: unknown;
    extendedTextMessage?: { text?: unknown };
  };
  if (typeof m.conversation === "string") return m.conversation;
  if (typeof m.extendedTextMessage?.text === "string") {
    return m.extendedTextMessage.text;
  }
  return null;
}

export function criarProvedorEvolution(
  credencial: CredencialEvolution,
  limites: LimitesEvolution = {},
): ProvedorWhatsapp {
  const consultaMs = limites.limiteConsultaMs ?? CONSULTA_MS;
  const envioMs = limites.limiteEnvioMs ?? ENVIO_MS;
  const qrMs = limites.limiteQrMs ?? QR_MS;
  const instancia = encodeURIComponent(credencial.instancia);

  // Todo texto que vem da Evolution passa por aqui antes de sair do conector.
  const limpar = (texto: string, ...outros: string[]) =>
    limparTexto(texto, [credencial.chave, ...outros]);

  async function chamar(
    metodo: "GET" | "POST",
    caminho: string,
    corpo: unknown,
    limiteMs: number,
  ): Promise<Resposta> {
    try {
      const resposta = await fetch(`${credencial.url}${caminho}`, {
        method: metodo,
        headers: {
          apikey: credencial.chave,
          ...(corpo === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(limiteMs),
      });
      const texto = await resposta.text();
      let lido: unknown = null;
      try {
        lido = texto ? JSON.parse(texto) : null;
      } catch {
        lido = null;
      }
      return { tipo: "resposta", status: resposta.status, corpo: lido, texto };
    } catch (erro) {
      const entrada = entradaDoErro(erro);
      return {
        tipo: "falha",
        entrada,
        motivo: descreverFalhaDeRede(entrada, limiteMs),
      };
    }
  }

  /** A frase para a tela. Nunca a resposta crua — ela ecoa a chave. */
  function motivoHttp(status: number, texto: string, corpo: unknown): string {
    if (status === 401 || status === 403) {
      return "A Evolution recusou a chave da instância. Confira EVOLUTION_API_KEY no servidor.";
    }
    if (status === 404) {
      return `A instância "${credencial.instancia}" não existe nesta Evolution.`;
    }
    if (status === 400 && /"exists"\s*:\s*false/.test(texto)) {
      return "Este número não tem WhatsApp.";
    }
    if (status === 429) return "A Evolution pediu para esperar (429).";
    if (status >= 500) return `A Evolution falhou (${status}).`;

    const mensagem = (corpo as { response?: { message?: unknown } } | null)
      ?.response?.message;
    const detalhe =
      typeof mensagem === "string" ? mensagem : JSON.stringify(mensagem ?? "");
    return limpar(`A Evolution recusou o pedido (${status}): ${detalhe}`);
  }

  async function numeroDoAparelho(): Promise<string | null> {
    // A resposta traz o `token` da instância junto. Só `ownerJid` é lido; o
    // resto é descartado aqui mesmo.
    const r = await chamar(
      "GET",
      `/instance/fetchInstances?instanceName=${instancia}`,
      undefined,
      consultaMs,
    );
    if (r.tipo === "falha" || r.status !== 200 || !Array.isArray(r.corpo)) {
      return null;
    }
    const jid = (r.corpo[0] as { ownerJid?: unknown } | undefined)?.ownerJid;
    return typeof jid === "string"
      ? normalizarTelefone(jid.split("@")[0])
      : null;
  }

  return {
    nome: "evolution",

    async consultarConexao(opcoes = {}): Promise<ResultadoConsulta> {
      const r = await chamar(
        "GET",
        `/instance/connectionState/${instancia}`,
        undefined,
        consultaMs,
      );
      if (r.tipo === "falha") return { tipo: "erro", motivo: r.motivo };
      if (r.status !== 200) {
        return { tipo: "erro", motivo: motivoHttp(r.status, r.texto, r.corpo) };
      }

      // Instância que existe no banco da Evolution mas não está carregada vem
      // sem `state`. Para quem olha a tela, é desconectada.
      const state = (r.corpo as { instance?: { state?: unknown } } | null)
        ?.instance?.state;
      const estado =
        state === "open"
          ? "CONECTADO"
          : state === "connecting"
            ? "CONECTANDO"
            : "DESCONECTADO";

      const numero =
        opcoes.comNumero && estado === "CONECTADO"
          ? await numeroDoAparelho()
          : null;
      return { tipo: "ok", estado, numero };
    },

    async lerEventos(): Promise<Resultado<ConfiguracaoDeEventos>> {
      const r = await chamar(
        "GET",
        `/webhook/find/${instancia}`,
        undefined,
        consultaMs,
      );
      if (r.tipo === "falha") return { ok: false, motivo: r.motivo };
      if (r.status !== 200) {
        return { ok: false, motivo: motivoHttp(r.status, r.texto, r.corpo) };
      }
      if (!r.corpo || typeof r.corpo !== "object") {
        return {
          ok: true,
          valor: { ativo: false, url: null, eventos: [], comSenha: false },
        };
      }

      const linha = r.corpo as {
        enabled?: unknown;
        url?: unknown;
        events?: unknown;
        headers?: unknown;
      };
      return {
        ok: true,
        valor: {
          ativo: linha.enabled === true,
          url: mascararUrl(linha.url),
          eventos: Array.isArray(linha.events)
            ? linha.events.filter((e): e is string => typeof e === "string")
            : [],
          // O VALOR da senha nunca sai daqui: só se ela existe.
          comSenha: Boolean(
            linha.headers &&
            typeof linha.headers === "object" &&
            "jwt_key" in linha.headers,
          ),
        },
      };
    },

    async configurarEventos({ url, senha, eventos }) {
      // Aninhado em `webhook`: é o que o `webhook.schema.ts` da 2.3.7 exige. A
      // documentação mostra o corpo plano — e a Evolution recusaria.
      const r = await chamar(
        "POST",
        `/webhook/set/${instancia}`,
        {
          webhook: {
            enabled: true,
            url,
            headers: { jwt_key: senha },
            byEvents: false,
            base64: false,
            events: [...eventos],
          },
        },
        consultaMs * 2,
      );
      if (r.tipo === "falha") return { ok: false, motivo: r.motivo };
      if (r.status !== 200 && r.status !== 201) {
        return {
          ok: false,
          motivo: limpar(motivoHttp(r.status, r.texto, r.corpo), senha),
        };
      }
      const aplicados = (r.corpo as { events?: unknown } | null)?.events;
      return {
        ok: true,
        valor: {
          eventos: Array.isArray(aplicados)
            ? aplicados.filter((e): e is string => typeof e === "string")
            : [...eventos],
        },
      };
    },

    async pedirQrCode(): Promise<Resultado<QrCode>> {
      // Com o número no ar, a 2.3.7 só devolve `{instance: {state: "open"}}`:
      // é inofensivo. É isto que faz "Reconectar" nunca derrubar ninguém.
      const r = await chamar(
        "GET",
        `/instance/connect/${instancia}`,
        undefined,
        qrMs,
      );
      if (r.tipo === "falha") return { ok: false, motivo: r.motivo };
      if (r.status !== 200) {
        return { ok: false, motivo: motivoHttp(r.status, r.texto, r.corpo) };
      }

      const corpo = (r.corpo ?? {}) as {
        instance?: { state?: unknown };
        base64?: unknown;
        error?: unknown;
        message?: unknown;
      };
      if (corpo.instance?.state === "open") {
        return { ok: true, valor: { tipo: "ja-conectado" } };
      }
      // A 2.3.7 devolve erro com HTTP 200 e `{error: true, message}`.
      if (corpo.error === true) {
        return { ok: false, motivo: limpar(String(corpo.message ?? "erro")) };
      }
      if (
        typeof corpo.base64 === "string" &&
        corpo.base64.startsWith("data:image/")
      ) {
        return {
          ok: true,
          valor: {
            tipo: "qr",
            imagem: corpo.base64,
            expiraEmMs: VALIDADE_DO_QR_MS,
          },
        };
      }
      return {
        ok: false,
        motivo:
          "A Evolution não devolveu QR Code agora. Tente de novo em alguns segundos.",
      };
    },

    async enviarMensagem({ para, texto }): Promise<ResultadoEnvio> {
      // Corpo PLANO (`message.schema.ts` da 2.3.7). `linkPreview: false`
      // porque o aviso leva o link do Tetteo, que exige login: a prévia seria
      // a tela de entrar, e a Evolution buscaria a página à toa.
      const r = await chamar(
        "POST",
        `/message/sendText/${instancia}`,
        { number: para, text: texto, linkPreview: false },
        envioMs,
      );

      if (r.tipo === "falha") {
        const classe = classificarFalha(r.entrada);
        return classe === "incerto"
          ? {
              tipo: "incerto",
              motivo: `${r.motivo} A mensagem pode ter saído.`,
            }
          : { tipo: "nao-chegou", motivo: r.motivo };
      }

      if (r.status === 200 || r.status === 201) {
        const id = (r.corpo as { key?: { id?: unknown } } | null)?.key?.id;
        // Sem id não dá para casar a confirmação de entrega — e uma mensagem
        // marcada como saída sem prova é pior do que uma incerteza declarada.
        if (typeof id === "string" && id) {
          return { tipo: "aceito", idMensagem: id, aceitoEm: new Date() };
        }
        return {
          tipo: "incerto",
          motivo:
            "A Evolution respondeu sem o id da mensagem — ela pode ter saído.",
        };
      }

      const classe = classificarFalha({ tipo: "http", status: r.status });
      const motivo = motivoHttp(r.status, r.texto, r.corpo);
      if (classe === "incerto") {
        return {
          tipo: "incerto",
          motivo: `${motivo} A mensagem pode ter saído.`,
        };
      }
      return { tipo: classe, motivo };
    },

    async consultarMensagem({ texto, desde }) {
      // `offset` é o tamanho da página na 2.3.7; `limit` é ignorado.
      const r = await chamar(
        "POST",
        `/chat/findMessages/${instancia}`,
        {
          where: {
            key: { fromMe: true },
            messageTimestamp: { gte: Math.floor(desde.getTime() / 1000) },
          },
          page: 1,
          offset: 50,
        },
        consultaMs * 2,
      );
      if (r.tipo === "falha") return { ok: false, motivo: r.motivo };
      if (r.status !== 200) {
        return { ok: false, motivo: motivoHttp(r.status, r.texto, r.corpo) };
      }

      const registros = (r.corpo as { messages?: { records?: unknown } } | null)
        ?.messages?.records;
      if (!Array.isArray(registros)) return { ok: true, valor: null };

      // Texto IDÊNTICO: o aviso leva uma referência única no fim, então não
      // existe outra mensagem com o mesmo texto.
      for (const registro of registros) {
        const r2 = registro as {
          key?: { id?: unknown };
          message?: unknown;
          messageTimestamp?: unknown;
        };
        if (textoDaMensagem(r2.message) !== texto) continue;
        if (typeof r2.key?.id !== "string") continue;
        const achada: MensagemAchada = {
          idMensagem: r2.key.id,
          enviadaEm: segundosParaData(r2.messageTimestamp),
        };
        return { ok: true, valor: achada };
      }
      return { ok: true, valor: null };
    },
  };
}

/**
 * A fila da Severina (agentes de aviso) ainda fala assim. Mesma ponte, agora
 * com o erro limpo antes de ir para a coluna `erro` da mensagem.
 */
export async function enviarTexto(
  para: string,
  texto: string,
): Promise<{ ok: true; idExterno: string } | { ok: false; erro: string }> {
  const config = configuracaoEvolution(process.env);
  if (config.tipo === "pendente") {
    return {
      ok: false,
      erro: `Configuração pendente: ${config.faltando.join(", ")}.`,
    };
  }
  const r = await criarProvedorEvolution(config).enviarMensagem({
    para,
    texto,
  });
  return r.tipo === "aceito"
    ? { ok: true, idExterno: r.idMensagem }
    : { ok: false, erro: r.motivo };
}
