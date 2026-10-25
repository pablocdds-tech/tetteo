// Menor teto oficial enquanto a divergência documental não for esclarecida.
export const LIMITE_REQUISICOES = 500;
export const JANELA_REQUISICOES_MS = 5 * 60_000;
export const INTERVALO_REQUISICOES_MS =
  JANELA_REQUISICOES_MS / LIMITE_REQUISICOES;
export const TAMANHO_PAGINA = 1000;

export class ControleRequisicoesSaipos {
  private inicios: number[] = [];
  private proxima = 0;
  private bloqueadaAte = 0;
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
    const segundos =
      retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
    const data =
      retryAfter && !/^\d+$/.test(retryAfter)
        ? Date.parse(retryAfter) - agora
        : 0;
    const espera = Math.max(
      JANELA_REQUISICOES_MS,
      Number.isFinite(segundos) ? segundos : 0,
      Number.isFinite(data) ? data : 0,
    );
    this.bloqueadaAte = Math.max(this.bloqueadaAte, agora + espera);
  }
}
