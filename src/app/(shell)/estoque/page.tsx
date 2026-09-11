import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao } from "@/design-system/cartao";
import { Esqueleto, LinhasCarregando } from "@/design-system/esqueleto";
import { Indicador, IndicadorCarregando } from "@/design-system/indicador";
import { Vazio } from "@/design-system/vazio";
import { formatarMoeda } from "@/lib/numero";
import { AvisoUnidade } from "@/modules/estoque/components/aviso-unidade";
import { Despensa } from "@/modules/estoque/components/despensa";
import { listarDespensa } from "@/modules/estoque/services/despensa";

import { criarCotacaoDaDespensa } from "./acoes-da-despensa";

/**
 * A DESPENSA.
 *
 * A primeira tela do Estoque. Responde, sem abrir mais nada: o que está
 * faltando, o que nunca foi contado, e o que vai no pedido desta semana.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA ERA.
 *
 * Era "Posição": uma linha por PRATELEIRA, com botões de lugar em cima. Ela
 * respondia "quanto tem na câmara fria" — pergunta de quem conta. Quem COMPRA
 * faz outra: "quanto tem na loja?". Com uma linha por prateleira, o mesmo
 * insumo aparecia três vezes e ninguém somava de cabeça na hora de decidir.
 *
 * Agora é uma linha por INSUMO, com o total da loja, e a divisão por
 * prateleira vive no painel de detalhe — onde ela é resposta, e não ruído.
 * ---------------------------------------------------------------------------
 *
 * O link antigo `?faltando=1` continua funcionando: ele abre a tela já
 * filtrada em "Repor". Endereço que alguém colou no WhatsApp é contrato.
 */

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

