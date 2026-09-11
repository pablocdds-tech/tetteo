import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao } from "@/design-system/cartao";
import { FiltroPorLink } from "@/modules/assistente/components/filtro-por-link";
import { ListaDeAvisos } from "@/modules/assistente/components/lista-de-avisos";
import { NovoAviso } from "@/modules/assistente/components/novo-aviso";
import type { GrupoDeAviso } from "@/modules/assistente/schemas/aviso";
import {
  contarPorGrupo,
  listarAvisos,
} from "@/modules/assistente/services/avisos";

import { confirmarAvisoAcao, reenviarAvisoAcao } from "../acoes-whatsapp";

/**
 * A TELA "AVISOS".
 *
 * Abre em "Para revisar": é a fila de decisão de quem confirma. Os grupos
 * cobrem todo estado possível, e nenhum aviso fica em dois.
 */

const GRUPOS: { valor: GrupoDeAviso | "todos"; rotulo: string }[] = [
  { valor: "revisar", rotulo: "Para revisar" },
  { valor: "andamento", rotulo: "Em andamento" },
  { valor: "pendencias", rotulo: "Pendências" },
  { valor: "concluidos", rotulo: "Concluídos" },
  { valor: "todos", rotulo: "Todos" },
];

const VAZIOS: Record<
  GrupoDeAviso | "todos",
  { titulo: string; explicacao: string; bom?: boolean }
> = {
  revisar: {
    titulo: "Nada para revisar",
    explicacao:
      "Quando um fechamento for concluído — ou alguém preparar um aviso — ele aparece aqui esperando confirmação.",
    bom: true,
  },
  andamento: {
    titulo: "Nenhum aviso a caminho",
    explicacao:
      "Os confirmados aparecem aqui até o WhatsApp avisar que foram lidos.",
  },
  pendencias: {
    titulo: "Nenhuma pendência",
    explicacao:
      "Resultado desconhecido e falha aparecem aqui, com o que aconteceu e o que fazer.",
    bom: true,
  },
  concluidos: {
    titulo: "Nenhum aviso concluído ainda",
    explicacao: "Lidos e descartados ficam aqui como histórico.",
  },
  todos: {
    titulo: "Nenhum aviso ainda",
    explicacao:
      "O primeiro nasce quando um fechamento for concluído, ou quando alguém preparar um aviso à mão.",
  },
};

function ehGrupo(valor: string | undefined): valor is GrupoDeAviso | "todos" {
  return GRUPOS.some((g) => g.valor === valor);
}

export default async function PaginaAvisos({
  searchParams,
}: {
  searchParams: Promise<{ grupo?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "assistente.ver")) redirect("/assistente");

  const { grupo: pedido } = await searchParams;
  const grupo = ehGrupo(pedido) ? pedido : "revisar";

  const [contagens, avisos] = await Promise.all([
    contarPorGrupo(contexto),
    listarAvisos(contexto, grupo),
  ]);

  const lojas = contexto.unidadesVisiveis.map((u) => ({
    id: u.id,
    nome: u.nome,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <CabecalhoDePagina
        titulo="Avisos"
        contexto="O que vai sair pelo WhatsApp — e só sai depois que alguém confirma"
        controles={
          <FiltroPorLink
            nome="Grupo de avisos"
            selecionado={grupo}
            opcoes={GRUPOS.map((g) => ({
              valor: g.valor,
              rotulo: g.rotulo,
              href: `/assistente/avisos?grupo=${g.valor}`,
              contagem: g.valor === "todos" ? undefined : contagens[g.valor],
            }))}
          />
        }
      />

      {pode(contexto, "assistente.preparar") && lojas.length > 0 && (
        <div className="mt-6">
          <NovoAviso
            lojas={lojas}
            lojaPadrao={contexto.unidadeAtiva?.id ?? null}
          />
        </div>
      )}

      <Cartao className="mt-4" como="section">
        <ListaDeAvisos
          avisos={avisos}
          vazio={VAZIOS[grupo]}
          confirmar={confirmarAvisoAcao}
          reenviar={reenviarAvisoAcao}
        />
      </Cartao>
    </div>
  );
}
