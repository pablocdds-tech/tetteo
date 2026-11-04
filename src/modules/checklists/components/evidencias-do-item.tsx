"use client";

import Image from "next/image";
import { useId, useState } from "react";

export type EvidenciaDaFolha = {
  id: string;
  tipo: string;
  nome: string;
  url: string;
};

export function EvidenciasDoItem({
  id,
  evidencias,
  exigeFoto = false,
  exigeVideo = false,
  podeEnviar = false,
  aoAnexar,
  aoRemover,
}: {
  id: string;
  evidencias: EvidenciaDaFolha[];
  exigeFoto?: boolean;
  exigeVideo?: boolean;
  podeEnviar?: boolean;
  aoAnexar?: (arquivo: File) => Promise<unknown>;
  aoRemover?: (id: string) => Promise<unknown>;
}) {
  const inputId = useId();
  const [erro, setErro] = useState("");
  if (!podeEnviar && evidencias.length === 0 && !exigeFoto && !exigeVideo)
    return null;
  return (
    <div className="flex flex-col gap-2">
      {(exigeFoto || exigeVideo) && (
        <p className="text-ink-2 text-sm font-semibold">
          Evidência obrigatória:{" "}
          {[exigeFoto && "foto", exigeVideo && "vídeo"]
            .filter(Boolean)
            .join(" e ")}
        </p>
      )}
      {evidencias.length > 0 && (
        <ul className="flex flex-wrap gap-3" aria-label="Evidências anexadas">
          {evidencias.map((e) => (
            <li
              key={e.id}
              className="border-line bg-surface-2 flex w-36 flex-col gap-1 rounded-md border p-2"
            >
              {e.tipo.startsWith("image/") ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Abrir foto: ${e.nome}`}
                >
                  <Image
                    src={e.url}
                    alt={e.nome}
                    width={128}
                    height={96}
                    unoptimized
                    className="h-24 w-full rounded-sm object-cover"
                  />
                </a>
              ) : (
                <video
                  src={e.url}
                  controls
                  preload="metadata"
                  className="h-24 w-full rounded-sm"
                  aria-label={e.nome}
                />
              )}
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent truncate text-sm underline"
              >
                {e.nome}
              </a>
              {podeEnviar && aoRemover && (
                <button
                  type="button"
                  className="text-bad min-h-11 text-left text-sm underline"
                  onClick={() => void aoRemover(e.id)}
                >
                  Remover evidência
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeEnviar && aoAnexar && evidencias.length < 5 && (
        <div>
          <label htmlFor={inputId} className="text-ink-2 mb-1 block text-sm">
            Anexar foto ou vídeo
          </label>
          <input
            id={inputId}
            name={`evidencia-${id}`}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            className="border-line-2 focus-visible:outline-accent text-ink-2 min-h-11 w-full max-w-md rounded-md border p-2 text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1"
            onChange={async (evento) => {
              const arquivo = evento.currentTarget.files?.[0];
              evento.currentTarget.value = "";
              if (!arquivo) return;
              const limite = arquivo.type.startsWith("video/") ? 20 : 5;
              if (arquivo.size > limite * 1024 * 1024) {
                setErro(
                  `Este arquivo passa de ${limite} MB. Reduza e tente novamente.`,
                );
                return;
              }
              setErro("");
              await aoAnexar(arquivo);
            }}
          />
          <p className="text-ink-3 mt-1 text-xs">
            Até 5 anexos por item. Fotos JPG, PNG ou WebP até 5 MB; vídeos MP4
            ou WebM até 20 MB.
          </p>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-bad text-sm">
          {erro}
        </p>
      )}
    </div>
  );
}
