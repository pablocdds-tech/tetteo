import Link from "next/link";
import { estiloDeBotao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";

export function BotoesImpressao({
  vendaId,
  compacto = false,
}: {
  vendaId: string;
  compacto?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Impressões do pedido">
      <Link
        href={`/pdv/imprimir/${vendaId}?tipo=COMPROVANTE`}
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        title="Imprimir pedido"
        className={
          compacto
            ? "text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent grid size-10 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
            : estiloDeBotao("secundario", "pequeno")
        }
      >
        {compacto && <Icone nome="impressora" tamanho={19} />}
        <span className={compacto ? "sr-only" : undefined}>
          Imprimir pedido
        </span>
        <span className="sr-only"> (abre prévia em nova aba)</span>
      </Link>
      <Link
        href={`/pdv/imprimir/${vendaId}?tipo=COZINHA`}
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        title="Versão para cozinha"
        className={
          compacto
            ? "text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent grid size-10 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
            : estiloDeBotao("secundario", "pequeno")
        }
      >
        {compacto && <Icone nome="prato" tamanho={19} />}
        <span className={compacto ? "sr-only" : undefined}>
          Versão para cozinha
        </span>
        <span className="sr-only"> (abre prévia em nova aba)</span>
      </Link>
    </div>
  );
}
