import { createHash } from "node:crypto";
import {
  casarProdutoFiscal,
  casarFornecedorFiscal,
  type VinculoFiscal,
} from "@/server/notas/casamento";

import {
  notaAssistidaPronta,
  type NotaAssistidaPronta,
} from "@/server/nota-assistida-contrato";

export type ItemConferido = {
  descricao: string;
  quantidade: number;
  unidade: string;
  valorTotal: number;
  insumoId?: string;
  novoInsumo?: { nome: string; unidadeMedida: "KG" | "L" | "UN" };
  fatorConversao?: number;
  exigirVinculo?: boolean;
  valorBruto?: number;
  valorUnitarioImpresso?: number;
  codigoFornecedor?: string;
  ean?: string;
};
export type RascunhoNota = {
  operacaoId: string;
  arquivoId?: string;
  fornecedor: { nome: string; documento?: string };
  numero?: string;
  serie?: string;
  chaveAcesso?: string;
  emitidaEm?: string;
  recebidaEm: string;
  valorTotal: number;
  itens: ItemConferido[];
  localId?: string;
  empresaId?: string;
  categoriaId?: string;
  fiscal?: {
    descontos: number;
    acrescimos: number;
    ajusteArredondamento: number;
  };
  fornecedorNovo?: boolean;
  pagamento: {
    situacao?: "PAGA" | "A_PAGAR";
    forma?: NotaAssistidaPronta["pagamento"]["forma"];
    contaId?: string;
    dataPagamento?: string;
    parcelas?: { vencimento: string; valor: number }[];
  };
};
type Opcao = { nome: string; valor: string };
export type PerguntaNota = {
  campo: string;
  texto: string;
  opcoes?: Opcao[];
  item?: number;
};
export type CatalogoNota = {
  unidade: string;
  empresas: Opcao[];
  categorias: Opcao[];
  locais: Opcao[];
  contas: (Opcao & { empresaId: string | null })[];
  insumos: {
    id: string;
    nome: string;
    unidadeMedida: string;
  }[];
  podeCriarInsumo: boolean;
  vinculos?: VinculoFiscal[];
  fornecedores?: {
    id: string;
    nome: string;
    documento: string | null;
    ativo: boolean;
  }[];
};

export function normalizarDescricaoNota(v: string): string {
  return v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 200);
}
export function hashPropostaNota(dados: NotaAssistidaPronta): string {
  return createHash("sha256").update(JSON.stringify(dados)).digest("hex");
}
export function dataConferencia(v: string): string | null {
  const s = v.trim();
  const br = /^(\d{2})\/(\d{2})\/(20\d{2})$/.exec(s);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : s;
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}
function numero(v: string): number | null {
  const s = v.trim().replace(/^R\$\s*/, "");
  const n = Number(
    s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s,
  );
  return Number.isFinite(n) && n > 0 && n <= 999_999_999 ? n : null;
}
const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (v: string) => v.split("-").reverse().join("/");
export function perguntaComOpcoes(p: PerguntaNota): string {
  return [
    p.texto,
    ...(p.opcoes ?? []).map((o, i) => `${i + 1}. ${o.nome}`),
  ].join("\n");
}
function escolher(
  campo: string,
  texto: string,
  opcoes: Opcao[],
  item?: number,
): PerguntaNota {
  return {
    campo,
    texto: `${texto}\nResponda com o número da opção.`,
    opcoes,
    ...(item === undefined ? {} : { item }),
  };
}
const formas: Opcao[] = [
  ["Pix", "PIX"],
  ["Boleto", "BOLETO"],
  ["Dinheiro", "DINHEIRO"],
  ["Cartão de crédito", "CREDITO"],
  ["Cartão de débito", "DEBITO"],
  ["Transferência", "TED"],
  ["Débito em conta", "DEBITO_CONTA"],
  ["Outra", "OUTRO"],
].map(([nome, valor]) => ({ nome, valor }));

