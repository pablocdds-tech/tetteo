import type { StatusAviso } from "../schemas/aviso";

import { quando } from "./rotulos";

/**
 * A LINHA DO TEMPO DE UM AVISO — só com o que tem prova.
 *
 * Cada etapa mostra o horário em que a prova chegou, ou nada. "Lido" sem
 * "Entregue" antes não inventa a entrega: o WhatsApp manda os avisos fora de
 * ordem, às vezes pula um, e a tela mostra o que se sabe — não o que seria
 * lógico ter acontecido.
 */

type Etapas = {
  criadoEm: Date;
  confirmadoEm: Date | null;
  enfileiradoEm: Date | null;
  aceitoEm: Date | null;
  entregueEm: Date | null;
  lidoEm: Date | null;
  falhouEm: Date | null;
  descartadoEm: Date | null;
};

type Linha = {
  rotulo: string;
  em: Date | null;
  tom?: "ruim" | "aviso";
  semHorario?: string;
};

export function EtapasDoAviso({
  etapas,
  status,
}: {
  etapas: Etapas;
  status: StatusAviso;
}) {
  const linhas: Linha[] = [
    { rotulo: "Rascunho", em: etapas.criadoEm },
    { rotulo: "Confirmado", em: etapas.confirmadoEm },
    { rotulo: "Na fila", em: etapas.enfileiradoEm },
    { rotulo: "Aceito pelo provedor", em: etapas.aceitoEm },
    { rotulo: "Entregue", em: etapas.entregueEm },
    { rotulo: "Lido", em: etapas.lidoEm },
  ];
  if (status === "INCERTO") {
    linhas.push({
      rotulo: "Resultado desconhecido",
      em: null,
      tom: "aviso",
      semHorario: "aguardando",
    });
  }
  if (etapas.falhouEm) {
    linhas.push({ rotulo: "Falhou", em: etapas.falhouEm, tom: "ruim" });
  }
  if (etapas.descartadoEm) {
    linhas.push({ rotulo: "Descartado", em: etapas.descartadoEm });
  }

  return (
    <ol aria-label="Etapas do aviso" className="flex flex-col">
      {linhas.map((linha) => {
        const aconteceu = linha.em !== null || linha.tom !== undefined;
        const ponto = !aconteceu
          ? "border-line-2 bg-transparent"
          : linha.tom === "ruim"
            ? "border-bad bg-bad"
            : linha.tom === "aviso"
              ? "border-warn bg-warn"
              : "border-ok bg-ok";

        return (
          <li
            key={linha.rotulo}
            className="grid grid-cols-[14px_1fr_auto] items-center gap-3 py-1.5"
          >
            <span
              aria-hidden
              className={`size-2.5 rounded-full border-2 ${ponto}`}
            />
            <span
              className={`text-sm ${aconteceu ? "text-ink" : "text-ink-3"}`}
            >
              {linha.rotulo}
            </span>
            <span className="text-ink-3 text-sm tabular-nums">
              {linha.em ? (
                quando(linha.em)
              ) : linha.semHorario ? (
                linha.semHorario
              ) : (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">sem registro</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
