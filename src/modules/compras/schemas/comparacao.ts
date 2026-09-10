import type { Unidade } from "@/lib/unidades";

import {
  embalagensNecessarias,
  precoPorUnidade,
  quantidadeDeEmbalagens,
  totalFracionado,
  totalPorEmbalagens,
  type Centavos,
  type DezMilesimos,
  type Micros,
  type Milesimos,
} from "./aritmetica";

/**
 * A COMPARAÇÃO DAS PROPOSTAS — pura, sem banco.
 *
 * Responde "de quem comprar?" sem cair nas quatro armadilhas da comparação
 * ingênua, todas de toda semana numa pizzaria:
 *
 *   EMBALAGEM   caixa de 12 × 900 g não se compara com o quilo sem converter.
 *               O fator vem da dimensão; fator desconhecido tira o item da
 *               disputa automática ("conferir fator") em vez de chutar.
 *
 *   ARREDONDAR  ninguém compra 1,85 caixa. As embalagens inteiras são
 *               calculadas POR LOJA, e o que sobra (adicional) e quanto ele
 *               custa aparecem na tela.
 *
 *   FRETE E     frete e mínimo são por ENTREGA — por loja atendida. Um
 *   MÍNIMO      fornecedor 2% mais barato com R$ 80 de frete não é mais
 *               barato, e o mais barato que não atinge o mínimo não é opção.
 *
 *   AUSÊNCIA    sem resposta, indisponível, fator desconhecido e frete não
 *               informado são ditos em voz alta e NUNCA contam como vantagem.
 *
 * A sugestão testa as COMBINAÇÕES de fornecedores (até 12 com frete
 * informado), porque o frete muda o vencedor: comprar cada item do mais
 * barato pode sair mais caro do que concentrar num só. Ela sugere; quem
 * escolhe é o comprador, item por item.
 *
 * Não existe aqui ranking de qualidade: não há histórico que o sustente.
 */

export type ItemParaComparar = {
  /** id do `ItemDaRodada` */
  id: string;
  nome: string;
  unidade: Unidade;
  modo: "COTAVEL" | "DIRECIONADO";
  porLoja: { unidadeId: string; quantidade: Milesimos }[];
};

export type OfertaParaComparar = {
  itemId: string;
  itemDePropostaId: string;
  situacao: "COTADO" | "INDISPONIVEL";
  fator: DezMilesimos | null;
  fatorMotivo: string | null;
  fracionavel: boolean;
  precoEmbalagem: Centavos | null;
  precoZeroAutorizado: boolean;
  /** Quanto ele consegue entregar, na unidade de estoque. `null` = não disse. */
  disponivel: Milesimos | null;
  descricaoEmbalagem: string;
};

export type PropostaParaComparar = {
  fornecedorId: string;
  nome: string;
  /** 0 quando ainda não respondeu. */
  versao: number;
  /** Por ENTREGA (loja). `null` = não informado — diferente de zero. */
  frete: Centavos | null;
  minimo: Centavos | null;
  prazoDias: number | null;
  /** Os itens que FORAM pedidos a este fornecedor. */
  itensSolicitados: string[];
  ofertas: OfertaParaComparar[];
};

export type EstadoDaCelula =
  | "cotado"
  | "sem-resposta"
  | "indisponivel"
  | "conferir-fator"
  | "zero-sem-autorizacao"
  | "disponibilidade-insuficiente"
  | "nao-solicitado";

export type Celula = {
  fornecedorId: string;
  itemDePropostaId: string | null;
  estado: EstadoDaCelula;
  /** Entra na disputa automática (grade e sugestão). */
  comparavel: boolean;
  descricaoEmbalagem: string | null;
  fatorMotivo: string | null;
  precoEmbalagem: Centavos | null;
  precoPorUnidade: Micros | null;
  /** Embalagens inteiras somadas das lojas; `null` a granel. */
  embalagens: bigint | null;
  comprado: Milesimos | null;
  adicional: Milesimos | null;
  custo: Centavos | null;
  custoAdicional: Centavos | null;
  porLoja: { unidadeId: string; custo: Centavos }[];
  menorCusto: boolean;
};

export type LinhaDaGrade = {
  item: ItemParaComparar;
  necessario: Milesimos;
  celulas: Celula[];
};

