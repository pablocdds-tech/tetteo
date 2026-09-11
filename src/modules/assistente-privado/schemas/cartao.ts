/**
 * O CARTÃO DO ASSISTENTE PRIVADO — de registros para frases.
 *
 * Puro: recebe os registros e o "agora", devolve o que o cartão escreve. Sem
 * banco, sem React — é o que os testes conferem estado por estado.
 *
 * Duas coisas que o cartão NÃO mostra, de propósito: número de venda (o
 * Painel não tem vendas e não vai fingir que tem) e o que o assistente
 * escreveu (isso mora no relatório, na VPS). O cartão responde só: está
 * ligado? o que fez por último? o que vem agora? o que espera você?
 */

export type Tom = "neutro" | "ok" | "aviso" | "ruim" | "info";

export type LinhaDoCartao = {
  rotulo: string;
  texto: string;
  apoio: string | null;
  tom: Tom;
};

export type RegistroParaCartao = {
  chave: string;
  estado: string;
  demonstracao: boolean;
  periodoDe: string | null;
  periodoAte: string | null;
  fonte: string | null;
  pendencias: string[];
  detalhe: string | null;
  proximaRotina: Date | null;
  rotinaPausada: boolean | null;
  limiteAte: Date | null;
  ocorridoEm: Date;
};

export type DadosDoCartao = {
  conexao: LinhaDoCartao;
  ultimaExecucao: LinhaDoCartao;
  proximaRotina: LinhaDoCartao;
  pendencias: string[];
  demonstracao: boolean;
};

/** Sem verificação há mais que isto, o cartão não afirma que está ligado. */
export const SEM_NOTICIA_MS = 6 * 60 * 60_000;
/** "Calculado" parado há mais que isto: o texto não veio. */
export const INTERROMPIDO_MS = 15 * 60_000;
/** Rascunho mais velho que isto sai das pendências. */
export const RASCUNHO_PENDENTE_MS = 7 * 24 * 60 * 60_000;

export const COMANDO_DE_LOGIN =
  "docker exec -it central-openclaw node dist/index.js models auth login --provider openai --device-code";

const FUSO = "America/Sao_Paulo";
const diaHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const soHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
});

/** "10/09 18:00" */
export function quando(d: Date) {
  return diaHora.format(d).replace(",", "");
}

/** "agora há pouco", "há 12 min", "há 3 h", "em 09/09 18:00" */
export function haQuanto(d: Date, agora: Date) {
  const minutos = Math.floor((agora.getTime() - d.getTime()) / 60_000);
  if (minutos < 2) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 24 * 60) return `há ${Math.floor(minutos / 60)} h`;
  return `em ${quando(d)}`;
}