/** Cada opção é persistida com a pergunta; alterações de catálogo não trocam a resposta. */
export function prepararConferencia(
  r: RascunhoNota,
  c: CatalogoNota,
): PerguntaNota | null {
  if (r.fornecedor.nome.trim().length < 2)
    return {
      campo: "fornecedor",
      texto: "Não consegui ler o fornecedor. Qual é o nome completo?",
    };
  if (!r.emitidaEm)
    return {
      campo: "emitidaEm",
      texto: "Qual é a data de emissão da nota? Informe DD/MM/AAAA.",
    };
  if (!r.numero && !r.chaveAcesso)
    return {
      campo: "numero",
      texto:
        "Não consegui ler o número fiscal. Qual é o número da nota ou cupom? Ele ajuda a impedir lançamentos repetidos.",
    };
  if (r.fiscal) {
    const fornecedor = casarFornecedorFiscal(
      r.fornecedor.documento,
      r.fornecedor.nome,
      c.fornecedores ?? [],
    );
    r.fornecedorNovo = fornecedor.estado === "NOVO";
    if (!["NOVO", "EXISTENTE"].includes(fornecedor.estado))
      return {
        campo: "conferencia",
        texto:
          "A identidade do fornecedor precisa de revisão. Confira o CNPJ e os cadastros ativos no sistema; depois responda RESUMO.",
      };
  }
  for (const [campo, lista, titulo] of [
    ["empresaId", c.empresas, "Qual empresa/CNPJ comprou?"],
    ["localId", c.locais, "Onde os produtos recebidos foram guardados?"],
    [
      "categoriaId",
      c.categorias,
      "Em qual categoria financeira entra esta compra?",
    ],
  ] as const) {
    if (r[campo] && !lista.some((o) => o.valor === r[campo])) delete r[campo];
    if (!r[campo]) {
      if (lista.length === 1) r[campo] = lista[0].valor;
      else
        return escolher(
          campo,
          lista.length
            ? titulo
            : `${titulo}\nNão há cadastro disponível. Cadastre no sistema e responda RESUMO.`,
          lista,
        );
    }
  }
  for (const [i, item] of r.itens.entries()) {
    if (item.insumoId && !c.insumos.some((s) => s.id === item.insumoId)) {
      delete item.insumoId;
      delete item.fatorConversao;
    }
    if (item.novoInsumo && !c.podeCriarInsumo) delete item.novoInsumo;
    if (!item.insumoId && !item.novoInsumo) {
      const casamento = r.fiscal
        ? casarProdutoFiscal(
            {
              descricao: item.descricao,
              unidade: item.unidade,
              codigoFornecedor: item.codigoFornecedor,
              ean: item.ean,
            },
            r.fornecedor.documento ?? "",
            c.insumos,
            c.vinculos ?? [],
          )
        : null;
      if (!item.exigirVinculo && casamento?.vinculo) {
        item.insumoId = casamento.vinculo.insumoId;
        if (!casamento.confirmarConversao)
          item.fatorConversao = casamento.vinculo.fator;
      }
      const exato =
        !r.fiscal &&
        !item.exigirVinculo &&
        c.insumos.find(
          (s) =>
            normalizarDescricaoNota(s.nome) ===
            normalizarDescricaoNota(item.descricao),
        );
      if (exato) item.insumoId = exato.id;
      else if (!item.insumoId) {
        const termos = normalizarDescricaoNota(item.descricao)
          .split(" ")
          .filter((t) => t.length > 2);
        const parecidos = c.insumos
          .map((s) => ({
            ...s,
            score: termos.filter((t) =>
              normalizarDescricaoNota(s.nome).includes(t),
            ).length,
          }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome))
          .slice(0, 8);
        const opcoes = (casamento?.candidatos ?? parecidos).map((s) => ({
          nome: `${s.nome} (${s.unidadeMedida})`,
          valor: s.id,
        }));
        if (c.podeCriarInsumo)
          opcoes.push({
            nome: `Cadastrar novo: ${item.descricao}`,
            valor: "NOVO",
          });
        return escolher(
          "insumo",
          `Item ${i + 1}: ${item.descricao}, ${item.quantidade} ${item.unidade}. Qual produto corresponde?${opcoes.length ? "" : "\nNão encontrei correspondência. Responda BUSCAR seguido do nome do produto."}`,
          opcoes,
          i,
        );
      }
    }
    const unidadeBase =
      item.novoInsumo?.unidadeMedida ??
      c.insumos.find((s) => s.id === item.insumoId)?.unidadeMedida;
    if (!item.fatorConversao) {
      const un = item.unidade.toUpperCase().trim();
      if (un === unidadeBase) item.fatorConversao = 1;
      else if (
        (un === "G" && unidadeBase === "KG") ||
        (un === "ML" && unidadeBase === "L")
      )
        item.fatorConversao = 0.001;
      else if (
        (un === "KG" && unidadeBase === "G") ||
        (un === "L" && unidadeBase === "ML")
      )
        item.fatorConversao = 1000;
      else
        return {
          campo: "fator",
          item: i,
          texto: `Item ${i + 1}: cada ${item.unidade} de ${item.descricao} equivale a quantos ${unidadeBase}? Exemplo: caixa com 12 unidades = 12. Vou guardar essa conversão depois da confirmação.`,
        };
    }
  }
  if (!r.pagamento.situacao)
    return escolher(
      "situacao",
      "Esta compra já foi paga? A foto sozinha não confirma a saída de dinheiro.",
      [
        { nome: "Já paga", valor: "PAGA" },
        { nome: "A pagar", valor: "A_PAGAR" },
      ],
    );
  if (!r.pagamento.forma)
    return escolher("forma", "Qual é a forma de pagamento?", formas);
  if (r.pagamento.situacao === "PAGA") {
    const contas = c.contas.filter((o) => o.empresaId === r.empresaId);
    if (
      r.pagamento.contaId &&
      !contas.some((o) => o.valor === r.pagamento.contaId)
    )
      delete r.pagamento.contaId;
    if (!r.pagamento.contaId) {
      if (contas.length === 1) r.pagamento.contaId = contas[0].valor;
      else
        return escolher(
          "contaId",
          contas.length
            ? "De qual conta saiu o pagamento?"
            : "Cadastre uma conta da empresa no Financeiro e responda RESUMO.",
          contas,
        );
    }
    if (!r.pagamento.dataPagamento)
      return {
        campo: "dataPagamento",
        texto: "Em que data a compra foi paga? Informe DD/MM/AAAA.",
      };
    r.pagamento.parcelas = [
      { vencimento: r.pagamento.dataPagamento, valor: r.valorTotal },
    ];
  } else if (!r.pagamento.parcelas?.length)
    return {
      campo: "parcelas",
      texto: `Quando vence? Para uma parcela, envie DD/MM/AAAA. Se forem várias, envie data e valor de cada uma, separados por ponto e vírgula. Ex.: 10/11/2026 100,00; 10/12/2026 100,00. Total: ${moeda(r.valorTotal)}.`,
    };
  const proposta = propostaDaConferencia(r);
  const validacao = notaAssistidaPronta.safeParse(proposta);
  if (!validacao.success)
    return {
      campo: "conferencia",
      texto: `Preciso de uma correção antes de lançar: ${validacao.error.issues[0]?.message}\nUse CORRIGIR TOTAL 123,45 ou CORRIGIR ITEM 1 VALOR 123,45. Para dados pouco legíveis, envie CANCELAR e uma foto mais nítida.`,
    };
  return null;
}

