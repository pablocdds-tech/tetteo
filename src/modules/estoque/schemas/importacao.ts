import { lerNumeroBr } from "@/lib/numero";

/**
 * A LEITURA DA PLANILHA COLADA.
 *
 * Função pura, sem banco, de propósito: importar duzentos e sessenta produtos
 * é a operação com maior chance de estragar tudo de uma vez, e o único jeito
 * de confiar nela é conseguir testá-la sem tocar em dado nenhum.
 *
 * Duas decisões guiam o resto do arquivo:
 *
 *   1. Uma célula ruim NÃO derruba a importação. Ela vira aviso na linha dela
 *      e as outras duzentas e sessenta seguem.
 *   2. Nada é gravado antes de a pessoa ver o que vai acontecer. É por isso
 *      que a análise devolve um plano, não um resultado.
 */

/** O lugar é escrito no fim do nome — "coca-cola lata (estoque diário)". */
const LOCAL_PADRAO = "Estoque";

/**
 * Sufixos que significam LUGAR e não sabor, tamanho ou marca.
 *
 * A lista é fechada de propósito: tratar todo parêntese como lugar
 * transformaria "coca-cola (lata)" num local chamado "lata".
 */
const LOCAIS_CONHECIDOS = [
  "estoque diário",
  "estoque diario",
  "praça",
  "praca",
  "cozinha",
  "câmara",
  "camara",
  "câmara fria",
  "camara fria",
  "bar",
  "freezer",
  "geladeira",
  "depósito",
  "deposito",
  "fina",
];

/** Como o texto da coluna vira unidade de medida do sistema. */
const MEDIDAS: Record<string, "KG" | "G" | "L" | "ML" | "UN"> = {
  kg: "KG",
  quilo: "KG",
  quilograma: "KG",
  g: "G",
  gr: "G",
  grama: "G",
  l: "L",
  lt: "L",
  litro: "L",
  ml: "ML",
  mililitro: "ML",
  un: "UN",
  und: "UN",
  unid: "UN",
  unidade: "UN",
};

export type LinhaImportada = {
  linha: number;
  nome: string;
  local: string;
  categoria: string | null;
  unidadeMedida: "KG" | "G" | "L" | "ML" | "UN";
  /** "pct", "rolo", "bisnaga" — nulo quando a medida já se explica. */
  unidadeRotulo: string | null;
  quantidade: number;
  custoMedio: number;
  custoUltimo: number;
  estoqueMinimo: number | null;
  avisos: string[];
};

export type InsumoAgrupado = {
  nome: string;
  categoria: string | null;
  unidadeMedida: "KG" | "G" | "L" | "ML" | "UN";
  unidadeRotulo: string | null;
  custoMedio: number;
  custoUltimo: number;
  estoqueMinimo: number;
  /** Um por lugar. Dois ou mais significa que linhas separadas viraram uma. */
  posicoes: {
    local: string;
    quantidade: number;
    estoqueMinimo: number | null;
  }[];
  avisos: string[];
};

export type PlanoDeImportacao = {
  linhas: LinhaImportada[];
  insumos: InsumoAgrupado[];
  locais: string[];
  /** Erros que impedem a importação inteira — cabeçalho faltando, por exemplo. */
  erroGeral: string | null;
};

