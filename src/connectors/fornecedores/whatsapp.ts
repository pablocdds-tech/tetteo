import type { CanalDeFornecedor, ResultadoDoCanal } from "./contrato";

/**
 * O WHATSAPP DE COMPRAS (Evolution API) — pronto e DESLIGADO.
 *
 * Liga com `COMPRAS_CANAL=whatsapp` e `COMPRAS_EVOLUTION_INSTANCIA`. É uma
 * instância SEPARADA da Severina, de propósito: o número da Severina é uma
 * conta pessoal com muitos contatos, e rajada de pedido para fornecedor é o
 * tipo de uso que faz a Meta bloquear um número. Apontar as duas para a
 * mesma instância é recusado.
 *
 * O que ainda depende da integração real (desenho §12):
 *   - "entregue": precisa do webhook de confirmação da Evolution;
 *   - `consultar`: precisa da busca de mensagem por referência. Até lá,
 *     devolve "desconhecido" e a mensagem incerta fica para uma pessoa.
 */

const TEMPO_MS = 20_000;

function recusada(erro: string, tentarDeNovo: boolean): ResultadoDoCanal {
  return { tipo: "recusada-antes", erro, tentarDeNovo };
}

/**
 * Traduz a falha do `fetch` na única pergunta que importa: pode ter saído?
 * Conexão RECUSADA ou nome que não resolve: não chegou a sair. Tempo esgotado
 * ou conexão caída no meio: pode ter saído — incerta. Na dúvida, incerta.
 */
function classificar(erro: unknown): ResultadoDoCanal {
  const e = erro as { name?: string; message?: string; cause?: { code?: string } };
  const codigo = e?.cause?.code ?? "";
  const texto = `${e?.name ?? "Erro"}: ${e?.message ?? String(erro)}`.slice(0, 300);
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(codigo)) {
    return recusada(`Evolution fora do ar (${codigo}).`, true);
  }
  return { tipo: "incerta", erro: texto };
}

export function criarWhatsapp(): CanalDeFornecedor {
  const url = (process.env.EVOLUTION_URL ?? "http://evolution_api:8080").replace(/\/+$/, "");
  const chave = process.env.EVOLUTION_API_KEY ?? "";
  const instancia = process.env.COMPRAS_EVOLUTION_INSTANCIA ?? "";

  return {
    nome: "whatsapp",
    simulado: false,

    async enviar({ destino, texto }) {
      if (process.env.NODE_ENV === "test") {
        return recusada("WhatsApp desligado em teste: nenhuma mensagem real sai.", false);
      }
      if (!instancia) {
        return recusada("COMPRAS_EVOLUTION_INSTANCIA não está configurada.", false);
      }
      if (instancia === process.env.EVOLUTION_INSTANCIA) {
        return recusada(
          "A instância de compras não pode ser a mesma da Severina. Configure um número só para compras.",
          false,
        );
      }

      let resposta: Response;
      try {
        resposta = await fetch(`${url}/message/sendText/${instancia}`, {
          method: "POST",
          headers: { apikey: chave, "Content-Type": "application/json" },
          body: JSON.stringify({ number: destino, text: texto }),
          signal: AbortSignal.timeout(TEMPO_MS),
        });
      } catch (erro) {
        return classificar(erro);
      }

      const corpo = await resposta.text().catch(() => "");
      if (resposta.ok) {
        let id: string | undefined;
        try {
          id = (JSON.parse(corpo) as { key?: { id?: string } })?.key?.id;
        } catch {
          id = undefined;
        }
        // Aceitou e não disse com que id: saiu, mas não há como provar depois.
        return id
          ? { tipo: "aceita", idProvedor: id }
          : { tipo: "incerta", erro: "A Evolution respondeu sem id de mensagem." };
      }
      if (resposta.status === 429 || resposta.status >= 500) {
        return recusada(`Evolution ${resposta.status}.`, true);
      }
      // Recorte curto: a resposta da Evolution às vezes traz o payload inteiro.
      return recusada(`Evolution ${resposta.status}: ${corpo.slice(0, 200)}`, false);
    },

    async consultar() {
      return "desconhecido";
    },
  };
}
