import { z } from "zod";

/**
 * O CAMINHO DE UM AVISO — as regras, sem banco.
 *
 * Um aviso só anda para a frente, e cada passo precisa de um motivo: uma
 * pessoa confirmou, o provedor respondeu, o WhatsApp avisou que entregou. O
 * que está aqui é a lista do que PODE acontecer; o serviço confere antes de
 * gravar, e o teste confere o que não pode.
 *
 *   RASCUNHO ─► CONFIRMADO ─► NA_FILA ─► ACEITO ─► ENTREGUE ─► LIDO
 *       │            │           │  │        └──────────────┐
 *       └► DESCARTADO│           │  └► INCERTO ─► (achou) ACEITO
 *                    │           │        └► (pessoa) CONFIRMADO | DESCARTADO
 *                    └► FALHOU ◄─┘
 */

export type StatusAviso =
  | "RASCUNHO"
  | "CONFIRMADO"
  | "NA_FILA"
  | "ACEITO"
  | "ENTREGUE"
  | "LIDO"
  | "INCERTO"
  | "FALHOU"
  | "DESCARTADO";

/** O status que a 2.3.7 manda no `messages.update`. */
export type StatusDoProvedorNoAviso =
  | "ERROR"
  | "PENDING"
  | "SERVER_ACK"
  | "DELIVERY_ACK"
  | "READ"
  | "PLAYED"
  | "DELETED";

const TRANSICOES: Record<StatusAviso, readonly StatusAviso[]> = {
  // Pular a confirmação seria o envio automático que o dono proibiu.
  RASCUNHO: ["CONFIRMADO", "DESCARTADO"],
  // FALHOU aqui: o destinatário perdeu a autorização antes de sair.
  CONFIRMADO: ["NA_FILA", "FALHOU", "DESCARTADO"],
  // CONFIRMADO aqui: o pedido NÃO chegou à Evolution, e volta a esperar.
  NA_FILA: ["ACEITO", "INCERTO", "FALHOU", "CONFIRMADO"],
  ACEITO: ["ENTREGUE", "LIDO", "FALHOU"],
  ENTREGUE: ["LIDO"],
  LIDO: [],
  // Sai por prova (achou no provedor) ou por decisão de uma pessoa — nunca
  // de volta para a fila sozinho.
  INCERTO: ["ACEITO", "CONFIRMADO", "DESCARTADO"],
  // Tentar de novo é decisão humana, depois de corrigir o que falhou.
  FALHOU: ["CONFIRMADO", "DESCARTADO"],
  DESCARTADO: [],
};

export function podeTransitar(de: StatusAviso, para: StatusAviso): boolean {
  return TRANSICOES[de].includes(para);
}

/**
 * O que o `messages.update` faz com o aviso — e `null` quando não faz nada.
 *
 * Só avisos ACEITOS têm o id da mensagem, e só por ele o status chega até
 * aqui. O "entregue" que chega atrasado depois do "lido" não desfaz a
 * leitura: os webhooks não chegam em ordem.
 */
export function estadoPeloStatusDoProvedor(
  atual: StatusAviso,
  status: StatusDoProvedorNoAviso,
): StatusAviso | null {
  switch (status) {
    case "DELIVERY_ACK":
      return atual === "ACEITO" ? "ENTREGUE" : null;
    case "READ":
    case "PLAYED":
      return atual === "ACEITO" || atual === "ENTREGUE" ? "LIDO" : null;
    case "ERROR":
      return atual === "ACEITO" ? "FALHOU" : null;
    default:
      // PENDING e SERVER_ACK: o aceite já veio da resposta 201.
      // DELETED: alguém apagou no celular — não muda o que aconteceu.
      return null;
  }
}

/**
 * O texto que sai no WhatsApp.
 *
 * O asterisco é negrito no WhatsApp; um asterisco dentro do título quebraria
 * o negrito ao meio. A referência no fim torna o texto ÚNICO — é por ela que
 * se acha a mensagem no provedor depois de um tempo esgotado.
 */
export function montarCorpo({
  titulo,
  linhas,
  link,
  referencia,
}: {
  titulo: string;
  linhas: string[];
  link: string | null;
  referencia: string;
}): string {
  const tituloLimpo = titulo.replace(/\*/g, "").trim();
  const corpo = linhas.map((linha) => linha.trim()).filter(Boolean);
  return [
    `*${tituloLimpo}*`,
    ...corpo,
    "",
    ...(link ? [`Revise: ${link}`] : []),
    `Ref. ${referencia}`,
  ].join("\n");
}

/** Sem 0/O e 1/I: alguém vai ditar isto por telefone um dia. */
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function aleatorioSeguro(): number {
  const [valor] = crypto.getRandomValues(new Uint32Array(1));
  return valor / 2 ** 32;
}

export function gerarReferencia(
  aleatorio: () => number = aleatorioSeguro,
): string {
  let codigo = "";
  for (let i = 0; i < 6; i++) {
    codigo +=
      ALFABETO[Math.floor(aleatorio() * ALFABETO.length) % ALFABETO.length];
  }
  return `AV-${codigo}`;
}

/**
 * Tentativas automáticas só quando o pedido NÃO chegou à Evolution. Três, e
 * então FALHOU: fila que tenta para sempre é fila que esconde o problema.
 */
export const MAX_TENTATIVAS_SEM_CHEGAR = 3;

/** Espera antes da próxima: 1, 4, 9 minutos. */
export function esperaAntesDaTentativa(tentativas: number): number {
  return tentativas * tentativas * 60_000;
}

/** Consultas ao provedor por um aviso INCERTO antes de esperar uma pessoa. */
export const MAX_VERIFICACOES = 5;
/** A primeira consulta espera a Evolution gravar o que talvez tenha saído. */
export const VERIFICAR_APOS_MS = 20_000;
export const INTERVALO_ENTRE_VERIFICACOES_MS = 60_000;

/**
 * Aviso em NA_FILA há mais que isso: o processo morreu no meio do envio. O
 * resultado é desconhecido — mesmo caso do tempo esgotado.
 */
export const INTERROMPIDO_APOS_MS = 120_000;

/** Os filtros da tela. Todo status está em exatamente um. */
export const GRUPOS_DE_AVISO = {
  revisar: ["RASCUNHO"],
  andamento: ["CONFIRMADO", "NA_FILA", "ACEITO", "ENTREGUE"],
  pendencias: ["INCERTO", "FALHOU"],
  concluidos: ["LIDO", "DESCARTADO"],
} as const satisfies Record<string, readonly StatusAviso[]>;

export type GrupoDeAviso = keyof typeof GRUPOS_DE_AVISO;

/** O rascunho que uma pessoa escreve à mão. */
export const esquemaRascunho = z.object({
  titulo: z
    .string()
    .trim()
    .min(3, "Dê um título curto — é a primeira linha, em negrito")
    .max(80, "Título longo demais: é uma linha no celular"),
  texto: z
    .string()
    .trim()
    .min(1, "Escreva o que o aviso diz")
    .max(
      1200,
      "Texto longo demais para um aviso. Resuma — o detalhe mora no Tetteo",
    ),
});

export type DadosRascunho = z.infer<typeof esquemaRascunho>;
