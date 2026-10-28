import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import type { ContextoSessao } from "@/core/sessao/nucleo";
import { esquemaPedidoRecebido, nomeOrigemPedido } from "@/lib/pedido-recebido";
import { exigirEscopo } from "./escopo";
import { ErroPdv } from "../schemas/erro";
import { periodoDesempenho, resumirDesempenho } from "../schemas/desempenho";
import type { RegistroDesempenho } from "../desempenho-types";

const itens = z.array(
  z.object({ nome: z.string(), quantidade: z.number().positive() }),
);
const LIMITE = 20000;
export async function obterDesempenho(
  ctx: ContextoSessao,
  entrada: unknown = {},
) {
  const escopo = await exigirEscopo(ctx);
  const periodo = periodoDesempenho(entrada);
  const datas = { gte: periodo.anteriorInicio, lt: periodo.fim };
  return db.$transaction(
    async (tx) => {
      const [locais, externos] = await Promise.all([
        tx.pdvVenda.findMany({
          where: { ...escopo, criadaEm: datas },
          select: {
            criadaEm: true,
            totalCentavos: true,
            status: true,
            modalidade: true,
            itens: true,
          },
          take: LIMITE + 1,
        }),
        tx.pdvPedido.findMany({
          where: {
            ...escopo,
            vendaId: null,
            recebido: { criadoNaOrigemEm: datas },
          },
          select: {
            status: true,
            recebido: { select: { origem: true, conteudo: true } },
          },
          take: LIMITE + 1,
        }),
      ]);
      if (locais.length > LIMITE || externos.length > LIMITE)
        throw new ErroPdv(
          "Há muitos pedidos para esta consulta. Reduza o período para obter o resultado completo.",
        );
      const registros: RegistroDesempenho[] = locais.map((v) => ({
        criadoEm: v.criadaEm.toISOString(),
        totalCentavos: v.totalCentavos,
        cancelado: v.status === "CANCELADA",
        pendente: v.status === "PENDENTE",
        modalidade: v.modalidade,
        origem: "Tetteo",
        itens: itens.parse(v.itens),
      }));
      for (const p of externos) {
        if (!p.recebido) continue;
        const d = esquemaPedidoRecebido.parse(p.recebido.conteudo);
        registros.push({
          criadoEm: d.criadoEm,
          totalCentavos: d.totalCentavos,
          cancelado: p.status === "CANCELADO" || d.etapa === "CANCELADO",
          pendente: false,
          modalidade: d.modalidade,
          origem: nomeOrigemPedido(p.recebido.origem),
          itens: d.itens.map((i) => ({
            nome: i.nome,
            quantidade: i.quantidade,
          })),
        });
      }
      return resumirDesempenho(registros, periodo);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    },
  );
}
