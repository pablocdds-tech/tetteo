"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/design-system/botao";

export function AtualizarRecebimentoCw({ lidoEm }: { lidoEm: string }) {
  const router = useRouter();
  const [atualizando, iniciar] = useTransition();
  const atualizar = useCallback(
    (manual = false) => {
      if (atualizando || document.visibilityState !== "visible") return;
      const painel = document.getElementById("recebimento-cardapioweb");
      // Não interrompe o preenchimento ou envio de credenciais.
      if (
        !manual &&
        (painel?.querySelector("details[data-credenciais][open]") ||
          (document.activeElement?.closest("form") &&
            painel?.contains(document.activeElement)))
      )
        return;
      iniciar(() => router.refresh());
    },
    [atualizando, router],
  );

  useEffect(() => {
    const aoVoltar = () => atualizar();
    const intervalo = window.setInterval(aoVoltar, 15_000);
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [atualizar]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-ink-3 text-xs">
        <p>
          Tela consultada em{" "}
          <time dateTime={lidoEm}>
            {new Intl.DateTimeFormat("pt-BR", {
              dateStyle: "short",
              timeStyle: "medium",
              timeZone: "America/Sao_Paulo",
            }).format(new Date(lidoEm))}
          </time>
        </p>
        <p>Atualiza a cada 15 segundos. Pausa ao configurar credenciais.</p>
      </div>
      <Botao
        type="button"
        peso="secundario"
        tamanho="pequeno"
        carregando={atualizando}
        onClick={() => atualizar(true)}
      >
        Atualizar pedidos
      </Botao>
    </div>
  );
}
