import Link from "next/link";
import { estiloDeBotao } from "@/design-system/botao";

export function BotoesImpressao({ vendaId }: { vendaId: string }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Impressões do pedido">
      <Link
        href={`/pdv/imprimir/${vendaId}?tipo=COMPROVANTE`}
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className={estiloDeBotao("secundario", "pequeno")}
      >
        Imprimir pedido
        <span className="sr-only"> (abre prévia em nova aba)</span>
      </Link>
      <Link
        href={`/pdv/imprimir/${vendaId}?tipo=COZINHA`}
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className={estiloDeBotao("secundario", "pequeno")}
      >
        Versão para cozinha
        <span className="sr-only"> (abre prévia em nova aba)</span>
      </Link>
    </div>
  );
}
