"use client";

import { useId, useRef, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";

export function ArquivoConferencia({
  arquivo,
  onChange,
  disabled,
}: {
  arquivo: File | null;
  onChange: (arquivo: File | null) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState("");
  function escolher(arquivos: FileList | null) {
    if (disabled) return;
    const selecionado = arquivos?.[0];
    if (!selecionado) return;
    if (arquivos!.length !== 1) {
      setErro("Envie um arquivo por vez para conferir cada leitura.");
      return;
    }
    if (
      !/\.(csv|json)$/i.test(selecionado.name) ||
      selecionado.size === 0 ||
      selecionado.size > 2 * 1024 * 1024
    ) {
      setErro("Escolha um arquivo CSV ou JSON com conteúdo, de até 2 MB.");
      return;
    }
    setErro("");
    onChange(selecionado);
  }
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <div
        className={`flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition-colors ${arrastando ? "border-accent bg-accent-sub" : "border-line-2 bg-surface"}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setArrastando(true);
        }}
        onDragLeave={(e) => {
          if (
            !(e.relatedTarget instanceof Node) ||
            !e.currentTarget.contains(e.relatedTarget)
          )
            setArrastando(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          escolher(e.dataTransfer.files);
        }}
      >
        <Icone
          nome={arquivo ? "lista-conferida" : "entrada"}
          tamanho={36}
          className="text-ink-3 mb-4"
        />
        <p
          className="max-w-full text-lg font-bold break-all"
          aria-live="polite"
        >
          {arquivo?.name ?? "Arraste seu arquivo aqui"}
        </p>
        <p className="text-ink-3 mt-1 text-sm" id={id}>
          {arquivo
            ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(arquivo.size / 1024)} KB · pronto para analisar`
            : "ou escolha no computador · CSV ou JSON, até 2 MB"}
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Arquivo original"
          aria-describedby={id}
          disabled={disabled}
          onChange={(e) => escolher(e.target.files)}
        />
        <Botao
          type="button"
          peso="secundario"
          className="mt-4 rounded-full"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
        </Botao>
      </div>
      {erro && (
        <p role="alert" className="text-bad mt-2 text-sm">
          {erro}
        </p>
      )}
    </div>
  );
}
