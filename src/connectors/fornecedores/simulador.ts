import type { CanalDeFornecedor, ResultadoDoCanal } from "./contrato";

/**
 * O SIMULADOR — o canal de hoje (decisão do Pablo, 10/09/2026).
 *
 * Nada sai da máquina. Ele "aceita" e devolve um id `SIM-…`, e toda tela que
 * mostra uma mensagem simulada diz "Simulado — nada saiu do sistema". Quem
 * manda de verdade é o comprador, copiando o texto para o WhatsApp dele.
 *
 * Nos testes, o ROTEIRO faz o simulador se comportar como um canal real em
 * dia ruim: falhar N vezes, esgotar o tempo DEPOIS de mandar (a pior falha,
 * porque a mensagem saiu e ninguém sabe), ou recusar o número de vez.
 */

export type Roteiro = {
  /** As primeiras N chamadas falham antes de mandar (canal fora do ar). */
  falharVezes?: number;
  /** Na chamada N, a mensagem SAI mas a resposta se perde. */
  incertaNaChamada?: number;
  /** Todo número é recusado de vez (número inválido). */
  recusarDeVez?: boolean;
};

export function criarSimulador(roteiro: Roteiro = {}): CanalDeFornecedor & {
  chamadas: () => number;
  saidas: () => { destino: string; texto: string; chave: string }[];
} {
  let chamadas = 0;
  const saidas: { destino: string; texto: string; chave: string }[] = [];
  const aceitas = new Map<string, string>();

  return {
    nome: "simulador",
    simulado: true,

    async enviar(m): Promise<ResultadoDoCanal> {
      chamadas++;
      if (roteiro.recusarDeVez) {
        return {
          tipo: "recusada-antes",
          erro: "Simulador: número recusado pelo canal.",
          tentarDeNovo: false,
        };
      }
      if (roteiro.falharVezes && chamadas <= roteiro.falharVezes) {
        return {
          tipo: "recusada-antes",
          erro: `Simulador: canal fora do ar (tentativa ${chamadas}).`,
          tentarDeNovo: true,
        };
      }
      const idProvedor = `SIM-${m.chave}`;
      aceitas.set(m.chave, idProvedor);
      saidas.push(m);
      if (roteiro.incertaNaChamada === chamadas) {
        return {
          tipo: "incerta",
          erro: "Simulador: tempo esgotado depois de enviar.",
        };
      }
      return { tipo: "aceita", idProvedor };
    },

    async consultar({ chave }) {
      return aceitas.has(chave) ? "aceita" : "nao-encontrada";
    },

    chamadas: () => chamadas,
    saidas: () => [...saidas],
  };
}
