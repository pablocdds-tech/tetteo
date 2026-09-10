"use client";

import { createContext, useContext } from "react";

/**
 * O PROGRESSO AO VIVO — da folha para a lista, sem passar pelo servidor.
 *
 * A folha grava item a item; a lista à esquerda mostra "3 de 11 itens". Sem
 * um canal entre as duas, a lista ficaria parada no número que veio do
 * servidor enquanto a folha, ao lado, já diz 5.
 *
 * A primeira versão pedia ao roteador para reconsultar a página. Funcionava —
 * até a internet oscilar. No teste com a conexão cortada, a consulta falhou e
 * a tela inteira recarregou, levando junto justamente o aviso de "não
 * gravado" e o botão "Tentar de novo". Na cozinha de verdade, esse é o caso
 * comum, não o raro.
 *
 * Por isso o número agora viaja pelo próprio navegador: a folha avisa, a lista
 * mostra. Nenhum pedido de rede, nada para falhar. Quando a pessoa troca de
 * rotina, a página vem nova do servidor e o número volta a ser o dele.
 *
 * Fora da tela do dia (a página avulsa de um checklist) não há lista, e o
 * aviso simplesmente não vai a lugar nenhum.
 */
export type InformarProgresso = (
  rotinaId: string,
  /** `null` retira o aviso: a folha desta rotina saiu da tela. */
  gravados: number | null,
) => void;

export const ContextoDoProgresso = createContext<InformarProgresso>(() => {});

export function useInformarProgresso() {
  return useContext(ContextoDoProgresso);
}
