import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Icone } from "@/design-system/icones";
import { Indicador } from "@/design-system/indicador";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";
import { sigla } from "@/lib/unidades";

/** O valor de uma linha, em centavos fechados — do jeito que aparece na tela. */
function valorDaLinha(item: {
  quantidade: string | null;
  custoUnitario: string;
}) {
  if (item.quantidade === null) return 0;
  return (
    Math.round(Number(item.quantidade) * Number(item.custoUnitario) * 100) / 100
  );
}

type ItemDoResumo = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidadeMedida: string;
  quantidade: string | null;
  custoUnitario: string;
};

/**
 * A contagem depois de fechada.
 *
 * Só leitura, e de propósito: este número já pode ter servido de base para um
 * CMV que alguém leu e usou para decidir. Deixar editar aqui reescreveria o
 * passado em silêncio.
 *
 * O valor só aparece para quem tem permissão de custos. Quem conta a câmara
 * fria vê quilos; não precisa saber quanto a mussarela custa.
 *
 * O topo diz O QUE MUDOU ao fechar — e é diferente conforme a contagem. A de
 * um lugar corrigiu o saldo daquele lugar; a da loja inteira não corrigiu
 * saldo nenhum, só entrou no CMV. Uma confirmação genérica ("fechada com
 * sucesso") deixaria a pessoa achando que o estoque foi acertado quando não
 * foi.
 */
export function ResumoContagem({
  itens,
  podeVerCustos,
  local,
  fechadaEm,
}: {
  itens: ItemDoResumo[];
  podeVerCustos: boolean;
  local: string | null;
  /** Já formatada no fuso da operação. */
  fechadaEm: string | null;
}) {
  const contados = itens.filter((i) => i.quantidade !== null);
  const emBranco = itens.length - contados.length;

  // O total soma os valores JÁ ARREDONDADOS de cada linha, não os valores
  // cheios. Somando os cheios, 12,75 × 38,90 entra como 495,975 e o total
  // fecha um centavo acima da soma das linhas que estão na tela — quem
  // confere na calculadora encontra a diferença e para de confiar no número.
  const total = contados.reduce((soma, i) => soma + valorDaLinha(i), 0);

  const colunas: Coluna<ItemDoResumo>[] = [
    {
      chave: "insumo",
      titulo: "Insumo",
      principal: true,
      celula: (i) => (
        <span className="block">
          <span className="block">{i.nome}</span>
          {i.categoria && (
            <span className="text-ink-3 block text-xs leading-4 font-normal">
              {i.categoria}
            </span>
          )}
        </span>
      ),
    },
    {
      chave: "contado",
      titulo: "Contado",
      numerica: true,
      celula: (i) =>
        i.quantidade === null ? (
          // Não é zero. É "ninguém contou" — e a diferença muda o CMV.
          <span className="text-ink-3">não contado</span>
        ) : (
          <>
            {formatarQuantidade(i.quantidade)}{" "}
            <span className="text-ink-3">{sigla(i.unidadeMedida)}</span>
          </>
        ),
    },
    ...(podeVerCustos
      ? ([
          {
            chave: "custo",
            titulo: "Custo congelado",
            numerica: true,
            celula: (i) => (
              <>
                {formatarMoeda(i.custoUnitario)}{" "}
                <span className="text-ink-3">/ {sigla(i.unidadeMedida)}</span>
              </>
            ),
          },
          {
            chave: "valor",
            titulo: "Valor",
            numerica: true,
            celula: (i) =>
              i.quantidade === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <span className="text-ink font-medium">
                  {formatarMoeda(valorDaLinha(i))}
                </span>
              ),
          },
        ] satisfies Coluna<ItemDoResumo>[])
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        className="border-ok/25 bg-ok-sub text-ink flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-5"
      >
        <Icone nome="check" tamanho={18} className="text-ok mt-px flex-none" />
        <span>
          <strong className="font-semibold">
            Contagem fechada{fechadaEm ? ` em ${fechadaEm}` : ""}.
          </strong>{" "}
          {local
            ? `O saldo de ${local} passou a ser o que foi contado, e as diferenças viraram ajustes em Movimentos.`
            : "Ela entrou no CMV. Por ser da loja inteira, o saldo de cada prateleira não foi corrigido."}
        </span>
      </p>

      <div
        className={`grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 ${
          podeVerCustos ? "desk:grid-cols-3" : ""
        }`}
      >
        <Indicador
          rotulo="Contados"
          valor={`${contados.length} de ${itens.length}`}
          apoio="itens com quantidade nesta contagem"
          comparacao={emBranco === 0 ? "A folha foi preenchida inteira" : null}
        />
        <Indicador
          rotulo="Em branco"
          valor={String(emBranco)}
          tom={emBranco > 0 ? "atencao" : "normal"}
          apoio="ninguém contou — ficam de fora do CMV"
          comparacao="Em branco não é zero: não vira “acabou”"
        />
        {podeVerCustos && (
          <Indicador
            rotulo="Valor do estoque contado"
            valor={formatarMoeda(total)}
            apoio="quantidade × custo congelado no fechamento"
            comparacao="Só os itens contados entram na soma"
          />
        )}
      </div>

      <Cartao como="section" className="min-w-0 overflow-hidden">
        <TituloDeSecao apoio="Como ficou no fechamento. Só leitura — o CMV pode já ter usado estes números.">
          O que foi contado
        </TituloDeSecao>
        <Tabela
          legenda="Quantidades desta contagem, como foram fechadas"
          colunas={colunas}
          linhas={itens}
          chaveDaLinha={(i) => i.insumoId}
          vazio={
            <p className="text-ink-3 px-4 py-8 text-center text-sm">
              Esta contagem não tinha nenhum item.
            </p>
          }
        />
      </Cartao>
    </div>
  );
}
