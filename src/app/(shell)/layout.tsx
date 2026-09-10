import { redirect } from "next/navigation";

import { obterContexto, REDE_INTEIRA } from "@/core/sessao/contexto";
import { appsVisiveis } from "@/core/shell/apps-visiveis";
import { AvisoDeConexao } from "@/core/shell/aviso-de-conexao";
import { BarraLateral } from "@/core/shell/barra-lateral";
import { MenuUsuario } from "@/core/shell/menu-usuario";
import { GavetaDeNavegacao, ProvedorDeNavegacao } from "@/core/shell/navegacao";
import { SeletorUnidade } from "@/core/shell/seletor-unidade";
import { Topo } from "@/core/shell/topo";

/**
 * A CASCA.
 *
 * Monta uma vez e nunca remonta. Ao trocar de App, só a área central muda —
 * a barra lateral e o topo ficam imóveis. Se isso piscar ou recarregar, a
 * ilusão de "sistema operacional" morre no primeiro clique e não volta.
 *
 * A navegação existe em DUAS formas, e as duas são montadas aqui: a barra
 * fixa (a partir de 1180px) e a gaveta (abaixo disso). Recebem exatamente a
 * mesma lista de Apps, filtrada UMA vez por requisição — se cada uma filtrasse
 * por conta própria, um dia elas discordariam, e a divergência apareceria como
 * "some do celular o que existe no computador".
 *
 * A rolagem é a do documento, não a de uma `<main>` com `overflow`. É isso que
 * faz `sticky` funcionar na barra e no topo, e é o que dá ao celular a barra
 * de endereço que se recolhe ao rolar.
 */
export default async function LayoutCasca({
  children,
}: {
  children: React.ReactNode;
}) {
  const contexto = await obterContexto();

  // Sem contexto: ou não há sessão, ou o usuário não tem acesso a nenhuma
  // organização. Nos dois casos, não há sistema para mostrar.
  if (!contexto) redirect("/login");

  const apps = appsVisiveis(contexto);

  // Montados uma vez e entregues às duas navegações. Só uma delas está visível
  // em cada largura, então não há dois seletores de unidade ao alcance do Tab.
  const seletorDeUnidade = (
    <SeletorUnidade
      unidades={contexto.unidadesVisiveis}
      valorAtual={contexto.unidadeAtiva?.id ?? REDE_INTEIRA}
      podeVerRede={contexto.podeVerRedeInteira}
    />
  );

  const conta = (
    <MenuUsuario nome={contexto.usuario.nome} email={contexto.usuario.email} />
  );

  return (
    <ProvedorDeNavegacao>
      <div className="flex min-h-dvh flex-1">
        <BarraLateral
          apps={apps}
          seletorDeUnidade={seletorDeUnidade}
          conta={conta}
        />

        <GavetaDeNavegacao
          apps={apps}
          seletorDeUnidade={seletorDeUnidade}
          conta={conta}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topo apps={apps} />
          <AvisoDeConexao />
          <main className="bg-paper desk:p-7 min-w-0 flex-1 p-4">
            {children}
          </main>
        </div>
      </div>
    </ProvedorDeNavegacao>
  );
}
