/**
 * O FATO "FECHAMENTO CONCLUÍDO", como o Checklists o conta à Severina.
 *
 * Quem sabe o que é um fechamento é o Checklists: o nome do modelo, a nota,
 * o que ficou fora do padrão. A Severina recebe as linhas prontas e as põe
 * num rascunho de aviso — ela não conhece nota de checklist, e não precisa.
 *
 * "Fechamento" é reconhecido pelo NOME do modelo. É uma convenção à vista de
 * todos, e o dono controla: modelo que tiver a palavra no nome gera o aviso.
 */

/**
 * Os acentos que o `normalize("NFD")` separa da letra: a faixa U+0300–U+036F.
 * Montada por código de propósito — escrita literal, a faixa fica invisível
 * no editor e ninguém entende o que a linha faz.
 */
const ACENTOS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  "g",
);

export function ehModeloDeFechamento(nome: string): boolean {
  return nome
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toLowerCase()
    .includes("fechamento");
}

function formatarPontuacao(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    valor,
  );
}

/**
 * As linhas do aviso, no fuso DA LOJA. O fechamento das 23h41 não pode
 * chegar ao gerente como "02h41" só porque o servidor pensa em UTC.
 */
export function linhasDoFechamento({
  loja,
  modelo,
  fechadaEm,
  fuso,
  quem,
  pontuacao,
  naoConformes,
}: {
  loja: string;
  modelo: string;
  fechadaEm: Date;
  fuso: string;
  quem: string | null;
  pontuacao: number | null;
  naoConformes: number;
}): string[] {
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
  }).format(fechadaEm);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(fechadaEm);

  const itens =
    naoConformes === 0
      ? "tudo no padrão"
      : `${naoConformes} ${naoConformes === 1 ? "item" : "itens"} fora do padrão`;

  // Checklist só de temperatura não tem nota — e inventar uma seria mentira.
  const nota =
    pontuacao === null
      ? naoConformes > 0
        ? `Sem nota · ${itens}`
        : "Sem nota (só registros)"
      : `Nota: ${formatarPontuacao(pontuacao)}% · ${itens}`;

  return [
    `Loja: ${loja}`,
    `Checklist: ${modelo}`,
    `Concluído em ${data} às ${hora}${quem ? ` por ${quem}` : ""}`,
    nota,
  ];
}