export type TotalDoFornecedor = {
  fornecedorId: string;
  nome: string;
  versao: number;
  itensSolicitados: number;
  itensComparaveis: number;
  /** Cotou de forma comparável TUDO o que lhe foi pedido. */
  completo: boolean;
  /** Mercadoria das células comparáveis. */
  subtotal: Centavos;
  lojasAtendidas: number;
  freteInformado: boolean;
  /** frete × lojas atendidas; `null` se o frete não foi informado. */
  freteTotal: Centavos | null;
  /** `null` quando não há mínimo informado. */
  minimoAtendido: boolean | null;
  /** `null` quando falta o frete — ausência não vira vantagem. */
  total: Centavos | null;
  prazoDias: number | null;
};

export type Grade = {
  linhas: LinhaDaGrade[];
  fornecedores: TotalDoFornecedor[];
};

function somaQuantidade(item: ItemParaComparar): Milesimos {
  return item.porLoja.reduce((s, l) => s + l.quantidade, 0n);
}

function celulaDe(
  item: ItemParaComparar,
  necessario: Milesimos,
  proposta: PropostaParaComparar,
): Celula {
  const vazia = (estado: EstadoDaCelula, extra: Partial<Celula> = {}): Celula => ({
    fornecedorId: proposta.fornecedorId,
    itemDePropostaId: null,
    estado,
    comparavel: false,
    descricaoEmbalagem: null,
    fatorMotivo: null,
    precoEmbalagem: null,
    precoPorUnidade: null,
    embalagens: null,
    comprado: null,
    adicional: null,
    custo: null,
    custoAdicional: null,
    porLoja: [],
    menorCusto: false,
    ...extra,
  });

  if (!proposta.itensSolicitados.includes(item.id)) return vazia("nao-solicitado");

  const oferta = proposta.ofertas.find((o) => o.itemId === item.id);
  if (!oferta) return vazia("sem-resposta");

  const base = {
    itemDePropostaId: oferta.itemDePropostaId,
    descricaoEmbalagem: oferta.descricaoEmbalagem,
    fatorMotivo: oferta.fatorMotivo,
    precoEmbalagem: oferta.precoEmbalagem,
  };

  if (oferta.situacao === "INDISPONIVEL") return vazia("indisponivel", base);
  if (oferta.fator === null || oferta.precoEmbalagem === null) {
    return vazia("conferir-fator", base);
  }

  const fator = oferta.fator;
  const preco = oferta.precoEmbalagem;

  // Por loja: cada loja recebe embalagens inteiras (ou a granel, exato).
  let embalagens = 0n;
  let comprado = 0n;
  let custo = 0n;
  const porLoja: Celula["porLoja"] = [];
  for (const loja of item.porLoja) {
    if (oferta.fracionavel) {
      const c = totalFracionado(loja.quantidade, preco, fator);
      comprado += loja.quantidade;
      custo += c;
      porLoja.push({ unidadeId: loja.unidadeId, custo: c });
    } else {
      const n = embalagensNecessarias(loja.quantidade, fator);
      const c = totalPorEmbalagens(n, preco);
      embalagens += n;
      comprado += quantidadeDeEmbalagens(n, fator);
      custo += c;
      porLoja.push({ unidadeId: loja.unidadeId, custo: c });
    }
  }
  const adicional = comprado - necessario;
  // O quanto do custo é só o que sobra por arredondar para embalagem inteira.
  const custoAdicional =
    adicional > 0n ? custo - totalFracionado(necessario, preco, fator) : 0n;

  const calculada = {
    ...base,
    precoPorUnidade: precoPorUnidade(preco, fator),
    embalagens: oferta.fracionavel ? null : embalagens,
    comprado,
    adicional,
    custo,
    custoAdicional,
    porLoja,
  };

  if (preco === 0n && !oferta.precoZeroAutorizado) {
    return vazia("zero-sem-autorizacao", calculada);
  }
  if (oferta.disponivel !== null && oferta.disponivel < necessario) {
    return vazia("disponibilidade-insuficiente", calculada);
  }
  return { ...vazia("cotado", calculada), comparavel: true };
}

