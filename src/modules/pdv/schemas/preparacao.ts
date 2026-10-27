import type {
  PendenciaPreparacao,
  ProdutoPreparacao,
} from "../preparacao-types";
import {
  calcularConsumo,
  type ConsumoPdv,
  type InsumoPdv,
  type ReceitaPdv,
} from "./consumo";
import { esquemaComplementos } from "./venda";

export type FichaPreparacao = ReceitaPdv & {
  ativo: boolean;
  categoria: string | null;
  precoCentavos: number | null;
};
export type ConfiguracaoPreparacao = { codigo: string | null; grupos: unknown };

/** Diagnóstico por produto: uma configuração corrompida não interrompe os demais. */
export function diagnosticarProdutoPreparacao(
  ficha: FichaPreparacao,
  configuracao: ConfiguracaoPreparacao | undefined,
  receitasAtivas: ReceitaPdv[],
  insumosAtivos: InsumoPdv[],
  saldos: Map<string, number> | null,
): ProdutoPreparacao {
  const pendencias: PendenciaPreparacao[] = [];
  const hrefFicha = `/cardapio/fichas/${encodeURIComponent(ficha.id)}`;
  function adicionar(
    codigo: string,
    nivel: PendenciaPreparacao["nivel"],
    mensagem: string,
    destino: "FICHA" | "CATALOGO" | "ESTOQUE" = "FICHA",
  ) {
    pendencias.push({
      codigo,
      nivel,
      mensagem,
      href:
        destino === "FICHA"
          ? hrefFicha
          : destino === "CATALOGO"
            ? "/pdv/catalogo"
            : "/estoque",
      acao:
        destino === "FICHA"
          ? "Revisar ficha"
          : destino === "CATALOGO"
            ? "Configurar produto"
            : "Conferir estoque",
    });
  }
  if (!ficha.ativo)
    adicionar(
      "produto_inativo",
      "BLOQUEIO",
      "Produto inativo: não aparece na frente de caixa.",
    );
  if (ficha.precoCentavos === null)
    adicionar(
      "preco_ausente",
      "BLOQUEIO",
      "Defina o preço de venda na ficha técnica.",
    );
  else if (
    !Number.isSafeInteger(ficha.precoCentavos) ||
    ficha.precoCentavos < 0 ||
    ficha.precoCentavos > 100_000_000
  )
    adicionar(
      "preco_invalido",
      "BLOQUEIO",
      "O preço de venda está fora do limite permitido.",
    );
  const codigo = configuracao?.codigo ?? "";
  if (!codigo.trim())
    adicionar(
      "codigo_ausente",
      "AVISO",
      "Sem código PDV ou código de barras; o produto continua disponível pela busca por nome.",
      "CATALOGO",
    );
  const analise = esquemaComplementos.safeParse({
    produtoId: ficha.id,
    codigo,
    grupos: configuracao ? configuracao.grupos : [],
  });
  if (!analise.success)
    adicionar(
      "complementos_invalidos",
      "BLOQUEIO",
      "Confira a configuração dos grupos, opções e limites de seleção dos complementos.",
      "CATALOGO",
    );
  const grupos = analise.success ? analise.data.grupos : [];
  const ingredientes = new Map<
    string,
    { consumo: ConsumoPdv; necessarioBase: number }
  >();
  function conferirReceita(id: string, origem: string, base: boolean): boolean {
    try {
      const consumo = calcularConsumo(
        [{ fichaId: id, quantidade: 1 }],
        receitasAtivas,
        insumosAtivos,
      );
      for (const item of consumo) {
        const atual = ingredientes.get(item.insumoId);
        ingredientes.set(item.insumoId, {
          consumo: item,
          necessarioBase: base
            ? Number(item.quantidade)
            : (atual?.necessarioBase ?? 0),
        });
      }
      return consumo.length > 0;
    } catch (erro) {
      adicionar(
        base ? "receita_invalida" : `receita_complemento_${id}`,
        "BLOQUEIO",
        `${origem}: ${erro instanceof Error ? erro.message : "Receita indisponível."}`,
        base ? "FICHA" : "CATALOGO",
      );
      return false;
    }
  }
  // A base pode ser vazia quando o consumo vem dos sabores. O finalizador aceita
  // essa composição; exigir ingrediente na base daria um bloqueio falso.
  const baseTemConsumo = ficha.ativo
    ? conferirReceita(ficha.id, "Receita base", true)
    : false;
  let complementoTemConsumo = false;
  let consumoObrigatorio = false;
  for (const grupo of grupos) {
    let semReceitaComConsumo = 0;
    for (const opcao of grupo.opcoes) {
      if (!opcao.fichaId) {
        semReceitaComConsumo++;
        adicionar(
          `complemento_sem_ficha_${opcao.id}`,
          "AVISO",
          `${grupo.nome} · ${opcao.nome}: sem ficha vinculada; esta opção não gera consumo próprio de estoque.`,
          "CATALOGO",
        );
      } else {
        const temConsumo = conferirReceita(
          opcao.fichaId,
          `${grupo.nome} · ${opcao.nome}`,
          false,
        );
        complementoTemConsumo ||= temConsumo;
        if (!temConsumo) {
          semReceitaComConsumo++;
          adicionar(
            `complemento_sem_consumo_${opcao.id}`,
            "AVISO",
            `${grupo.nome} · ${opcao.nome}: a ficha vinculada não gerou consumo válido. Revise a receita.`,
            "CATALOGO",
          );
        }
      }
    }
    if (grupo.minimo > semReceitaComConsumo) consumoObrigatorio = true;
  }
  if (!baseTemConsumo && !complementoTemConsumo && ficha.ativo)
    adicionar(
      "consumo_ausente",
      "BLOQUEIO",
      "Nenhuma receita base ou de complemento gera consumo de insumos. Cadastre os ingredientes antes de vender.",
    );
  else if (!baseTemConsumo && !consumoObrigatorio && ficha.ativo)
    adicionar(
      "consumo_condicional",
      "AVISO",
      "O consumo depende dos complementos escolhidos. Combinações sem receita vinculada serão recusadas na venda.",
      "CATALOGO",
    );
  if (
    ficha.precoCentavos === 0 &&
    grupos.every((g) => g.opcoes.every((o) => o.precoCentavos === 0))
  )
    adicionar(
      "preco_zero",
      "BLOQUEIO",
      "A base e todos os complementos têm preço zero. A venda exige total maior que zero.",
    );
  if (
    ficha.precoCentavos === 0 &&
    grupos.some((g) => g.opcoes.some((o) => o.precoCentavos > 0)) &&
    grupos.every(
      (g) =>
        g.minimo === 0 ||
        g.opcoes.filter((o) => o.precoCentavos === 0).length >= g.minimo,
    )
  )
    adicionar(
      "preco_condicional",
      "AVISO",
      "Algumas escolhas podem resultar em preço zero. Confira os complementos obrigatórios.",
      "CATALOGO",
    );
  const estoque: ProdutoPreparacao["estoque"] = [...ingredientes.values()].map(
    ({ consumo, necessarioBase }) => {
      const disponivel =
        saldos === null ? null : (saldos.get(consumo.insumoId) ?? 0);
      if (
        disponivel !== null &&
        (necessarioBase > disponivel ||
          (necessarioBase === 0 && disponivel <= 0))
      )
        adicionar(
          `saldo_${consumo.insumoId}`,
          "ESTOQUE",
          necessarioBase > 0
            ? `${consumo.nome}: saldo ${disponivel} insuficiente para a receita base de uma unidade (${necessarioBase}).`
            : `${consumo.nome}: sem saldo para complementos que utilizem este insumo. Confira a combinação escolhida.`,
          "ESTOQUE",
        );
      return {
        insumoId: consumo.insumoId,
        nome: consumo.nome,
        unidade:
          insumosAtivos.find((i) => i.id === consumo.insumoId)?.unidadeMedida ??
          "",
        necessarioBase,
        disponivel,
      };
    },
  );
  return {
    id: ficha.id,
    nome: ficha.nome,
    categoria: ficha.categoria || "Sem categoria",
    ativo: ficha.ativo,
    precoCentavos: ficha.precoCentavos,
    codigo,
    pronto: !pendencias.some((p) => p.nivel === "BLOQUEIO"),
    pendencias,
    estoque,
  };
}
