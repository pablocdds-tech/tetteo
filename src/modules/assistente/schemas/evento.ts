import type { StatusDoProvedorNoAviso } from "./aviso";

/**
 * UM EVENTO DO PROVEDOR, no vocabulário da Severina.
 *
 * Quem traduz a Evolution para isto é o conector; quem entrega aqui é a
 * camada `app/`. A Severina nunca vê o corpo cru do webhook — e por isso não
 * tem como guardá-lo.
 */
export type EventoNormalizado =
  | {
      tipo: "connection.update";
      idExterno: string;
      estado: "open" | "connecting" | "close" | "refused";
      codigo: number | null;
      /** O número do próprio aparelho. Vai para `numeroProprio`, não para o resumo. */
      numero: string | null;
    }
  | {
      tipo: "messages.update";
      idExterno: string;
      idMensagem: string;
      status: StatusDoProvedorNoAviso;
      deMim: boolean;
    }
  | {
      tipo: "send.message";
      idExterno: string;
      idMensagem: string;
      hashTexto: string | null;
      enviadaEm: Date | null;
    }
  | {
      tipo: "messages.upsert";
      idExterno: string;
      idMensagem: string;
      deMim: boolean;
      grupo: boolean;
      /** Quem escreveu, se for alguém vinculado. O identificador de contato não chega aqui. */
      vinculoId: string | null;
    };

export type TipoDeEvento = EventoNormalizado["tipo"];

export type ResumoDoEvento = Record<string, string | number | boolean | null>;

/**
 * O QUE VAI PARA O BANCO — e para o painel que o gerente abre.
 *
 * Uma lista do que PODE ser guardado, e não do que não pode: campo novo que
 * aparecer no evento fica de fora até alguém decidir que ele entra.
 */
export function resumoDoEvento(evento: EventoNormalizado): ResumoDoEvento {
  switch (evento.tipo) {
    case "connection.update":
      return {
        estado: evento.estado,
        codigo: evento.codigo,
        numeroFinal: evento.numero ? evento.numero.slice(-4) : null,
      };
    case "messages.update":
      return {
        idMensagem: evento.idMensagem,
        status: evento.status,
        deMim: evento.deMim,
      };
    case "send.message":
      return {
        idMensagem: evento.idMensagem,
        hashTexto: evento.hashTexto,
        enviadaEm: evento.enviadaEm ? evento.enviadaEm.toISOString() : null,
      };
    case "messages.upsert":
      return {
        idMensagem: evento.idMensagem,
        deMim: evento.deMim,
        grupo: evento.grupo,
        remetente: evento.vinculoId ? "vinculado" : "não autorizado",
      };
  }
}

export const ROTULO_DO_TIPO: Record<TipoDeEvento, string> = {
  "connection.update": "Conexão",
  "messages.update": "Status de mensagem",
  "send.message": "Mensagem enviada",
  "messages.upsert": "Mensagem recebida",
};

/** Por que um evento foi ignorado — a frase que a tela mostra. */
export const MOTIVOS_DE_EVENTO = {
  proprio:
    "Mensagem do próprio número. Nunca dispara nada — é o que impede ciclo de respostas.",
  grupo: "Conversa de grupo. O Tetteo não age em grupo.",
  naoAutorizado: "Remetente não autorizado. Nada da mensagem foi guardado.",
  respostas: "Respostas ainda não são lidas pelo Tetteo nesta fase.",
  naoEAviso: "Não é de um aviso do Tetteo.",
  foraDoTetteo: "Mensagem enviada fora do Tetteo.",
  jaAvancado: "O aviso já estava numa etapa mais adiante.",
  conexaoDesconhecida: "Conexão removida do cadastro.",
} as const;
