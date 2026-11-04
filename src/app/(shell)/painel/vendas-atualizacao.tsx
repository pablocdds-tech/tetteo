"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";

const hora = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function AtualizacaoDasVendas({
  atualizadoEm,
}: {
  atualizadoEm?: string;
}) {
  const router = useRouter();
  const [atualizando, iniciar] = useTransition();

  useEffect(() => {
    const intervalo = window.setInterval(() => {
      if (!document.hidden && !atualizando) iniciar(() => router.refresh());
    }, 30_000);
    return () => window.clearInterval(intervalo);
  }, [router, atualizando]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {atualizadoEm && (
        <p className="text-ink-3 text-xs" role="status">
          {atualizando
            ? "Atualizando operação…"
            : `Consultado às ${hora.format(new Date(atualizadoEm))}`}
        </p>
      )}
      <Botao
        peso="secundario"
        tamanho="pequeno"
        carregando={atualizando}
        className="min-h-11 sm:min-h-9"
        onClick={() => iniciar(() => router.refresh())}
      >
        <Icone nome="atualizar" tamanho={16} />
        Atualizar tela
      </Botao>
    </div>
  );
}