function diaCurto(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

function linhaDeConexao(
  v: RegistroParaCartao | null,
  agora: Date,
): LinhaDoCartao {
  const rotulo = "Conexão";
  if (!v) {
    return {
      rotulo,
      texto: "Nunca verificado",
      apoio:
        "A verificação roda na VPS — veja docs/assistente-privado/operacao.md.",
      tom: "neutro",
    };
  }
  if (agora.getTime() - v.ocorridoEm.getTime() > SEM_NOTICIA_MS) {
    return {
      rotulo,
      texto: `Sem notícia desde ${quando(v.ocorridoEm)}`,
      apoio: "O assistente pode estar desligado. Rode a verificação na VPS.",
      tom: "aviso",
    };
  }
  switch (v.estado) {
    case "conectado":
      return {
        rotulo,
        texto: "Conectado",
        apoio: `verificado ${haQuanto(v.ocorridoEm, agora)}`,
        tom: "ok",
      };
    case "login_expirado":
      return {
        rotulo,
        texto: "Login expirado — refazer",
        apoio: COMANDO_DE_LOGIN,
        tom: "ruim",
      };
    case "limite":
      return {
        rotulo,
        texto: v.limiteAte
          ? `Limite da assinatura até ${soHora.format(v.limiteAte)}`
          : "Limite da assinatura atingido",
        apoio: "O assistente espera liberar. Nada muda para plano pago.",
        tom: "aviso",
      };
    case "modelo_indisponivel":
      return {
        rotulo,
        texto: "Modelo indisponível",
        apoio: v.detalhe,
        tom: "ruim",
      };
    case "desligado":
      return {
        rotulo,
        texto: "Assistente desligado",
        apoio: v.detalhe,
        tom: "ruim",
      };
    default:
      return { rotulo, texto: v.estado, apoio: null, tom: "neutro" };
  }
}

const ESTADOS: Record<string, { texto: string; tom: Tom }> = {
  concluido: { texto: "Concluído", tom: "ok" },
  preparado: { texto: "Preparado — esperando você", tom: "info" },
  sem_dados: { texto: "Sem dados no período", tom: "aviso" },
  arquivo_invalido: { texto: "Arquivo inválido", tom: "ruim" },
  acesso_negado: { texto: "Acesso negado", tom: "ruim" },
  cancelado: { texto: "Cancelado", tom: "neutro" },
};

function linhaDeExecucao(
  e: RegistroParaCartao | null,
  agora: Date,
): LinhaDoCartao {
  const rotulo = "Última execução";
  if (!e) {
    return {
      rotulo,
      texto: "Nenhuma execução ainda",
      apoio: "Peça um fechamento no painel do OpenClaw.",
      tom: "neutro",
    };
  }
  // A etiqueta não quebra linha: o texto dela é curto, o resto vai no apoio.
  const interrompido =
    e.estado === "calculado" &&
    agora.getTime() - e.ocorridoEm.getTime() > INTERROMPIDO_MS;
  const estado =
    e.estado === "calculado"
      ? interrompido
        ? { texto: "Interrompido", tom: "aviso" as const }
        : { texto: "Em andamento", tom: "info" as const }
      : (ESTADOS[e.estado] ?? { texto: e.estado, tom: "neutro" as const });

  const onde = [
    e.periodoDe && e.periodoAte
      ? `${diaCurto(e.periodoDe)} a ${diaCurto(e.periodoAte)}`
      : null,
    e.fonte,
    haQuanto(e.ocorridoEm, agora),
  ]
    .filter(Boolean)
    .join(" · ");
  const motivo = ["arquivo_invalido", "acesso_negado"].includes(e.estado)
    ? e.detalhe
    : interrompido
      ? "números salvos, texto não concluído"
      : null;
  return {
    rotulo,
    texto: estado.texto,
    apoio: motivo ? `${onde} — ${motivo}` : onde,
    tom: estado.tom,
  };
}

function linhaDeRotina(v: RegistroParaCartao | null): LinhaDoCartao {
  const rotulo = "Próxima rotina";
  if (v?.proximaRotina && v.rotinaPausada) {
    return {
      rotulo,
      texto: "Pausada",
      apoio: `seria ${quando(v.proximaRotina)}`,
      tom: "aviso",
    };
  }
  if (v?.proximaRotina)
    return { rotulo, texto: quando(v.proximaRotina), apoio: null, tom: "info" };
  return {
    rotulo,
    texto: "Nenhuma — só execução manual",
    apoio: null,
    tom: "neutro",
  };
}

export function montarCartao({
  verificacao,
  execucoes,
  agora,
}: {
  verificacao: RegistroParaCartao | null;
  /** Do mais recente para o mais antigo. */
  execucoes: RegistroParaCartao[];
  agora: Date;
}): DadosDoCartao {
  const ehRascunho = (r: RegistroParaCartao) => r.chave.startsWith("rascunho:");
  const ultima = execucoes.find((r) => !ehRascunho(r)) ?? null;
  const rascunhos = execucoes.filter(
    (r) =>
      ehRascunho(r) &&
      r.estado === "preparado" &&
      agora.getTime() - r.ocorridoEm.getTime() <= RASCUNHO_PENDENTE_MS,
  );

  const pendencias = new Set<string>();
  if (verificacao?.estado === "login_expirado")
    pendencias.add("Refazer o login do ChatGPT na VPS");
  for (const p of verificacao?.pendencias ?? []) pendencias.add(p);
  for (const p of ultima?.pendencias ?? []) pendencias.add(p);
  for (const r of rascunhos) for (const p of r.pendencias) pendencias.add(p);

  return {
    conexao: linhaDeConexao(verificacao, agora),
    ultimaExecucao: linhaDeExecucao(ultima, agora),
    proximaRotina: linhaDeRotina(verificacao),
    pendencias: [...pendencias].slice(0, 5),
    demonstracao: [verificacao, ultima, ...rascunhos].some(
      (r) => r?.demonstracao,
    ),
  };
}
