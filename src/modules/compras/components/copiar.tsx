"use client";

import { useState } from "react";

import { Botao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";

/**
 * COPIAR PARA O WHATSAPP — o envio de hoje (decisão de 10/09/2026).
 *
 * Com o canal simulado, é por aqui que a mensagem sai de verdade: o comprador
 * copia e cola no WhatsApp dele. O link do fornecedor é buscado no servidor
 * só no clique (e a cópia fica registrada) — ele não fica escrito na página.
 */
export function Copiar({
  texto,
  buscar,
  rotulo,
  tamanho = "pequeno",
}: {
  texto?: string;
  /** Busca o texto no servidor no momento do clique (o link). */
  buscar?: () => Promise<{ texto?: string; erro?: string }>;
  rotulo: string;
  tamanho?: "pequeno" | "medio";
}) {
  const [aviso, setAviso] = useState<{
    tipo: "ok" | "erro";
    texto: string;
  } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function copiar() {
    setOcupado(true);
    setAviso(null);
    try {
      let conteudo = texto;
      if (buscar) {
        const r = await buscar();
        if (r.erro || !r.texto) {
          setAviso({ tipo: "erro", texto: r.erro ?? "Não deu para buscar." });
          return;
        }
        conteudo = r.texto;
      }
      await navigator.clipboard.writeText(conteudo ?? "");
      setAviso({
        tipo: "ok",
        texto: "Copiado. Cole no WhatsApp do fornecedor.",
      });
    } catch {
      setAviso({
        tipo: "erro",
        texto:
          "O navegador não deixou copiar. Selecione o texto e copie com Ctrl+C.",
      });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Botao
        type="button"
        peso="secundario"
        tamanho={tamanho}
        onClick={copiar}
        carregando={ocupado}
      >
        <Icone nome="entrada" tamanho={14} />
        {rotulo}
      </Botao>
      {aviso && (
        <span
          role={aviso.tipo === "erro" ? "alert" : "status"}
          className={`text-xs leading-[18px] ${aviso.tipo === "erro" ? "text-bad" : "text-ok"}`}
        >
          {aviso.texto}
        </span>
      )}
    </span>
  );
}
