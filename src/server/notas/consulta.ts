/** Porta substituível. Nenhum provedor ou URL é escolhido pelo documento/modelo. */
export interface ConsultaFiscal {
  consultar(entrada: {
    chave: string;
    organizacaoId: string;
    unidadeId: string;
  }): Promise<
    | { estado: "DISPONIVEL"; xml: Uint8Array }
    | { estado: "DESATIVADA" | "INDISPONIVEL" | "NAO_AUTORIZADA" }
  >;
}
export const consultaFiscalDesativada: ConsultaFiscal = {
  async consultar() {
    return { estado: "DESATIVADA" };
  },
};
// Deliberadamente sem seleção por .env, endpoint genérico ou chave: ativação exige
// implementar e revisar o adaptador escolhido pelo responsável em outra tarefa.
