/**
 * O ESTADO DO NÚMERO — as regras, sem banco.
 *
 * WhatsApp por QR Code cai sem avisar: a Evolution 2.3.7 reconecta calada
 * quando consegue, e quando não consegue, fica "conectando" para sempre. As
 * regras abaixo são o que transforma esse silêncio num "Atenção" na tela,
 * antes de alguém reclamar que o aviso não chegou.
 *
 * "Configuração pendente" não é um estado gravado: é calculada na leitura, a
 * partir das variáveis que faltam no servidor.
 */

export type EstadoConexao =
  "DESCONECTADO" | "CONECTANDO" | "CONECTADO" | "ATENCAO";

export type ConsultaDoProvedor =
  | { tipo: "ok"; estado: "CONECTADO" | "CONECTANDO" | "DESCONECTADO" }
  | { tipo: "erro"; motivo: string };

export type EstadoGravado = {
  estado: EstadoConexao;
  estadoDesde: Date | null;
  motivoAtencao: string | null;
};

export const CONECTANDO_DEMAIS_MS = 5 * 60_000;
export const SEM_NOTICIA_MS = 15 * 60_000;

export const MOTIVO_CONECTANDO_DEMAIS =
  "Conectando há mais de 5 minutos. Confira se o celular do número está ligado e com internet.";
export const MOTIVO_LIMITE_DE_QR =
  "O limite de QR Codes foi atingido e a Evolution desistiu. Peça um novo QR em Reconectar.";

/**
 * O que gravar depois de uma consulta (ou de um evento de conexão).
 *
 * `estadoDesde` só zera quando o estado MUDA de verdade. "Conectando" que
 * vira "Atenção" por demora continua contando do começo — senão a tela diria
 * "há 1 minuto" de uma queda de uma hora.
 */
export function estadoPelaConsulta(
  consulta: ConsultaDoProvedor,
  anterior: EstadoGravado,
  agora: Date,
): EstadoGravado {
  if (consulta.tipo === "erro") {
    return {
      estado: "ATENCAO",
      estadoDesde:
        anterior.estado === "ATENCAO" && anterior.estadoDesde
          ? anterior.estadoDesde
          : agora,
      motivoAtencao: consulta.motivo,
    };
  }

  if (consulta.estado === "CONECTANDO") {
    const vinhaConectando =
      anterior.estado === "CONECTANDO" ||
      (anterior.estado === "ATENCAO" &&
        anterior.motivoAtencao === MOTIVO_CONECTANDO_DEMAIS);
    const desde =
      vinhaConectando && anterior.estadoDesde ? anterior.estadoDesde : agora;

    if (agora.getTime() - desde.getTime() > CONECTANDO_DEMAIS_MS) {
      return {
        estado: "ATENCAO",
        estadoDesde: desde,
        motivoAtencao: MOTIVO_CONECTANDO_DEMAIS,
      };
    }
    return { estado: "CONECTANDO", estadoDesde: desde, motivoAtencao: null };
  }

  return {
    estado: consulta.estado,
    estadoDesde:
      anterior.estado === consulta.estado && anterior.estadoDesde
        ? anterior.estadoDesde
        : agora,
    motivoAtencao: null,
  };
}

/** O `connection.update` da 2.3.7 vira a mesma consulta. */
export function consultaDoEventoDeConexao(
  state: "open" | "connecting" | "close" | "refused",
): ConsultaDoProvedor {
  switch (state) {
    case "open":
      return { tipo: "ok", estado: "CONECTADO" };
    case "connecting":
      return { tipo: "ok", estado: "CONECTANDO" };
    case "close":
      return { tipo: "ok", estado: "DESCONECTADO" };
    case "refused":
      return { tipo: "erro", motivo: MOTIVO_LIMITE_DE_QR };
  }
}

export type EstadoNaTela = EstadoConexao | "PENDENTE";

/**
 * O que a tela mostra — o gravado, corrigido pelo que só se sabe agora.
 *
 * "Conectado" sem notícia há quinze minutos não é conectado: é um número que
 * talvez tenha caído sem avisar. O relógio consulta a cada minuto; silêncio
 * tão longo quer dizer que nem o relógio nem a Evolution estão falando.
 */
export function estadoParaExibir(
  gravado: {
    estado: EstadoConexao;
    vistoEm: Date | null;
    motivoAtencao: string | null;
  },
  faltando: string[],
  agora: Date,
): { estado: EstadoNaTela; motivo: string | null } {
  if (faltando.length > 0) {
    return {
      estado: "PENDENTE",
      motivo: `Falta configurar no servidor: ${faltando.join(", ")}.`,
    };
  }

  if (gravado.estado === "CONECTADO") {
    const semNoticia =
      !gravado.vistoEm ||
      agora.getTime() - gravado.vistoEm.getTime() > SEM_NOTICIA_MS;
    if (semNoticia) {
      return {
        estado: "ATENCAO",
        motivo: "Sem notícia do provedor há mais de 15 minutos.",
      };
    }
  }

  if (gravado.estado === "ATENCAO") {
    return { estado: "ATENCAO", motivo: gravado.motivoAtencao };
  }
  return { estado: gravado.estado, motivo: null };
}

export const ROTULO_DO_ESTADO: Record<EstadoNaTela, string> = {
  CONECTADO: "Conectado",
  CONECTANDO: "Conectando",
  DESCONECTADO: "Desconectado",
  ATENCAO: "Atenção",
  PENDENTE: "Configuração pendente",
};
