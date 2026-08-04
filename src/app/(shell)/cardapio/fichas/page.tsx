import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { ListaFichas } from "@/modules/cardapio/components/lista-fichas";
import { listarFichas } from "@/modules/cardapio/services/fichas";

/** A rota só delega: quem sabe o que é uma ficha técnica é o App. */
export default async function PaginaFichas() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "cardapio.ver")) notFound();

  const fichas = await listarFichas(contexto);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Fichas técnicas
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            Quanto cada prato custa de ingrediente — e quanto do preço isso come
          </p>
        </div>

        {pode(contexto, "cardapio.editar") && (
          <Link href="/cardapio/fichas/nova">
            <Botao>Nova ficha</Botao>
          </Link>
        )}
      </div>

      <div className="mt-6">
        <ListaFichas
          fichas={fichas}
          podeVerCustos={pode(contexto, "cardapio.custos")}
        />
      </div>
    </div>
  );
}
