/**
 * O REDATOR.
 *
 * Na fase 1 o Gemini faz uma coisa só: transformar as instruções que o dono
 * escreveu em português numa mensagem curta de WhatsApp. Não decide nada, não
 * chama ferramenta, não lê resposta — isso são as fases 2 e 3.
 *
 * Mora em `server/` e não em `connectors/` porque não é ponte que traz fatos
 * de fora, como o PDV traz vendas. É serviço que o sistema CONSULTA, igual ao
 * banco. E é o único lugar de onde `modules/` o alcança sem furar a trava do
 * linter.
 *
 * A regra que governa este arquivo: se ele falhar, a fila NÃO PARA. Um aviso
 * sem graça sai; um aviso que não sai é uma contagem que ninguém faz.
 */

const CHAVE = process.env.GEMINI_API_KEY ?? "";
const MODELO = process.env.GEMINI_MODELO ?? "";

const INSTRUCAO_DE_SISTEMA = `
Você redige mensagens de WhatsApp para a equipe de um restaurante no Brasil.

Regras:
- No máximo 3 linhas. Ninguém lê parágrafo no WhatsApp.
- Português do dia a dia, sem formalidade de escritório.
- Não invente número, valor, nome de pessoa nem prazo. Use só o que receber.
- Não use emoji, a não ser que as instruções peçam.
- Devolva SOMENTE o texto da mensagem, sem aspas e sem explicação.
`.trim();

export type PedidoDeRedacao = {
  /** O que o dono escreveu na tela do agente. Orienta o tom e o recorte. */
  instrucoes: string;
  /** O fato a comunicar, já em português, vindo do módulo. */
  contexto: string;
};

/**
 * Devolve o texto pronto para enviar.
 *
 * Em QUALQUER falha — sem chave, modelo fora do ar, resposta vazia, timeout —
 * devolve `contexto` sem alarde. O fato cru ("A contagem da Praça está
 * atrasada.") já é uma mensagem útil; perder a cobrança por causa do redator
 * seria trocar o essencial pelo enfeite.
 */
export async function redigirAviso(pedido: PedidoDeRedacao): Promise<string> {
  if (!CHAVE || !MODELO) return pedido.contexto;

  try {
    const resposta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": CHAVE,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCAO_DE_SISTEMA }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Instruções do dono:\n${pedido.instrucoes}\n\nO que precisa ser comunicado agora:\n${pedido.contexto}`,
                },
              ],
            },
          ],
        }),
        // Mesmo motivo do conector: o relógio tem um minuto para a rodada.
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!resposta.ok) return pedido.contexto;

    const dados = (await resposta.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text;

    // Silêncio do modelo não pode virar mensagem em branco no WhatsApp de
    // ninguém — e um bloqueio de segurança do Gemini devolve exatamente isso.
    return typeof texto === "string" && texto.trim()
      ? texto.trim()
      : pedido.contexto;
  } catch {
    return pedido.contexto;
  }
}