export function propostaDaConferencia(r: RascunhoNota): unknown {
  const { fornecedorNovo: _fornecedorNovo, ...dados } = r;
  void _fornecedorNovo;
  return {
    ...dados,
    itens: r.itens.map((i) => ({
      descricao: i.descricao,
      insumoId: i.insumoId,
      novoInsumo: i.novoInsumo,
      quantidade: i.quantidade,
      fatorConversao: i.fatorConversao,
      valorTotal: i.valorTotal,
      ...(i.valorBruto === undefined ? {} : { valorBruto: i.valorBruto }),
      ...(i.valorUnitarioImpresso === undefined
        ? {}
        : { valorUnitarioImpresso: i.valorUnitarioImpresso }),
      ...(i.codigoFornecedor ? { codigoFornecedor: i.codigoFornecedor } : {}),
      ...(i.ean ? { ean: i.ean } : {}),
    })),
  };
}

export function responderConferencia(
  r: RascunhoNota,
  p: PerguntaNota | null,
  texto: string,
  c: CatalogoNota,
): string | null {
  const s = texto.trim();
  let m =
    /^corrigir\s+item\s+(\d+)\s+(quantidade|valor|nome|unidade)\s+(.+)$/i.exec(
      s,
    );
  if (m) {
    const item = r.itens[Number(m[1]) - 1];
    if (!item) return "Não encontrei esse item na nota.";
    const campo = m[2].toLowerCase();
    if (campo === "nome") {
      item.descricao = m[3].slice(0, 120);
      delete item.insumoId;
      delete item.novoInsumo;
      delete item.fatorConversao;
    } else if (campo === "unidade") {
      item.unidade = m[3].toUpperCase().slice(0, 20);
      delete item.fatorConversao;
    } else {
      const n = numero(m[3]);
      if (!n) return "Informe um valor positivo.";
      if (campo === "valor") item.valorTotal = n;
      else item.quantidade = n;
    }
    return null;
  }
  m = /^corrigir\s+(fornecedor|numero|data|total)\s+(.+)$/i.exec(s);
  if (m) {
    switch (m[1].toLowerCase()) {
      case "fornecedor":
        r.fornecedor = { nome: m[2].slice(0, 120) };
        break;
      case "numero":
        r.numero = m[2].slice(0, 30);
        break;
      case "data": {
        const d = dataConferencia(m[2]);
        if (!d) return "Informe uma data válida em DD/MM/AAAA.";
        r.emitidaEm = d;
        break;
      }
      case "total": {
        const n = numero(m[2]);
        if (!n) return "Informe um total positivo.";
        r.valorTotal = n;
        delete r.pagamento.parcelas;
        break;
      }
    }
    return null;
  }
  m =
    /^(?:trocar|alterar)\s+(pagamento|local|empresa|categoria|conta|item\s+\d+)$/i.exec(
      s,
    );
  if (m) {
    const campo = m[1].toLowerCase();
    if (campo === "pagamento") r.pagamento = {};
    else if (campo === "local") delete r.localId;
    else if (campo === "empresa") {
      delete r.empresaId;
      delete r.pagamento.contaId;
    } else if (campo === "categoria") delete r.categoriaId;
    else if (campo === "conta") delete r.pagamento.contaId;
    else {
      const item = r.itens[Number(campo.split(" ")[1]) - 1];
      if (!item) return "Item inexistente.";
      delete item.insumoId;
      delete item.novoInsumo;
      delete item.fatorConversao;
      item.exigirVinculo = true;
    }
    return null;
  }
  if (/^(resumo|ajuda)$/i.test(s)) return null;
  if (!p)
    return "Para lançar, responda CONFIRMAR seguido do código do resumo. Para corrigir: CORRIGIR ITEM 1 QUANTIDADE 2; CORRIGIR ITEM 1 VALOR 20,00; ALTERAR PAGAMENTO; ALTERAR LOCAL. CANCELAR descarta o rascunho.";
  if (/^buscar\s+.{2,}$/i.test(s) && p.campo === "insumo") {
    const termo = normalizarDescricaoNota(s.slice(7));
    p.opcoes = c.insumos
      .filter((i) => normalizarDescricaoNota(i.nome).includes(termo))
      .slice(0, 20)
      .map((i) => ({ nome: `${i.nome} (${i.unidadeMedida})`, valor: i.id }));
    if (c.podeCriarInsumo)
      p.opcoes.push({ nome: "Cadastrar novo produto", valor: "NOVO" });
    return perguntaComOpcoes(p);
  }
  let valor = s;
  if (p.opcoes) {
    const indice = /^\d+$/.test(s) ? Number(s) - 1 : -1;
    const opcao =
      p.opcoes[indice] ??
      p.opcoes.find(
        (o) => normalizarDescricaoNota(o.nome) === normalizarDescricaoNota(s),
      );
    if (!opcao)
      return "Escolha uma das opções pelo número. Para procurar outro produto, responda BUSCAR e o nome.";
    valor = opcao.valor;
  }
  const item = p.item === undefined ? undefined : r.itens[p.item];
  switch (p.campo) {
    case "fornecedor":
      if (s.length < 2) return "Informe o nome completo.";
      r.fornecedor = { nome: s.slice(0, 120) };
      break;
    case "numero":
      if (!s || s.length > 30)
        return "Informe o número fiscal com até 30 caracteres.";
      r.numero = s;
      break;
    case "emitidaEm":
    case "dataPagamento": {
      const d = dataConferencia(s);
      if (!d) return "Data inválida. Informe DD/MM/AAAA.";
      if (p.campo === "emitidaEm") r.emitidaEm = d;
      else r.pagamento.dataPagamento = d;
      break;
    }
    case "empresaId":
      r.empresaId = valor;
      break;
    case "localId":
      r.localId = valor;
      break;
    case "categoriaId":
      r.categoriaId = valor;
      break;
    case "contaId":
      r.pagamento.contaId = valor;
      break;
    case "situacao":
      r.pagamento.situacao = valor as "PAGA" | "A_PAGAR";
      break;
    case "forma":
      r.pagamento.forma = valor as NotaAssistidaPronta["pagamento"]["forma"];
      break;
    case "insumo": {
      if (!item) return "Item não encontrado.";
      if (valor === "NOVO") {
        p.campo = "unidadeNova";
        p.texto = `Qual será a unidade de estoque de ${item.descricao}?`;
        p.opcoes = [
          { nome: "Quilos (KG)", valor: "KG" },
          { nome: "Litros (L)", valor: "L" },
          { nome: "Unidades (UN)", valor: "UN" },
        ];
        return perguntaComOpcoes(p);
      }
      item.insumoId = valor;
      delete item.novoInsumo;
      delete item.fatorConversao;
      break;
    }
    case "unidadeNova":
      if (item)
        item.novoInsumo = {
          nome: item.descricao.slice(0, 120),
          unidadeMedida: valor as "KG" | "L" | "UN",
        };
      break;
    case "fator": {
      const n = numero(s);
      if (!n || !item) return "Informe uma conversão positiva.";
      item.fatorConversao = n;
      break;
    }
    case "parcelas": {
      const unica = dataConferencia(s);
      if (unica)
        r.pagamento.parcelas = [{ vencimento: unica, valor: r.valorTotal }];
      else {
        const parcelas = s.split(";").map((parte) => {
          const m = /^(\S+)\s+(.+)$/.exec(parte.trim());
          const d = m && dataConferencia(m[1]);
          const n = m && numero(m[2]);
          return d && n ? { vencimento: d, valor: n } : null;
        });
        if (!parcelas.length || parcelas.some((p) => !p))
          return "Envie cada parcela como DD/MM/AAAA 123,45, separadas por ponto e vírgula.";
        r.pagamento.parcelas = parcelas as {
          vencimento: string;
          valor: number;
        }[];
      }
      break;
    }
    default:
      return "Confira o resumo e envie a correção indicada ou CANCELAR para enviar outra foto.";
  }
  return null;
}

