"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/design-system/botao";
export function AtualizacaoAutomatica() {
  const router = useRouter();
  const [ativo, setAtivo] = useState(true);
  const [online, setOnline] = useState(true);
  const [pendente, iniciar] = useTransition();
  useEffect(() => {
    const atualizarRede = () => setOnline(navigator.onLine);
    atualizarRede();
    window.addEventListener("online", atualizarRede);
    window.addEventListener("offline", atualizarRede);
    const timer = window.setInterval(() => {
      if (
        ativo &&
        navigator.onLine &&
        document.visibilityState === "visible" &&
        !pendente &&
        !document.querySelector(
          "input:focus, select:focus, textarea:focus, [data-edicao-pendente='true']",
        )
      )
        iniciar(() => router.refresh());
    }, 60000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", atualizarRede);
      window.removeEventListener("offline", atualizarRede);
    };
  }, [ativo, pendente, router]);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Botao
        peso="secundario"
        onClick={() => setAtivo(!ativo)}
        aria-pressed={ativo}
      >
        {ativo ? "Pausar atualização da tela" : "Retomar atualização da tela"}
      </Botao>
      <span role="status" className="text-ink-3">
        {!online
          ? "Sem conexão. Os dados exibidos podem estar antigos."
          : pendente
            ? "Atualizando painel…"
            : ativo
              ? "Tela atualizada automaticamente a cada minuto"
              : "Atualização da tela pausada"}
      </span>
    </div>
  );
}
