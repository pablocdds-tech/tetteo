/**
 * DE ONDE VÊM AS VENDAS.
 *
 * A ferramenta não sabe — e não deve saber — se o número vem de um gerador de
 * ensaio, do banco do Tetteo ou do Cardápio Web. Trocar a fonte é trocar a
 * implementação desta interface; o contrato que o Claude enxerga não muda.
 */

export type ConsultaDeVendas = {
  unidadeId: string;
  /** AAAA-MM-DD, dia de Brasília. */
  data: string;
};

export type ResumoDeVendas = {
  quantidade: number;
  /** Dinheiro em centavos inteiros: somar reais em ponto flutuante erra. */
  totalCentavos: number;
};

export interface FonteDeVendas {
  readonly nome: "ficticia";
  /** Quando verdadeiro, toda resposta leva o aviso de dados fictícios. */
  readonly ehFicticia: boolean;
  vendasDoDia(
    consulta: ConsultaDeVendas,
    sinal: AbortSignal,
  ): Promise<ResumoDeVendas>;
}
