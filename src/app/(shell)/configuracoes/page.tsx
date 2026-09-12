import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormularioOrganizacao } from "@/core/configuracoes/componentes/formulario-organizacao";
import {
  listarPessoas,
  listarUnidades,
  obterOrganizacao,
} from "@/core/configuracoes/servicos";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

export default async function PaginaConfiguracoes() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "configuracoes.ver")) notFound();

  const [organizacao, unidades, pessoas] = await Promise.all([
    obterOrganizacao(contexto),
    listarUnidades(contexto),
    listarPessoas(contexto),
  ]);
  if (!organizacao) notFound();

  const construidos = APPS_REGISTRADOS.filter((a) => !a.emConstrucao);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
      <p className="text-ink-3 mt-1 text-sm">O painel de controle do Tetteo</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Atalho
          href="/configuracoes/unidades"
          titulo="Unidades"
          numero={unidades.filter((u) => u.ativa).length}
          rotulo={
            unidades.filter((u) => u.ativa).length === 1
              ? "loja ativa"
              : "lojas ativas"
          }
        />
        <Atalho
          href="/configuracoes/usuarios"
          titulo="Pessoas"
          numero={pessoas.filter((p) => p.status === "ATIVO").length}
          rotulo="com acesso"
        />
        <Atalho
          href="/configuracoes/auditoria"
          titulo="Módulos"
          numero={construidos.length}
          rotulo={`de ${APPS_REGISTRADOS.length} prontos`}
        />
      </div>

      <section className="mt-10">
        <h2 className="font-semibold">A rede</h2>
        <p className="text-ink-3 mt-1 mb-4 text-sm">
          Os dados que valem para todas as lojas.
        </p>
        <FormularioOrganizacao
          organizacao={{
            nome: organizacao.nome,
            documento: organizacao.documento,
          }}
        />
      </section>

      <section className="mt-10">
        <h2 className="font-semibold">Integrações</h2>
        <Link
          href="/configuracoes/integracoes"
          className="border-line bg-surface-2 hover:border-accent mt-3 block rounded-xl border px-5 py-4 transition-colors"
        >
          <p className="font-semibold">Conexões de IA</p>
          <p className="text-ink-3 mt-1 max-w-lg text-sm">
            Quem autorizou uma IA a consultar o Tetteo, de qual loja, e o botão
            de revogar. A ligação com o seu PDV ainda não existe — e um campo de
            token que não conecta em lugar nenhum seria só enfeite, então ele
            não está aqui.
          </p>
        </Link>
      </section>
    </div>
  );
}

function Atalho({
  href,
  titulo,
  numero,
  rotulo,
}: {
  href: string;
  titulo: string;
  numero: number;
  rotulo: string;
}) {
  return (
    <Link
      href={href}
      className="border-line bg-surface-2 hover:border-accent rounded-xl border px-4 py-3 transition-colors"
    >
      <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
        {titulo}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{numero}</p>
      <p className="text-ink-3 text-xs">{rotulo}</p>
    </Link>
  );
}
