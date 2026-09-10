import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

/**
 * A rede de segurança da navegação.
 *
 * Módulos registrados mas ainda não construídos existem no painel — mostram o
 * rumo do sistema. Sem esta tela, clicar num deles daria "página não
 * encontrada", que parece defeito. Aqui o sistema diz a verdade: o módulo
 * existe no plano, ainda não na prática.
 *
 * Endereços que não pertencem a módulo nenhum continuam caindo em 404, como
 * devem.
 */
export default async function ModuloEmConstrucao({
  params,
}: {
  params: Promise<{ rota: string[] }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const { rota } = await params;
  const caminho = `/${rota.join("/")}`;

  const app = APPS_REGISTRADOS.filter(
    (a) => caminho === a.rota || caminho.startsWith(`${a.rota}/`),
  ).sort((a, b) => b.rota.length - a.rota.length)[0];

  if (!app || !pode(contexto, app.permissaoParaVer)) notFound();

  const secao = app.navegacao.find((i) => i.rota === caminho);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 flex-none place-items-center rounded-xl"
          style={{ background: app.cor.fundo, color: app.cor.frente }}
        >
          <Icone nome={app.icone} tamanho={22} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {secao ? `${app.nome} · ${secao.nome}` : app.nome}
          </h1>
          <p className="text-ink-3 text-sm">{app.subtitulo}</p>
        </div>
      </div>

      <div className="border-line-2 bg-surface-2 mt-8 rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="font-semibold">Este módulo ainda não foi construído</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-lg text-sm">
          Ele já está no plano do Tetteo, com as permissões e os eventos
          desenhados — mas as telas ainda não existem. Você está vendo esta
          entrada porque é Diretor; a equipe não vê módulos em construção.
        </p>

        {(app.eventosQueEscuta?.length || app.eventosQuePublica?.length) && (
          <p className="text-ink-3 mt-4 font-mono text-xs">
            {app.eventosQuePublica?.length
              ? `publica: ${app.eventosQuePublica.join(", ")}`
              : ""}
            {app.eventosQuePublica?.length && app.eventosQueEscuta?.length
              ? " · "
              : ""}
            {app.eventosQueEscuta?.length
              ? `escuta: ${app.eventosQueEscuta.join(", ")}`
              : ""}
          </p>
        )}

        <Link href="/" className={`mt-5 ${estiloDeBotao("secundario")}`}>
          Voltar ao painel
        </Link>
      </div>
    </div>
  );
}