export function montarGrade(
  itens: ItemParaComparar[],
  propostas: PropostaParaComparar[],
): Grade {
  const disputados = itens.filter((i) => i.modo === "COTAVEL");

  const linhas: LinhaDaGrade[] = disputados.map((item) => {
    const necessario = somaQuantidade(item);
    const celulas = propostas.map((p) => celulaDe(item, necessario, p));
    // Menor custo entre as comparáveis; empate fica com o menor preço por
    // unidade e, persistindo, com o primeiro — não se inventa desempate.
    let melhor: Celula | null = null;
    for (const c of celulas) {
      if (!c.comparavel) continue;
      if (
        !melhor ||
        c.custo! < melhor.custo! ||
        (c.custo === melhor.custo && c.precoPorUnidade! < melhor.precoPorUnidade!)
      ) {
        melhor = c;
      }
    }
    if (melhor) melhor.menorCusto = true;
    return { item, necessario, celulas };
  });

  const fornecedores: TotalDoFornecedor[] = propostas.map((p) => {
    const minhas = linhas
      .map((l) => l.celulas.find((c) => c.fornecedorId === p.fornecedorId)!)
      .filter((c) => c.comparavel);
    const solicitados = disputados.filter((i) => p.itensSolicitados.includes(i.id));

    const porLoja = new Map<string, Centavos>();
    for (const c of minhas) {
      for (const l of c.porLoja) {
        porLoja.set(l.unidadeId, (porLoja.get(l.unidadeId) ?? 0n) + l.custo);
      }
    }
    const lojasAtendidas = [...porLoja.values()].filter((v) => v > 0n).length;
    const subtotal = minhas.reduce((s, c) => s + c.custo!, 0n);
    const freteTotal = p.frete === null ? null : p.frete * BigInt(lojasAtendidas);

    return {
      fornecedorId: p.fornecedorId,
      nome: p.nome,
      versao: p.versao,
      itensSolicitados: solicitados.length,
      itensComparaveis: minhas.length,
      completo: solicitados.length > 0 && minhas.length === solicitados.length,
      subtotal,
      lojasAtendidas,
      freteInformado: p.frete !== null,
      freteTotal,
      minimoAtendido:
        p.minimo === null || lojasAtendidas === 0
          ? null
          : [...porLoja.values()].every((v) => v === 0n || v >= p.minimo!),
      total: freteTotal === null ? null : subtotal + freteTotal,
      prazoDias: p.prazoDias,
    };
  });

  return { linhas, fornecedores };
}

// --------------------------------------------------------------- A SUGESTÃO

export type Sugestao = {
  escolhas: { itemId: string; fornecedorId: string; itemDePropostaId: string }[];
  mercadoria: Centavos;
  frete: Centavos;
  total: Centavos;
  fornecedores: string[];
  /** Fornecedores que ficaram de fora da sugestão, e por quê. */
  fora: { fornecedorId: string; motivo: string }[];
  /** Itens sem nenhuma oferta comparável entre os elegíveis. */
  semOpcao: string[];
  metodo: "combinacoes" | "por-item";
  /** Só no método por item: mínimos que a sugestão não conseguiu garantir. */
  avisos: string[];
};

export type ResultadoDaSugestao =
  | { ok: true; sugestao: Sugestao }
  | { ok: false; motivo: string; fora: Sugestao["fora"]; semOpcao: string[] };

export const MAX_FORNECEDORES_NA_COMBINACAO = 12;

