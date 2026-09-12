import type { RequestHandler } from "express";

/**
 * UM LIMITE DE REQUISIÇÕES POR IP, EM MEMÓRIA.
 *
 * Para as portas abertas a qualquer um — /oauth/authorize, /oauth/token,
 * /health. Sem limite, um script enche as tabelas de pedidos e ocupa as
 * cinco conexões do banco, e a conferência das chaves em /mcp começa a
 * esperar na fila.
 *
 * Memória basta: com uma cópia do serviço, o pior de um deploy é a contagem
 * recomeçar do zero. Não é estado de sessão de ninguém.
 */

export type Limite = { maximo: number; janelaMs: number };

export function criarLimitador(
  limite: Limite,
  agora: () => number = Date.now,
): RequestHandler {
  const janelas = new Map<string, { inicio: number; total: number }>();

  return (req, res, next) => {
    const instante = agora();
    const chave = req.ip ?? "desconhecido";

    let janela = janelas.get(chave);
    if (!janela || instante - janela.inicio >= limite.janelaMs) {
      janela = { inicio: instante, total: 0 };
      janelas.set(chave, janela);
    }
    janela.total += 1;

    // Faxina de quem já saiu da janela, para o mapa não crescer sem fim.
    if (janelas.size > 10_000) {
      for (const [ip, outra] of janelas) {
        if (instante - outra.inicio >= limite.janelaMs) janelas.delete(ip);
      }
    }

    if (janela.total > limite.maximo) {
      const segundos = Math.max(
        1,
        Math.ceil((janela.inicio + limite.janelaMs - instante) / 1000),
      );
      res.set("Retry-After", String(segundos)).status(429).json({
        error: "too_many_requests",
        error_description: "Muitas requisições. Tente de novo em instantes.",
      });
      return;
    }
    next();
  };
}