/** Sem acento, sem caixa, sem espaço sobrando — para comparar rótulo de coluna. */
function normalizar(texto: string) {
  return texto.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Encontra a coluna por qualquer um dos nomes aceitos. */
function acharColuna(cabecalho: string[], nomes: string[]) {
  for (let i = 0; i < cabecalho.length; i++) {
    if (nomes.includes(normalizar(cabecalho[i]))) return i;
  }
  return -1;
}

/**
 * Separa "coca-cola lata (estoque diário)" em nome e lugar.
 *
 * É o coração da limpeza: no sistema antigo o lugar mora dentro do nome, e é
 * isso que faz o mesmo produto existir duas vezes.
 */
export function separarLocal(nomeCompleto: string) {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(nomeCompleto.trim());
  if (!m) return { nome: nomeCompleto.trim(), local: LOCAL_PADRAO };

  const possivel = normalizar(m[2]);
  if (!LOCAIS_CONHECIDOS.map(normalizar).includes(possivel)) {
    return { nome: nomeCompleto.trim(), local: LOCAL_PADRAO };
  }

  return { nome: m[1].trim(), local: titulo(m[2].trim()) };
}

function titulo(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
}

function interpretarUnidade(bruto: string) {
  const limpo = normalizar(bruto);
  const medida = MEDIDAS[limpo];
  if (medida) {
    // "und" já é o padrão de contagem — não precisa de rótulo próprio.
    return { unidadeMedida: medida, unidadeRotulo: null };
  }
  // pct, cx, rolo, bisnaga, bandeja: contam-se de um em um, mas a cozinha
  // chama pelo nome da embalagem.
  return {
    unidadeMedida: "UN" as const,
    unidadeRotulo: bruto.trim() || null,
  };
}

/**
 * Qual sinal separa os decimais NESTA planilha.
 *
 * Decidir por célula não funciona: "1.023" digitado por uma pessoa pode ser
 * mil e vinte e três, e o leitor comum recusa a dúvida — que é o certo num
 * formulário. Numa planilha, não: a coluna inteira foi escrita pelo mesmo
 * programa, com a mesma convenção.
 *
 * A pista é simples e não falha. Se aparece vírgula em qualquer número, o
 * arquivo está em português e todo ponto é separador de milhar. Se não aparece
 * nenhuma, os pontos são os decimais — é uma exportação crua, e "1.023" é um
 * real e vinte e três milésimos.
 */
type Convencao = "virgula-decimal" | "ponto-decimal";

function detectarConvencao(valores: string[]): Convencao {
  return valores.some((v) => v.includes(","))
    ? "virgula-decimal"
    : "ponto-decimal";
}

function numero(
  bruto: string,
  rotulo: string,
  avisos: string[],
  convencao: Convencao,
) {
  const texto = (bruto ?? "").trim();
  if (texto === "") return 0;

  const valor =
    convencao === "ponto-decimal"
      ? Number(texto.replace(/\s/g, ""))
      : lerNumeroBr(texto);

  if (valor === undefined || valor === null || Number.isNaN(valor)) {
    avisos.push(`${rotulo} não foi entendido ("${bruto}") — entrou como zero.`);
    return 0;
  }
  if (valor < 0) {
    avisos.push(`${rotulo} veio negativo ("${bruto}") — entrou como zero.`);
    return 0;
  }
  return valor;
}

export function analisarPlanilha(textoBruto: string): PlanoDeImportacao {
  const vazio: PlanoDeImportacao = {
    linhas: [],
    insumos: [],
    locais: [],
    erroGeral: null,
  };

  const linhasDeTexto = textoBruto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");

  if (linhasDeTexto.length < 2) {
    return {
      ...vazio,
      erroGeral:
        "Cole pelo menos o cabeçalho e uma linha de produto. Copie a planilha inteira, do título das colunas para baixo.",
    };
  }

  // Excel copia separando por TAB; planilha exportada costuma vir com ponto e
  // vírgula. Descobrir qual é evita pedir para a pessoa converter o arquivo.
  const primeira = linhasDeTexto[0];
  const separador = primeira.includes("\t")
    ? "\t"
    : primeira.includes(";")
      ? ";"
      : ",";

  const cabecalho = primeira.split(separador).map((c) => c.trim());

  const iNome = acharColuna(cabecalho, [
    "produto",
    "nome",
    "descricao",
    "item",
  ]);
  const iUnidade = acharColuna(cabecalho, ["unidade", "un", "medida"]);

  if (iNome === -1) {
    return {
      ...vazio,
      erroGeral:
        'Não encontrei a coluna do nome. O cabeçalho precisa ter "Produto" ou "Nome".',
    };
  }
  if (iUnidade === -1) {
    return {
      ...vazio,
      erroGeral:
        'Não encontrei a coluna da unidade. O cabeçalho precisa ter "Unidade".',
    };
  }

  const iQuantidade = acharColuna(cabecalho, ["quantidade", "qtd", "estoque"]);
  const iUltimo = acharColuna(cabecalho, ["ultimo preco", "preco", "custo"]);
  const iMedio = acharColuna(cabecalho, ["preco medio", "custo medio"]);
  const iMinimo = acharColuna(cabecalho, ["estoque minimo", "minimo", "min"]);
  const iCategoria = acharColuna(cabecalho, [
    "categorias",
    "categoria",
    "grupo",
  ]);
  const iLocal = acharColuna(cabecalho, ["local", "lugar", "setor"]);

  const pegar = (celulas: string[], i: number) =>
    i === -1 ? "" : (celulas[i] ?? "").trim();

  const corpo = linhasDeTexto.slice(1).map((l) => l.split(separador));

  // Uma passada só para descobrir a convenção, olhando TODAS as colunas
  // numéricas juntas: um arquivo não mistura vírgula e ponto decimal.
  const convencao = detectarConvencao(
    corpo.flatMap((celulas) =>
      [iQuantidade, iUltimo, iMedio, iMinimo]
        .filter((i) => i !== -1)
        .map((i) => pegar(celulas, i)),
    ),
  );

  const linhas: LinhaImportada[] = [];

  for (let n = 1; n < linhasDeTexto.length; n++) {
    const celulas = linhasDeTexto[n].split(separador);
    const nomeBruto = pegar(celulas, iNome);
    if (!nomeBruto) continue;

    const avisos: string[] = [];
    const separado = separarLocal(nomeBruto);
    const localDaColuna = pegar(celulas, iLocal);

    const unidade = interpretarUnidade(pegar(celulas, iUnidade));

    const minimoBruto = pegar(celulas, iMinimo);
    const minimo =
      minimoBruto === ""
        ? null
        : numero(minimoBruto, "O estoque mínimo", avisos, convencao);

    const custoUltimo = numero(
      pegar(celulas, iUltimo),
      "O preço",
      avisos,
      convencao,
    );
    const custoMedio = numero(
      pegar(celulas, iMedio),
      "O preço médio",
      avisos,
      convencao,
    );

    if (custoUltimo === 0 && custoMedio === 0) {
      avisos.push("Sem preço — não entra em valor de estoque nem no CMV.");
    }

    linhas.push({
      linha: n + 1,
      nome: separado.nome,
      local: localDaColuna ? titulo(localDaColuna) : separado.local,
      categoria: pegar(celulas, iCategoria) || null,
      unidadeMedida: unidade.unidadeMedida,
      unidadeRotulo: unidade.unidadeRotulo,
      quantidade: numero(
        pegar(celulas, iQuantidade),
        "A quantidade",
        avisos,
        convencao,
      ),
      custoMedio,
      custoUltimo,
      estoqueMinimo: minimo,
      avisos,
    });
  }

  return { ...vazio, ...agrupar(linhas) };
}

/**
 * Junta as linhas que são o mesmo produto em lugares diferentes.
 *
 * O critério de fusão é nome + unidade de medida. Se duas linhas têm o mesmo
 * nome mas medidas diferentes — "mussarela" em kg no depósito e "mussarela" em
 * unidades já porcionadas na praça — elas NÃO são a mesma coisa, e juntá-las
 * somaria quilo com saquinho. Nesse caso o lugar volta para o nome e as duas
 * seguem separadas, com aviso.
 */
function agrupar(linhas: LinhaImportada[]) {
  const porChave = new Map<string, InsumoAgrupado>();
  const locais = new Set<string>();

  for (const linha of linhas) {
    locais.add(linha.local);
    const chave = `${normalizar(linha.nome)}|${linha.unidadeMedida}`;
    const existente = porChave.get(chave);

    if (!existente) {
      porChave.set(chave, {
        nome: linha.nome,
        categoria: linha.categoria,
        unidadeMedida: linha.unidadeMedida,
        unidadeRotulo: linha.unidadeRotulo,
        custoMedio: linha.custoMedio,
        custoUltimo: linha.custoUltimo,
        estoqueMinimo: linha.estoqueMinimo ?? 0,
        posicoes: [
          {
            local: linha.local,
            quantidade: linha.quantidade,
            estoqueMinimo: linha.estoqueMinimo,
          },
        ],
        avisos: [...linha.avisos],
      });
      continue;
    }

    // Mesmo produto, outro lugar.
    const mesmoLocal = existente.posicoes.find((p) => p.local === linha.local);
    if (mesmoLocal) {
      mesmoLocal.quantidade += linha.quantidade;
      existente.avisos.push(
        `Duas linhas para "${linha.nome}" no mesmo lugar (${linha.local}) — as quantidades foram somadas.`,
      );
    } else {
      existente.posicoes.push({
        local: linha.local,
        quantidade: linha.quantidade,
        estoqueMinimo: linha.estoqueMinimo,
      });
    }

    // O preço fica com o maior valor conhecido: zero quase sempre significa
    // "ninguém preencheu", não "é de graça".
    existente.custoMedio = Math.max(existente.custoMedio, linha.custoMedio);
    existente.custoUltimo = Math.max(existente.custoUltimo, linha.custoUltimo);
    existente.categoria ??= linha.categoria;
    existente.unidadeRotulo ??= linha.unidadeRotulo;
    existente.avisos.push(...linha.avisos);
  }

  // Nome repetido com medidas diferentes: desfaz a suposição e separa.
  const porNome = new Map<string, InsumoAgrupado[]>();
  for (const insumo of porChave.values()) {
    const nome = normalizar(insumo.nome);
    if (!porNome.has(nome)) porNome.set(nome, []);
    porNome.get(nome)!.push(insumo);
  }

  for (const [, iguais] of porNome) {
    if (iguais.length < 2) continue;
    for (const insumo of iguais) {
      const local = insumo.posicoes[0]?.local ?? LOCAL_PADRAO;
      insumo.avisos.push(
        `Existe outro "${insumo.nome}" com unidade de medida diferente. Como quilo e pacote não se somam, este ficou separado.`,
      );
      if (local !== LOCAL_PADRAO) insumo.nome = `${insumo.nome} (${local})`;
    }
  }

  return {
    linhas,
    insumos: [...porChave.values()].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    ),
    locais: [...locais].sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}
