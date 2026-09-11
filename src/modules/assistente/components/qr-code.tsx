"use client";

import { useEffect, useState } from "react";

import { Botao } from "@/design-system/botao";

/**
 * O QR CODE — na tela por 45 segundos, e em nenhum outro lugar.
 *
 * A imagem chega dentro da resposta da ação e mora só no estado deste
 * componente. Não vai para o banco, não vai para log, não entra na URL. Quando
 * o prazo acaba, ela some da tela; quando o número conecta, o componente
 * inteiro sai. Cada QR novo remonta o componente (a `key` é do QR), e o
 * relógio recomeça sozinho.
 *
 * Quem o lê com um celular CONECTA o número. Por isso a frase sobre fotografar
 * não é enfeite.
 */
export function QrCode({
  imagem,
  expiraEmMs,
  aoRenovar,
  renovando,
}: {
  imagem: string;
  expiraEmMs: number;
  aoRenovar: () => void;
  renovando: boolean;
}) {
  const [restante, setRestante] = useState(Math.ceil(expiraEmMs / 1000));

  useEffect(() => {
    const inicio = Date.now();
    const relogio = setInterval(() => {
      const segundos = Math.max(
        0,
        Math.ceil((expiraEmMs - (Date.now() - inicio)) / 1000),
      );
      setRestante(segundos);
      if (segundos === 0) clearInterval(relogio);
    }, 1000);
    return () => clearInterval(relogio);
  }, [expiraEmMs]);

  const expirou = restante === 0;

  return (
    <div className="border-line bg-surface-2 flex flex-col items-center gap-4 rounded-lg border p-4 sm:flex-row sm:items-start">
      <div className="bg-surface border-line grid size-[232px] flex-none place-items-center rounded-md border">
        {expirou ? (
          <p className="text-ink-3 px-6 text-center text-sm" aria-live="polite">
            Este QR Code expirou.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- imagem de 45 s em data URL: não pode passar pelo otimizador nem ficar em cache
          <img
            src={imagem}
            alt="QR Code para conectar o WhatsApp do número"
            width={216}
            height={216}
            className="size-[216px]"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2 text-sm leading-5">
        <p className="font-semibold">
          No celular do número: WhatsApp → Aparelhos conectados → Conectar um
          aparelho.
        </p>
        <p className="text-ink-3 tabular-nums">
          {expirou
            ? "Peça um novo para continuar."
            : `Vale por mais ${restante} s. Depois disso, peça outro.`}
        </p>
        <p className="text-ink-3">
          Não fotografe nem compartilhe este código: quem o lê conecta o número.
        </p>
        <div className="pt-1">
          <Botao
            peso="secundario"
            tamanho="pequeno"
            onClick={aoRenovar}
            carregando={renovando}
          >
            Gerar novo QR Code
          </Botao>
        </div>
      </div>
    </div>
  );
}
