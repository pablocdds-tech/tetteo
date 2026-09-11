/**
 * O CONTRATO DE UM PROVEDOR DE WHATSAPP.
 *
 * O resto do Tetteo só conhece isto. Hoje há dois que o cumprem: a Evolution
 * 2.3.7 de verdade e o simulado do ensaio. Trocar para a Cloud API da Meta um
 * dia é escrever um terceiro — nenhuma tela, nenhum serviço da Severina muda.
 *
 * Repare no que NÃO existe aqui: desconectar. A 2.3.7 só tira o número do ar
 * por `logout` ou `delete` da instância, e o Tetteo não tem motivo nenhum para
 * fazer isso. Um botão que não existe não é apertado por engano.
 */

export type EstadoDoProvedor = "CONECTADO" | "CONECTANDO" | "DESCONECTADO";

export type ResultadoConsulta =
  /** Falta configurar — pelo NOME das variáveis, nunca o valor. */
  | { tipo: "pendente"; faltando: string[] }
  | { tipo: "ok"; estado: EstadoDoProvedor; numero: string | null }
  /** Motivo já limpo de chave, token e telefone. */
  | { tipo: "erro"; motivo: string };

export type ResultadoEnvio =
  | { tipo: "aceito"; idMensagem: string; aceitoEm: Date }
  /** A conexão nem abriu: repetir é seguro. */
  | { tipo: "nao-chegou"; motivo: string }
  /** Pode ter saído: NÃO repetir sem consultar. */
  | { tipo: "incerto"; motivo: string }
  /** Chegou e foi negado: repetir não resolve. */
  | { tipo: "recusado"; motivo: string };

export type Resultado<T> =
  { ok: true; valor: T } | { ok: false; motivo: string; faltando?: string[] };

export type ConfiguracaoDeEventos = {
  ativo: boolean;
  /** Mascarado: só origem e caminho, sem consulta. */
  url: string | null;
  eventos: string[];
  /** Se há senha de passe configurada. O VALOR nunca sai do conector. */
  comSenha: boolean;
};

export type QrCode =
  /** `imagem` é um data URL. Vive só na memória da página, por 45 s. */
  { tipo: "qr"; imagem: string; expiraEmMs: number } | { tipo: "ja-conectado" };

export type MensagemAchada = { idMensagem: string; enviadaEm: Date | null };

export interface ProvedorWhatsapp {
  readonly nome: "evolution" | "simulado" | "indisponivel";

  consultarConexao(opcoes?: {
    comNumero?: boolean;
  }): Promise<ResultadoConsulta>;

  lerEventos(): Promise<Resultado<ConfiguracaoDeEventos>>;

  configurarEventos(pedido: {
    url: string;
    senha: string;
    eventos: readonly string[];
  }): Promise<Resultado<{ eventos: string[] }>>;

  /** Com o número já conectado, devolve "ja-conectado" — nunca derruba. */
  pedirQrCode(): Promise<Resultado<QrCode>>;

  /** `para` em E.164 sem "+". */
  enviarMensagem(pedido: {
    para: string;
    texto: string;
  }): Promise<ResultadoEnvio>;

  /**
   * Depois de um resultado incerto: a mensagem com ESTE texto saiu, desde
   * aquele instante? `null` = não achou (o que não prova que não saiu).
   */
  consultarMensagem(pedido: {
    texto: string;
    desde: Date;
  }): Promise<Resultado<MensagemAchada | null>>;
}

/**
 * Os eventos que o Tetteo assina na Evolution.
 *
 * Fora, de propósito: `MESSAGES_UPSERT` (o número é pessoal — o Tetteo não
 * precisa ver conversa de ninguém nesta fase) e `QRCODE_UPDATED` (o QR Code
 * nunca viaja por webhook, e portanto nunca para num log).
 */
export const EVENTOS_ASSINADOS = [
  "CONNECTION_UPDATE",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
] as const;

/** Quanto cada QR Code da 2.3.7 dura (`qrTimeout: 45_000` no Baileys). */
export const VALIDADE_DO_QR_MS = 45_000;
