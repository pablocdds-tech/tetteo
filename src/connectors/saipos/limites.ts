// Teto da FAQ escolhido explicitamente pelo operador; HTTP 429 prevalece.
export const LIMITE_REQUISICOES = 8500;
export const JANELA_REQUISICOES_MS = 60_000;
export const INTERVALO_REQUISICOES_MS = Math.floor(
  JANELA_REQUISICOES_MS / LIMITE_REQUISICOES,
);
// O bloqueio do fornecedor continua independente da janela local de um minuto.
export const ESPERA_MINIMA_429_MS = 5 * 60_000;
export const TAMANHO_PAGINA = 1000;

export class ControleRequisicoesSaipos {
  private inicios: number[] = [];
  private proxima = 0;
  private bloqueadaAte = 0;
  private indisponivelAte = 0;
  indisponivel(agora: number) {
    return agora < this.indisponivelAte;
  }
  suspender(agora: number, retryAfter: string | null) {
    this.indisponivelAte = Math.max(
      this.indisponivelAte,
      agora + esperaRetryAfter(agora, retryAfter),
    );
  }
  bloqueada(agora: number) {
    return agora < this.bloqueadaAte;
  }
  espera(agora: number) {
    this.inicios = this.inicios.filter(
      (inicio) => inicio > agora - JANELA_REQUISICOES_MS,
    );
    return Math.max(
      0,
      this.proxima - agora,
      this.inicios.length >= LIMITE_REQUISICOES
        ? this.inicios[0] + JANELA_REQUISICOES_MS - agora
        : 0,
    );
  }
  registrar(agora: number) {
    this.inicios.push(agora);
    this.proxima = agora + INTERVALO_REQUISICOES_MS;
  }
  bloquear(agora: number, retryAfter: string | null) {
    this.bloqueadaAte = Math.max(
      this.bloqueadaAte,
      agora + esperaRetryAfter(agora, retryAfter),
    );
  }
}

function esperaRetryAfter(agora: number, retryAfter: string | null) {
  const segundos =
    retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
  const data =
    retryAfter && !/^\d+$/.test(retryAfter)
      ? Date.parse(retryAfter) - agora
      : 0;
  const espera = Math.max(
    ESPERA_MINIMA_429_MS,
    Number.isFinite(segundos) ? segundos : 0,
    Number.isFinite(data) ? data : 0,
  );
  return espera;
}
