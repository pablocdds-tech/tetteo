/**
 * O PROTOCOLO MCP, NA MEDIDA DO QUE A FERRAMENTA PRECISA.
 *
 * JSON-RPC 2.0, uma mensagem por linha no stdio. Só ferramentas: nada de
 * recursos, prompts ou amostragem — o que não é anunciado não pode ser
 * pedido. Erro interno de uma ferramenta volta como `isError` com uma frase
 * genérica: o texto do erro pode ter caminho de arquivo, e não sai daqui.
 */

export const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const erro = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

export function criarProtocolo({
  nome,
  versao,
  ferramentas,
  registrarErro = () => {},
}) {
  return async function tratar(mensagem) {
    const temId =
      mensagem && Object.hasOwn(mensagem, "id") && mensagem.id !== null;
    if (
      !mensagem ||
      mensagem.jsonrpc !== "2.0" ||
      typeof mensagem.method !== "string"
    ) {
      return temId ? erro(mensagem.id, -32600, "Requisição inválida") : null;
    }
    if (!temId) return null;

    const { id, method, params } = mensagem;
    switch (method) {
      case "initialize": {
        const pedida = params?.protocolVersion;
        return ok(id, {
          protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: nome, version: versao },
          instructions:
            "Fechamento de vendas: lê só a pasta autorizada e só a loja configurada. Não executa nada fora do workspace.",
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: ferramentas.definicoes });
      case "tools/call": {
        const nomeDaFerramenta = params?.name;
        if (!ferramentas.definicoes.some((d) => d.name === nomeDaFerramenta)) {
          return erro(
            id,
            -32602,
            `Ferramenta desconhecida: ${String(nomeDaFerramenta).slice(0, 60)}`,
          );
        }
        try {
          const resultado = await ferramentas.chamar(
            nomeDaFerramenta,
            params?.arguments ?? {},
          );
          return ok(id, {
            content: [
              { type: "text", text: JSON.stringify(resultado, null, 2) },
            ],
            isError: false,
          });
        } catch (e) {
          registrarErro(e);
          return ok(id, {
            content: [
              {
                type: "text",
                text: "A ferramenta falhou por um erro interno. Nada além do que já estava gravado foi alterado.",
              },
            ],
            isError: true,
          });
        }
      }
      default:
        return erro(id, -32601, `Método não suportado: ${method.slice(0, 60)}`);
    }
  };
}