export function resumoConferencia(r: RascunhoNota, c: CatalogoNota): string {
  const nome = (lista: Opcao[], id?: string) =>
    lista.find((i) => i.valor === id)?.nome ?? "a definir";
  return [
    `Conferência da nota${r.numero ? ` ${r.numero}` : ""}`,
    `Fornecedor: ${r.fornecedor.nome}${r.fornecedor.documento ? ` (${r.fornecedor.documento})` : ""}`,
    `Emissão: ${r.emitidaEm ? dia(r.emitidaEm) : "a conferir"} · Unidade: ${c.unidade}`,
    ...r.itens.map(
      (i, n) =>
        `${n + 1}. ${i.descricao}: ${i.quantidade} ${i.unidade} · ${moeda(i.valorTotal)}${i.valorBruto !== undefined ? ` líquido rateado (bruto impresso ${moeda(i.valorBruto)})` : ""}${i.novoInsumo ? " · NOVO CADASTRO" : ""}${i.fatorConversao ? ` → ${Number((i.quantidade * i.fatorConversao).toFixed(3))} ${i.novoInsumo?.unidadeMedida ?? c.insumos.find((s) => s.id === i.insumoId)?.unidadeMedida ?? ""} de ${i.novoInsumo?.nome ?? c.insumos.find((s) => s.id === i.insumoId)?.nome ?? "produto a conferir"}` : ""}`,
    ),
    `Total: ${moeda(r.valorTotal)}`,
    `Empresa: ${nome(c.empresas, r.empresaId)} · Categoria: ${nome(c.categorias, r.categoriaId)}`,
    `Entrada em: ${nome(c.locais, r.localId)} · Recebimento: ${dia(r.recebidaEm)}`,
    `Financeiro: ${r.pagamento.situacao === "PAGA" ? `paga${r.pagamento.dataPagamento ? ` em ${dia(r.pagamento.dataPagamento)}` : ""} · Conta: ${nome(c.contas, r.pagamento.contaId)}` : r.pagamento.situacao === "A_PAGAR" ? "a pagar" : "a conferir"}${r.pagamento.forma ? ` · ${r.pagamento.forma}` : ""}`,
    ...(r.pagamento.parcelas ?? []).map(
      (p, i) => `Parcela ${i + 1}: ${moeda(p.valor)} · ${dia(p.vencimento)}`,
    ),
  ].join("\n");
}

