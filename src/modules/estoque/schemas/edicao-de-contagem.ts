/**
 * QUEM CHEGOU PRIMEIRO NA PRATELEIRA.
 *
 * Duas pessoas contam a mesma folha: uma a câmara fria, outra o depósito, cada
 * uma no seu celular. As duas abriram a folha às dez horas. A Ana conta a
 * mussarela, digita 12 kg e salva às dez e cinco. Eu salvo às dez e dez.
 *
 * Antes desta regra, o meu formulário mandava TODOS os campos — inclusive a
 * mussarela, que na minha tela ainda estava em branco. O banco recebia "em
 * branco" e apagava os 12 kg da Ana. Sem erro, sem aviso: a contagem dela
 * simplesmente sumia, e o CMV da semana saía errado.
 *
 * ---------------------------------------------------------------------------
 * A REGRA.
 *
 * Cada campo viaja com a sua BASE: o número que ele mostrava quando a folha
 * foi desenhada. Com isso, cada linha cai em um de quatro casos:
 *
 *   não mexi                              → não escreve nada
 *   mexi, e o banco ainda está na base    → grava
 *   mexi, e o banco já tem o MEU número   → nada a fazer (contamos igual)
 *   mexi, e o banco mudou para OUTRO      → CONFLITO: não grava, e avisa
 *
 * O último caso nunca se resolve sozinho. Quem decide qual número vale é
 * quem está com a caixa na frente — o sistema só garante que ninguém
 * descubra a divergência depois do fechamento.
 * ---------------------------------------------------------------------------
 *
 * É uma função pura, sem banco, para poder ser testada caso a caso. O serviço
 * lê o banco, pergunta aqui o que fazer, e ainda repete a checagem na própria
 * escrita (`updateMany` com a base no filtro) — porque entre ler e gravar
 * existe um instante em que uma terceira pessoa pode salvar.
 */

/** Uma linha como veio do formulário. */
export type EdicaoRecebida = {
  insumoId: string;
  /** O que ficou no campo. `null` é em branco — "não contei". */
  valor: number | null;
  /** O que o campo mostrava quando a folha foi desenhada. */
  base: number | null;
};

/** O que o banco tem AGORA para aquela linha. */
export type ValorNoBanco = {
  quantidade: number | null;
  contadoPorId: string | null;
  contadoEm: Date | null;
};

export type EscritaAprovada = {
  insumoId: string;
  valor: number | null;
  /** Vai junto para a escrita condicional: só grava se o banco ainda for isto. */
  base: number | null;
};

export type Conflito = {
  insumoId: string;
  /** O que eu tentei gravar. */
  tentado: number | null;
  /** O que outra pessoa gravou enquanto eu contava. */
  noBanco: number | null;
  contadoPorId: string | null;
  contadoEm: Date | null;
};

/** O conflito do jeito que a tela precisa: com nome, unidade e horário. */
export type ConflitoNaFolha = {
  insumoId: string;
  nome: string;
  unidade: string;
  tentado: number | null;
  noBanco: number | null;
  /** O nome de quem contou. `null` quando o campo foi apagado. */
  porQuem: string | null;
  /** ISO. Texto, e não `Date`, porque atravessa a fronteira da ação. */
  quando: string | null;
};

/**
 * Mesmo número até a terceira casa — a precisão da coluna no banco.
 *
 * E EM BRANCO NÃO É ZERO: `null` só é igual a `null`. Tratar os dois como
 * iguais faria "acabou" e "não contei" se confundirem justamente na regra que
 * decide se a contagem de alguém pode ser sobrescrita.
 */
export function mesmaQuantidade(a: number | null, b: number | null) {
  if (a === null || b === null) return a === b;
  return Math.round(a * 1000) === Math.round(b * 1000);
}

export function classificarEdicoes(
  recebidas: EdicaoRecebida[],
  banco: Map<string, ValorNoBanco>,
) {
  const gravar: EscritaAprovada[] = [];
  const conflitos: Conflito[] = [];

  for (const edicao of recebidas) {
    // Não mexi: não escrevo. É esta linha que protege a contagem de quem
    // salvou depois que a minha folha foi aberta.
    if (mesmaQuantidade(edicao.valor, edicao.base)) continue;

    const atual = banco.get(edicao.insumoId);

    // O insumo não é desta contagem. A folha foi montada com outro escopo, ou
    // o formulário foi adulterado — nos dois casos não há o que gravar.
    if (!atual) continue;

    if (mesmaQuantidade(atual.quantidade, edicao.base)) {
      gravar.push({
        insumoId: edicao.insumoId,
        valor: edicao.valor,
        base: edicao.base,
      });
      continue;
    }

    // Outra pessoa chegou ao MESMO número. Não há divergência para resolver,
    // e reescrever só trocaria o nome de quem contou.
    if (mesmaQuantidade(atual.quantidade, edicao.valor)) continue;

    conflitos.push({
      insumoId: edicao.insumoId,
      tentado: edicao.valor,
      noBanco: atual.quantidade,
      contadoPorId: atual.contadoPorId,
      contadoEm: atual.contadoEm,
    });
  }

  return { gravar, conflitos };
}
