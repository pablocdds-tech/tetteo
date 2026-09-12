"use client";

import { useFormStatus } from "react-dom";

import { Botao } from "@/design-system/botao";

import { revogarConexaoAcao } from "./acoes";

/**
 * Revogar corta o acesso na chamada seguinte, e não tem desfazer: para voltar,
 * a pessoa conecta de novo pelo Claude, com a senha dela. Por isso pergunta
 * antes — com a pergunta do navegador, que já prende o foco, responde ao Esc e
 * é lida pelo leitor de tela.
 */
export function BotaoRevogar({ id, pessoa }: { id: string; pessoa: string }) {
  return (
    <form
      action={revogarConexaoAcao}
      onSubmit={(evento) => {
        if (
          !window.confirm(
            `Revogar a conexão de ${pessoa}? A IA para de consultar na próxima pergunta. Para voltar, é preciso conectar de novo pelo Claude.`,
          )
        ) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Envio />
    </form>
  );
}

function Envio() {
  const { pending } = useFormStatus();
  return (
    <Botao
      type="submit"
      peso="destrutivo"
      tamanho="pequeno"
      carregando={pending}
    >
      Revogar
    </Botao>
  );
}
