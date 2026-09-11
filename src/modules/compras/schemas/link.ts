/**
 * A VALIDADE DO LINK DO FORNECEDOR — regra pura.
 *
 * O link é a única porta do sistema aberta sem login, e por isso cada envio
 * passa por todas as travas, nesta ordem:
 *
 *   revogado    alguém com permissão desligou o link (vazou, errou o número)
 *   bloqueado   envios inválidos demais seguidos — o link se desliga sozinho
 *   vencido     passou do prazo da cotação
 *   encerrado   a rodada saiu de "em cotação": nova proposta só reabrindo, ou
 *               por negociação registrada pelo comprador
 *   limite      versões demais — ninguém responde 30 vezes de boa-fé
 *   aguarde     envio há menos de 10 segundos — duplo clique, ou robô
 *
 * Ver a página e enviar são coisas diferentes: "limite" e "aguarde" deixam
 * VER (o fornecedor confere o que mandou); só "valido" deixa ENVIAR.
 */

export const LIMITES_DO_LINK = {
  intervaloMs: 10_000,
  maxVersoes: 30,
  maxInvalidas: 10,
} as const;

export type SituacaoDoLink =
  | "valido"
  | "revogado"
  | "bloqueado"
  | "vencido"
  | "encerrado"
  | "limite"
  | "aguarde";

export function situacaoDoLink(
  s: {
    expiraEm: Date | null;
    revogadoEm: Date | null;
    tentativasInvalidas: number;
    versoes: number;
    ultimoEnvioEm: Date | null;
    rodadaEmCotacao: boolean;
  },
  agora: Date,
): SituacaoDoLink {
  if (s.revogadoEm) return "revogado";
  if (s.tentativasInvalidas >= LIMITES_DO_LINK.maxInvalidas) return "bloqueado";
  if (!s.expiraEm || s.expiraEm <= agora) return "vencido";
  if (!s.rodadaEmCotacao) return "encerrado";
  if (s.versoes >= LIMITES_DO_LINK.maxVersoes) return "limite";
  if (
    s.ultimoEnvioEm &&
    agora.getTime() - s.ultimoEnvioEm.getTime() < LIMITES_DO_LINK.intervaloMs
  ) {
    return "aguarde";
  }
  return "valido";
}

export function podeVer(situacao: SituacaoDoLink): boolean {
  return (
    situacao === "valido" || situacao === "limite" || situacao === "aguarde"
  );
}

/** O que o FORNECEDOR lê. Nada aqui revela dado interno. */
export const MENSAGEM_DO_LINK: Record<SituacaoDoLink, string> = {
  valido: "",
  revogado:
    "Este link foi desativado por quem pediu a cotação. Peça um novo a quem enviou.",
  bloqueado:
    "Este link foi bloqueado depois de várias tentativas com erro. Peça um novo a quem enviou.",
  vencido:
    "O prazo desta cotação terminou. Se ainda quiser propor, fale com quem enviou.",
  encerrado:
    "Esta cotação já foi encerrada. Se o preço mudou, fale com quem enviou — a mudança fica registrada.",
  limite:
    "Esta proposta já recebeu o número máximo de versões pelo link. Fale com quem enviou.",
  aguarde:
    "Recebemos um envio agora há pouco. Aguarde alguns segundos antes de enviar de novo.",
};
