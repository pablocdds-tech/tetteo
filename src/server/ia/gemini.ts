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

/**
 * AS CHAVES.
 *
 * `GEMINI_API_KEYS` aceita várias, separadas por vírgula. `GEMINI_API_KEY` no
 * singular continua valendo para quem tem só uma.
 *
 * O motivo de existir mais de uma não é acumular cota — chaves do MESMO
 * projeto dividem o mesmo limite, e isso não muda por serem muitas. Elas
 * servem para o sistema não parar: chave revogada, chave vazada trocada às
 * pressas, ou chave que bateu no teto do minuto. Em qualquer um desses casos a
 * Severina passa para a próxima em vez de a cobrança do dia não sair.
 */
const CHAVES = (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

const MODELO = process.env.GEMINI_MODELO ?? "";

/**
 * Onde a próxima chamada começa. Gira a cada uso para as chaves se revezarem,
 * em vez de a primeira levar toda a carga e as outras só servirem de reserva.
 */
let proximaChave = 0;

/** Vale a pena tentar outra chave, ou o problema é do pedido? */
function ehLimiteOuCredencial(status: number): boolean {
  // 429 = estourou o limite. 401/403 = chave inválida, revogada ou sem
  // permissão. Nos três, OUTRA chave pode funcionar.
  // 400 e 500 não entram: pedido malformado erra igual em todas, e insistir
  // em cinco chaves contra um servidor fora do ar só gasta o minuto do relógio.
  return status === 429 || status === 401 || status === 403;
}

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
  if (CHAVES.length === 0 || !MODELO) return pedido.contexto;

  const corpo = JSON.stringify({
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
  });

  // Cada chave leva no máximo uma tentativa. Sem laço infinito, sem repetir a
  // mesma chave: o relógio tem um minuto para a rodada TODA, não para um aviso.
  for (let i = 0; i < CHAVES.length; i++) {
    const chave = CHAVES[(proximaChave + i) % CHAVES.length];

    try {
      const resposta = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": chave,
          },
          body: corpo,
          // Mesmo motivo do conector: o relógio tem um minuto para a rodada.
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!resposta.ok) {
        // Limite estourado ou credencial recusada: outra chave pode servir.
        if (ehLimiteOuCredencial(resposta.status)) continue;
        // Qualquer outro erro erraria igual em todas — desiste na primeira.
        return pedido.contexto;
      }

      // Deu certo: a próxima chamada começa pela chave SEGUINTE, para a carga
      // se espalhar em vez de a primeira da lista levar tudo.
      proximaChave = (proximaChave + i + 1) % CHAVES.length;

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
      // Timeout ou rede: tenta a próxima chave, se houver.
      continue;
    }
  }

  // Todas falharam. A fila segue: o fato cru já é uma mensagem útil.
  return pedido.contexto;
}
