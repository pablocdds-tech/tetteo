"use client";

import { useEffect } from "react";

import { Botao } from "@/design-system/botao";
import { Cartao } from "@/design-system/cartao";
import { Icone } from "@/design-system/icones";

/**
 * QUANDO A TELA FALHA.
 *
 * Fica DENTRO da casca: o menu, o topo e a busca continuam funcionando. Um
 * erro numa consulta do painel não pode prender a pessoa numa página branca
 * sem saída — ela precisa poder ir para outro módulo enquanto isso.
 *
 * "Tentar de novo" é `reset()`, que refaz só o pedaço que quebrou. Não é um
 * recarregar disfarçado: recarregar a página perderia o que estivesse
 * preenchido em qualquer formulário aberto.
 *
 * O texto NÃO mostra a mensagem técnica. "PrismaClientKnownRequestError P2002"
 * não ajuda quem está com o telefone na mão às sete da manhã — e pode revelar
 * nome de tabela e estrutura do banco. O detalhe vai para o console e para o
 * `digest`, que é o que se procura no log do servidor.
 */
export default function ErroNaTela({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Erro na tela do Tetteo:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl py-6">
      <Cartao className="p-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="bg-bad-sub text-bad grid size-10 flex-none place-items-center rounded-xl"
          >
            <Icone nome="alerta" tamanho={20} />
          </span>

          <div className="min-w-0">
            <h1 className="text-[17px] leading-6 font-semibold tracking-tight">
              Esta tela não conseguiu carregar
            </h1>
            <p className="text-ink-2 mt-1.5 text-sm leading-5">
              O sistema continua no ar — o menu ao lado funciona e você pode ir
              para outro módulo. Se tentar de novo e o erro voltar, a consulta
              desta tela está falhando no servidor, e isso precisa ser
              verificado por quem cuida do Tetteo.
            </p>

            {error.digest && (
              <p className="text-ink-3 mt-3 font-mono text-xs leading-[18px]">
                Código para quem for investigar: {error.digest}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Botao onClick={() => reset()}>
                <Icone nome="atualizar" tamanho={15} />
                Tentar de novo
              </Botao>
            </div>
          </div>
        </div>
      </Cartao>
    </div>
  );
}