export function resumoCurtoConferencia(
  r: RascunhoNota,
  c: CatalogoNota,
): string {
  const nome = (lista: Opcao[], id?: string) =>
    lista.find((v) => v.valor === id)?.nome ?? "a definir";
  return [
    `Conferência da nota${r.numero ? ` ${r.numero}` : ""}`,
    `Fornecedor: ${r.fornecedor.nome}${r.fornecedor.documento ? ` (${r.fornecedor.documento})` : ""}${r.fornecedorNovo ? " · NOVO CADASTRO na confirmação" : ""}`,
    `Itens: ${r.itens.length} · Novos produtos: ${r.itens.filter((i) => i.novoInsumo).length} · Total: ${moeda(r.valorTotal)}`,
    ...(r.fiscal
      ? [
          `Descontos: ${moeda(r.fiscal.descontos)} · Acréscimos: ${moeda(r.fiscal.acrescimos)}${r.fiscal.ajusteArredondamento ? ` · Arredondamento: ${moeda(r.fiscal.ajusteArredondamento)}` : ""}`,
        ]
      : []),
    `Financeiro: ${r.pagamento.situacao === "PAGA" ? "já paga" : r.pagamento.situacao === "A_PAGAR" ? "a pagar" : "a conferir"} · Forma: ${r.pagamento.forma ?? "a conferir"} · Parcelas: ${r.pagamento.parcelas?.length ?? "a definir"}`,
    ...(r.pagamento.parcelas ?? []).map(
      (p, i) => `${i + 1}: ${moeda(p.valor)} · ${dia(p.vencimento)}`,
    ),
    `Unidade: ${c.unidade} · Empresa: ${nome(c.empresas, r.empresaId)} · Local: ${nome(c.locais, r.localId)}`,
    r.pagamento.situacao === "PAGA"
      ? `Conta: ${nome(c.contas, r.pagamento.contaId)} · Pagamento: ${r.pagamento.dataPagamento ? dia(r.pagamento.dataPagamento) : "a conferir"}`
      : "",
    "Para conferir todos os itens, quantidades e conversões, responda ITENS. A confirmação declara que os produtos foram recebidos.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function confirmacaoVigente(d: {
  texto: string;
  codigo: string | null;
  resumoEm: Date | null;
  expiraEm: Date | null;
  recebidoEm: Date;
  agora: Date;
  hash: string | null;
  proposta: NotaAssistidaPronta;
}): boolean {
  return (
    !!d.codigo &&
    [`CONFIRMAR ${d.codigo}`, `OK ${d.codigo}`].includes(
      d.texto.trim().toUpperCase(),
    ) &&
    !!d.resumoEm &&
    !!d.expiraEm &&
    d.recebidoEm > d.resumoEm &&
    d.recebidoEm <= d.agora &&
    d.expiraEm > d.agora &&
    d.hash === hashPropostaNota(d.proposta)
  );
}
