import {
  VALIDADE_DO_QR_MS,
  type EstadoDoProvedor,
  type ProvedorWhatsapp,
} from "./tipos";

/**
 * O PROVEDOR SIMULADO — para o ensaio, nunca para produção.
 *
 * Cumpre o mesmo contrato da Evolution sem abrir conexão nenhuma. É o que
 * permite provar, antes de qualquer número real, os casos que não se provocam
 * de propósito num WhatsApp de verdade: o tempo esgotado em que a mensagem
 * saiu, o que ela não saiu, a credencial recusada, a rede fora.
 *
 * O estado mora em `globalThis` porque o servidor de desenvolvimento recarrega
 * módulos a cada alteração: sem isso, o número "desconectaria" sozinho.
 *
 * `provedorPara` recusa este provedor quando `NODE_ENV=production`.
 */

export type ComportamentoDoSimulador =
  /** Envia e responde. */
  | "aceita"
  /** A mensagem SAIU, mas a resposta se perdeu — o caso que duplica. */
  | "tempo-esgotado-saiu"
  /** Não saiu, e a resposta também não veio. */
  | "tempo-esgotado-nao-saiu"
  | "sem-rede"
  | "erro-5xx"
  | "recusa-credencial";

export type EnviadaNoSimulador = {
  idMensagem: string;
  para: string;
  texto: string;
  em: Date;
};

export type EstadoDoSimulador = {
  estado: EstadoDoProvedor;
  numero: string;
  comportamento: ComportamentoDoSimulador;
  enviadas: EnviadaNoSimulador[];
  tentativasDeEnvio: number;
  eventos: { url: string; eventos: string[]; comSenha: boolean } | null;
  qrPedidos: number;
  proximoId: number;
};

const CHAVE_GLOBAL = Symbol.for("tetteo.whatsapp.simulador");

function inicial(): EstadoDoSimulador {
  return {
    estado: "CONECTADO",
    // Fictício: faixa 5511 9000-00xx, que ninguém usa.
    numero: "5511900000001",
    comportamento: "aceita",
    enviadas: [],
    tentativasDeEnvio: 0,
    eventos: null,
    qrPedidos: 0,
    proximoId: 1,
  };
}

function armazem() {
  return globalThis as unknown as Record<symbol, EstadoDoSimulador | undefined>;
}

export function simulador(): EstadoDoSimulador {
  const g = armazem();
  g[CHAVE_GLOBAL] ??= inicial();
  return g[CHAVE_GLOBAL];
}

export function reiniciarSimulador(
  parcial: Partial<EstadoDoSimulador> = {},
): EstadoDoSimulador {
  const g = armazem();
  g[CHAVE_GLOBAL] = { ...inicial(), ...parcial };
  return g[CHAVE_GLOBAL];
}

/**
 * Um desenho que diz o que é. NÃO é um QR Code: não conecta nada, e por isso
 * pode aparecer em teste sem risco.
 */
const DESENHO_DE_ENSAIO = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="264" height="264" viewBox="0 0 264 264">' +
    '<rect width="264" height="264" fill="#ffffff"/>' +
    '<rect x="14" y="14" width="236" height="236" fill="none" stroke="#202124" stroke-width="4" stroke-dasharray="12 8"/>' +
    '<text x="132" y="126" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#202124">QR de ensaio</text>' +
    '<text x="132" y="154" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#646870">não conecta nada</text>' +
    "</svg>",
).toString("base64")}`;

const RECUSA_DE_CREDENCIAL =
  "A Evolution recusou a chave da instância. Confira EVOLUTION_API_KEY no servidor.";
const SEM_REDE = "Não foi possível falar com a Evolution (ECONNREFUSED).";

export function criarProvedorSimulado(): ProvedorWhatsapp {
  return {
    nome: "simulado",

    async consultarConexao() {
      const s = simulador();
      if (s.comportamento === "recusa-credencial") {
        return { tipo: "erro", motivo: RECUSA_DE_CREDENCIAL };
      }
      if (s.comportamento === "sem-rede")
        return { tipo: "erro", motivo: SEM_REDE };
      return {
        tipo: "ok",
        estado: s.estado,
        numero: s.estado === "CONECTADO" ? s.numero : null,
      };
    },

    async lerEventos() {
      const s = simulador();
      return {
        ok: true,
        valor: s.eventos
          ? { ativo: true, ...s.eventos }
          : { ativo: false, url: null, eventos: [], comSenha: false },
      };
    },

    async configurarEventos({ url, senha, eventos }) {
      const s = simulador();
      if (s.comportamento === "recusa-credencial") {
        return { ok: false, motivo: RECUSA_DE_CREDENCIAL };
      }
      s.eventos = { url, eventos: [...eventos], comSenha: Boolean(senha) };
      return { ok: true, valor: { eventos: [...eventos] } };
    },

    async pedirQrCode() {
      const s = simulador();
      if (s.estado === "CONECTADO") {
        return { ok: true, valor: { tipo: "ja-conectado" } };
      }
      s.qrPedidos++;
      s.estado = "CONECTANDO";
      return {
        ok: true,
        valor: {
          tipo: "qr",
          imagem: DESENHO_DE_ENSAIO,
          expiraEmMs: VALIDADE_DO_QR_MS,
        },
      };
    },

    async enviarMensagem({ para, texto }) {
      const s = simulador();
      s.tentativasDeEnvio++;

      if (s.estado !== "CONECTADO") {
        return { tipo: "nao-chegou", motivo: "O número está desconectado." };
      }

      const registrar = () => {
        const enviada = {
          idMensagem: `3EB0SIM${String(s.proximoId++).padStart(6, "0")}`,
          para,
          texto,
          em: new Date(),
        };
        s.enviadas.push(enviada);
        return enviada;
      };

      switch (s.comportamento) {
        case "aceita": {
          const enviada = registrar();
          return {
            tipo: "aceito",
            idMensagem: enviada.idMensagem,
            aceitoEm: enviada.em,
          };
        }
        case "tempo-esgotado-saiu":
          registrar();
          return {
            tipo: "incerto",
            motivo:
              "A Evolution não respondeu em 15 s. A mensagem pode ter saído.",
          };
        case "tempo-esgotado-nao-saiu":
          return {
            tipo: "incerto",
            motivo:
              "A Evolution não respondeu em 15 s. A mensagem pode ter saído.",
          };
        case "sem-rede":
          return { tipo: "nao-chegou", motivo: SEM_REDE };
        case "erro-5xx":
          return {
            tipo: "incerto",
            motivo: "A Evolution falhou (502). A mensagem pode ter saído.",
          };
        case "recusa-credencial":
          return { tipo: "recusado", motivo: RECUSA_DE_CREDENCIAL };
      }
    },

    async consultarMensagem({ texto, desde }) {
      const s = simulador();
      if (s.comportamento === "sem-rede")
        return { ok: false, motivo: SEM_REDE };
      const achada = s.enviadas.find(
        (m) => m.texto === texto && m.em.getTime() >= desde.getTime(),
      );
      return {
        ok: true,
        valor: achada
          ? { idMensagem: achada.idMensagem, enviadaEm: achada.em }
          : null,
      };
    },
  };
}