export function sugerirMenorCusto(grade: Grade, propostas: PropostaParaComparar[]): ResultadoDaSugestao {
  const fora: Sugestao["fora"] = [];
  const elegiveis: PropostaParaComparar[] = [];

  for (const p of propostas) {
    const temComparavel = grade.linhas.some((l) =>
      l.celulas.some((c) => c.fornecedorId === p.fornecedorId && c.comparavel),
    );
    if (!temComparavel) continue;
    if (p.frete === null) {
      fora.push({
        fornecedorId: p.fornecedorId,
        motivo: "Frete não informado — sem ele o total não é conhecido.",
      });
      continue;
    }
    elegiveis.push(p);
  }

  const idsElegiveis = new Set(elegiveis.map((p) => p.fornecedorId));
  const linhas = grade.linhas.filter((l) =>
    l.celulas.some((c) => c.comparavel && idsElegiveis.has(c.fornecedorId)),
  );
  const semOpcao = grade.linhas
    .filter((l) => !linhas.includes(l))
    .map((l) => l.item.id);

  if (linhas.length === 0) {
    return {
      ok: false,
      motivo: "Nenhum item tem proposta comparável com frete informado.",
      fora,
      semOpcao,
    };
  }

  type Avaliacao = {
    escolhas: Map<string, Celula>;
    mercadoria: Centavos;
    frete: Centavos;
    total: Centavos;
    usados: Set<string>;
    minimosOk: boolean;
  };

  const avaliar = (permitidos: Set<string>): Avaliacao | null => {
    const escolhas = new Map<string, Celula>();
    for (const l of linhas) {
      let melhor: Celula | null = null;
      for (const c of l.celulas) {
        if (!c.comparavel || !permitidos.has(c.fornecedorId)) continue;
        if (!melhor || c.custo! < melhor.custo!) melhor = c;
      }
      if (!melhor) return null;
      escolhas.set(l.item.id, melhor);
    }

    const porFornecedorLoja = new Map<string, Map<string, Centavos>>();
    let mercadoria = 0n;
    for (const c of escolhas.values()) {
      mercadoria += c.custo!;
      const lojas = porFornecedorLoja.get(c.fornecedorId) ?? new Map<string, Centavos>();
      for (const l of c.porLoja) {
        lojas.set(l.unidadeId, (lojas.get(l.unidadeId) ?? 0n) + l.custo);
      }
      porFornecedorLoja.set(c.fornecedorId, lojas);
    }

    let frete = 0n;
    let minimosOk = true;
    for (const [fornecedorId, lojas] of porFornecedorLoja) {
      const p = elegiveis.find((x) => x.fornecedorId === fornecedorId)!;
      for (const valor of lojas.values()) {
        if (valor <= 0n) continue;
        frete += p.frete!;
        if (p.minimo !== null && valor < p.minimo) minimosOk = false;
      }
    }

    return {
      escolhas,
      mercadoria,
      frete,
      total: mercadoria + frete,
      usados: new Set(porFornecedorLoja.keys()),
      minimosOk,
    };
  };

  const empacotar = (a: Avaliacao, metodo: Sugestao["metodo"], avisos: string[]): ResultadoDaSugestao => ({
    ok: true,
    sugestao: {
      escolhas: [...a.escolhas].map(([itemId, c]) => ({
        itemId,
        fornecedorId: c.fornecedorId,
        itemDePropostaId: c.itemDePropostaId!,
      })),
      mercadoria: a.mercadoria,
      frete: a.frete,
      total: a.total,
      fornecedores: [...a.usados],
      fora,
      semOpcao,
      metodo,
      avisos,
    },
  });

  if (elegiveis.length > MAX_FORNECEDORES_NA_COMBINACAO) {
    const a = avaliar(idsElegiveis)!;
    return empacotar(a, "por-item", [
      `Com ${elegiveis.length} fornecedores, a sugestão pega o mais barato de cada item e não testa as combinações.`,
      ...(a.minimosOk ? [] : ["Algum fornecedor pode não atingir o pedido mínimo nesta sugestão — confira."]),
    ]);
  }

  let melhor: Avaliacao | null = null;
  const n = elegiveis.length;
  for (let mascara = 1; mascara < 1 << n; mascara++) {
    const permitidos = new Set(
      elegiveis.filter((_, i) => mascara & (1 << i)).map((p) => p.fornecedorId),
    );
    const a = avaliar(permitidos);
    if (!a || !a.minimosOk) continue;
    if (
      !melhor ||
      a.total < melhor.total ||
      (a.total === melhor.total && a.usados.size < melhor.usados.size)
    ) {
      melhor = a;
    }
  }

  if (!melhor) {
    return {
      ok: false,
      motivo:
        "Nenhuma combinação de fornecedores atinge os pedidos mínimos. Escolha à mão, negociando o mínimo.",
      fora,
      semOpcao,
    };
  }
  return empacotar(melhor, "combinacoes", []);
}

/** Uma escolha diferente da sugestão precisa de justificativa. */
export function precisaJustificar(
  sugestao: Sugestao | null,
  itemId: string,
  fornecedorId: string,
): boolean {
  if (!sugestao) return false;
  const sugerida = sugestao.escolhas.find((e) => e.itemId === itemId);
  return !!sugerida && sugerida.fornecedorId !== fornecedorId;
}

