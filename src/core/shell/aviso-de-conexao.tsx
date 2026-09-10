"use client";

import { useSyncExternalStore } from "react";

import { Icone } from "@/design-system/icones";

/**
 * O AVISO DE CONEXÃO PERDIDA.
 *
 * Numa pizzaria a internet cai — e cai justamente no sábado à noite, com a
 * casa cheia. O perigo não é a tela travar: é ela continuar mostrando os
 * números de dez minutos atrás como se fossem de agora, e alguém decidir uma
 * compra em cima disso.
 *
 * Este aviso diz duas coisas, e nenhuma a mais do que é verdade: o que está na
 * tela pode estar velho, e o que for enviado agora provavelmente não vai
 * chegar. Ele NÃO promete guardar nada para enviar depois — o Tetteo não faz
 * isso hoje, e prometer sincronização que não existe é a forma mais fácil de
 * perder um lançamento sem ninguém perceber.
 *
 * `navigator.onLine` só garante o negativo: quando diz `false`, não há rede.
 * Quando diz `true`, pode haver rede sem internet. Por isso o aviso aparece
 * com o evento `offline` e some com o `online` — e nunca afirma que está tudo
 * certo.
 */

/** O navegador é a fonte da verdade; o React só assina as mudanças dele. */
function inscrever(aoMudar: () => void) {
  window.addEventListener("online", aoMudar);
  window.addEventListener("offline", aoMudar);
  return () => {
    window.removeEventListener("online", aoMudar);
    window.removeEventListener("offline", aoMudar);
  };
}

function lerNoNavegador() {
  return navigator.onLine;
}

/**
 * No servidor não existe `navigator`, e o HTML precisa sair com ALGUM valor.
 * Sai como conectado — sem o aviso. O contrário faria a página piscar um alerta
 * de "sem conexão" no primeiro instante de todo carregamento bem-sucedido.
 */
function lerNoServidor() {
  return true;
}

export function AvisoDeConexao() {
  const online = useSyncExternalStore(inscrever, lerNoNavegador, lerNoServidor);

  if (online) return null;

  return (
    <div
      role="status"
      className="bg-warn-sub text-warn border-warn/25 desk:px-7 flex items-center gap-2 border-b px-4 py-2 text-sm leading-5"
    >
      <Icone nome="sem-sinal" tamanho={16} />
      <p>
        <strong className="font-semibold">Sem conexão.</strong> Os números na
        tela são os do último carregamento e podem estar desatualizados. O que
        você enviar agora não será salvo.
      </p>
    </div>
  );
}