export default async function PaginaDaDespensa({
  searchParams,
}: {
  searchParams: Promise<{ faltando?: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  const { faltando } = await searchParams;
  const situacaoInicial = faltando === "1" ? "repor" : "todas";

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Despensa"
        contexto={
          contexto.unidadeAtiva
            ? `O que existe hoje · ${contexto.unidadeAtiva.nome}`
            : "O que existe hoje"
        }
        acao={
          pode(contexto, "estoque.contar") ? (
            <Link
              href="/estoque/contagens/nova"
              className={estiloDeBotao("primario", "medio")}
            >
              Nova contagem
            </Link>
          ) : undefined
        }
      />

      <Suspense fallback={<EsqueletoDaDespensa />}>
        <CorpoDaDespensa situacaoInicial={situacaoInicial} />
      </Suspense>
    </div>
  );
}

async function CorpoDaDespensa({
  situacaoInicial,
}: {
  situacaoInicial: "todas" | "repor";
}) {
  const contexto = await obterContexto();
  if (!contexto) return null;

  // Sem permissão, a tela diz isso — e não mostra nada do que existe do outro
  // lado. Sem esta checagem, o serviço recusaria com uma exceção e a pessoa
  // veria "a tela não conseguiu carregar", que é mentira: carregou, e ela só
  // não pode ver.
  if (!pode(contexto, "estoque.ver")) {
    return (
      <Cartao>
        <Vazio
          icone="cadeado"
          titulo="Sem acesso a esta informação"
          explicacao="Seu perfil não inclui ver o estoque. Se você precisa acompanhar a despensa, peça a quem administra o Tetteo para revisar o seu papel."
        />
      </Cartao>
    );
  }

  // Estoque é físico. Somar a rede aqui produziria um número que não
  // corresponde a nenhuma loja — e alguém compraria em cima dele.
  if (!contexto.unidadeAtiva) return <AvisoUnidade acao="Ver a despensa" />;

  const podeVerCustos = pode(contexto, "estoque.custos");
  const despensa = await listarDespensa(contexto);

  if (despensa.itens.length === 0) {
    return (
      <Cartao>
        <Vazio
          icone="caixa"
          titulo="Nenhum insumo cadastrado ainda"
          explicacao="A despensa mostra o catálogo de insumos da rede com o saldo desta loja. Cadastre os insumos — ou importe a planilha que você já tem — e eles aparecem aqui."
          acao={
            pode(contexto, "estoque.lancar") ? (
              <Link
                href="/estoque/importar"
                className={estiloDeBotao("secundario", "pequeno")}
              >
                Importar cadastro
              </Link>
            ) : undefined
          }
        />
      </Cartao>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        className={`grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 ${
          podeVerCustos ? "desk:grid-cols-4" : "desk:grid-cols-3"
        }`}
      >
        <Indicador
          rotulo="Para repor"
          valor={String(despensa.aRepor)}
          tom={despensa.aRepor > 0 ? "atencao" : "positivo"}
          apoio={
            despensa.aRepor > 0
              ? "abaixo do mínimo cadastrado · agora"
              : "nenhum insumo abaixo do mínimo · agora"
          }
          comparacao={
            despensa.ultimaContagem
              ? `Última contagem fechada: ${dataCurta.format(despensa.ultimaContagem.referencia)}`
              : "Nenhuma contagem fechada ainda"
          }
        />

        <Indicador
          rotulo="Nunca contados"
          valor={String(despensa.semSaldo)}
          tom={despensa.semSaldo > 0 ? "atencao" : "normal"}
          apoio="sem nenhuma posição nesta loja"
          comparacao="Em branco não é zero — estes ficam de fora do valor"
        />

        <Indicador
          rotulo="Sem mínimo"
          valor={String(despensa.semMinimo)}
          apoio="não dá para dizer se falta ou sobra"
          comparacao="Cadastre o mínimo para eles entrarem no “Repor”"
        />

        {podeVerCustos && (
          <Indicador
            rotulo="Valor em estoque"
            valor={formatarMoeda(despensa.valorTotal)}
            apoio="custo médio × saldo conhecido"
            comparacao={
              despensa.semSaldo > 0
                ? `${despensa.semSaldo} ${despensa.semSaldo === 1 ? "insumo ficou" : "insumos ficaram"} de fora por não ter saldo`
                : "Todos os insumos têm saldo conhecido"
            }
          />
        )}
      </div>

      {/* A honestidade que a tela precisa ter: sem baixa de saída, este saldo
          só cresce. Dizer isso evita decisão de compra sobre número falso. */}
      <p className="border-line-2 bg-surface-2 text-ink-2 rounded-lg border border-dashed px-4 py-3 text-sm leading-5">
        O saldo vem das{" "}
        <strong className="font-semibold">contagens fechadas</strong> mais as{" "}
        <strong className="font-semibold">notas lançadas</strong> depois delas.
        As saídas ainda não são registradas — então ele fica alto até a próxima
        contagem corrigir.{" "}
        {despensa.ultimaContagem
          ? `A última contagem fechada é de ${dataCurta.format(despensa.ultimaContagem.referencia)}.`
          : "Nenhuma contagem foi fechada ainda."}
      </p>

      <Despensa
        itens={despensa.itens}
        categorias={despensa.categorias}
        unidadeId={contexto.unidadeAtiva.id}
        podeVerCustos={podeVerCustos}
        podeCotar={pode(contexto, "compras.requisitar")}
        situacaoInicial={situacaoInicial}
        acaoDeCotar={criarCotacaoDaDespensa}
      />
    </div>
  );
}

/** Do tamanho aproximado do que vem — a tela não pula quando o dado chega. */
function EsqueletoDaDespensa() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <span className="sr-only" role="status">
        Carregando a despensa.
      </span>

      <div className="desk:grid-cols-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <IndicadorCarregando key={i} />
        ))}
      </div>

      <Esqueleto className="h-[54px] w-full" arredondado="lg" />

      <div className="desk:grid-cols-[7fr_3fr] grid min-w-0 grid-cols-1 items-start gap-4">
        <Cartao className="min-w-0 overflow-hidden">
          <div className="border-line border-b px-4 py-3">
            <Esqueleto className="h-5 w-36" />
          </div>
          <div className="border-line border-b px-4 py-3">
            <Esqueleto className="h-11 w-full" arredondado="md" />
          </div>
          <LinhasCarregando linhas={8} />
        </Cartao>

        <Cartao className="min-w-0 overflow-hidden">
          <div className="border-line border-b px-4 py-3">
            <Esqueleto className="h-5 w-32" />
          </div>
          <div className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <Esqueleto key={i} className="h-16 w-full" arredondado="md" />
            ))}
          </div>
        </Cartao>
      </div>
    </div>
  );
}
