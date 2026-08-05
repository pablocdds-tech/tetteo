import type { AvisoDoModulo } from "@/core/registry/tipos";
import type { ContextoSessao } from "@/core/sessao/contexto";

import { listarRotinas } from "./services/rotinas";

/**
 * O QUE O ESTOQUE TEM A AVISAR.
 *
 * A Severina não sabe o que é uma rotina de contagem, e não pode saber: um App
 * nunca importa de outro. Ela pergunta "tem aviso para dar?" e este arquivo
 * responde, no vocabulário dela.
 *
 * Quem é dono da regra continua dono. Se amanhã a contagem passar a ser
 * quinzenal, ou se o cálculo de atraso mudar, quem muda é o Estoque — e a
 * Severina não fica sabendo que houve mudança.
 */
export const assistenteDoEstoque = {
  modulo: "estoque",

  /**
   * Os lembretes de hoje. Gatilho `ROTINA_VENCIDA`.
   *
   * Devolve as rotinas que estão no prazo de serem feitas e as que passaram
   * dele. As duas viram frase diferente: "é para hoje" cobra; "está atrasada"
   * envergonha um pouco, e é isso que faz a contagem sair.
   *
   * A comparação de auditor — "não é contada há três dias", "você fechou 4
   * este mês contra 12 no mês passado" — é outro método, `discrepancias`, e
   * entra na fase 1.5. Aqui é só o lembrete.
   */
  async avisos(contexto: ContextoSessao): Promise<AvisoDoModulo[]> {
    // Sem unidade escolhida não existe estoque para cobrar: farinha na câmara
    // de uma loja não vira pizza na outra, e `listarRotinas` exige unidade.
    if (!contexto.unidadeAtiva) return [];

    const rotinas = await listarRotinas(contexto);

    return rotinas
      .filter((r) => r.status === "aguardando" || r.status === "atrasada")
      .map((r) => ({
        // A chave carrega o status: quando a rotina passa de "aguardando" para
        // "atrasada", vira um aviso NOVO e a Severina volta a falar. Sem isso,
        // quem ignorou o lembrete das 7h nunca ouviria que ficou atrasado.
        chave: `rotina:${r.id}:${r.status}`,
        assunto:
          r.status === "atrasada"
            ? `A contagem "${r.nome}" está atrasada.`
            : `A contagem "${r.nome}" é para hoje.`,
        referenciaTipo: "rotina_de_contagem",
        referenciaId: r.id,
      }));
  },
};
