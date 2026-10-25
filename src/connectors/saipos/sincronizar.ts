import { normalizarVenda } from "./normalizar";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { SaiposClient, SaiposError, type SaiposSale } from "./client";
import { deveRodar, diaDeslocado, FUSO, horarioBrasilia } from "./tempo";

/** Configuração administrativa: IDs vêm do ambiente privado, nunca de URL. */
export async function configurarVinculo() {
  const unidadeId = process.env.SAIPOS_UNIDADE_ID;
  const lojaSaiposId = Number(process.env.SAIPOS_STORE_ID);
  if (!unidadeId || !Number.isSafeInteger(lojaSaiposId) || lojaSaiposId <= 0)
    throw new SaiposError(
      "configuration",
      "Configure unidade e loja Saipos no ambiente privado.",
    );
  const unidade = await db.unidade.findFirst({
    where: {
      id: unidadeId,
      ativa: true,
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
  });
  if (!unidade || unidade.fusoHorario !== FUSO)
    throw new SaiposError("store", "Unidade ativa de Brasília não encontrada.");
  const existente = await db.saiposVinculo.findUnique({ where: { unidadeId } });
  if (existente) {
    if (existente.lojaSaiposId !== lojaSaiposId || existente.excluidoEm)
      throw new SaiposError(
        "store",
        "Vínculo Saipos existente não pode ser remapeado automaticamente.",
      );
    return existente;
  }
  return db.$transaction(async (tx) => {
    const vinculo = await tx.saiposVinculo.create({
      data: { unidadeId, organizacaoId: unidade.organizacaoId, lojaSaiposId },
    });
    await tx.auditoria.create({
      data: {
        organizacaoId: unidade.organizacaoId,
        unidadeId,
        entidade: "SaiposVinculo",
        entidadeId: vinculo.id,
        acao: "CRIOU",
        valoresDepois: { lojaSaiposId, origem: "ambiente-administrativo" },
      },
    });
    return vinculo;
  });
}

export async function sincronizarVendas(
  id: string,
  cliente?: SaiposClient,
  diario = false,
  solicitacao?: Date,
  repositorio = db,
) {
  const agora = new Date(),
    dono = randomUUID(),
    ate = horarioBrasilia(agora);
  const inicioDia = new Date(ate.slice(0, 10) + "T00:00:00-03:00");
  const reserva = await repositorio.saiposVinculo.updateMany({
    where: {
      id,
      habilitado: true,
      excluidoEm: null,
      ...(solicitacao ? { solicitadaEm: solicitacao } : {}),
      unidade: {
        ativa: true,
        excluidoEm: null,
        organizacao: { ativa: true, excluidoEm: null },
      },
      AND: [
        ...(solicitacao
          ? [
              {
                OR: [
                  { ultimaTentativaEm: null },
                  { ultimaTentativaEm: { lt: solicitacao } },
                ],
              },
            ]
          : []),
        { OR: [{ concessaoAte: null }, { concessaoAte: { lt: agora } }] },
        ...(diario
          ? [
              {
                OR: [
                  { ultimaTentativaEm: null },
                  { ultimaTentativaEm: { lt: inicioDia } },
                ],
              },
            ]
          : []),
      ],
    },
    data: {
      concessaoDono: dono,
      concessaoAte: new Date(agora.getTime() + 45 * 60000),
      ultimaTentativaEm: agora,
      ultimoErro: null,
    },
  });
  if (!reserva.count) return { ignorada: true };
  try {
    cliente ??= new SaiposClient();
    const vinculo = await repositorio.saiposVinculo.findUniqueOrThrow({
      where: { id },
    });
    if (vinculo.cursor && vinculo.cursor >= ate)
      throw new SaiposError("cursor", "Cursor não pode regredir.");
    const desde = vinculo.coberturaDesde ?? diaDeslocado(ate.slice(0, 10), -30);
    let vendas: SaiposSale[];
    if (!vinculo.cursor) {
      vendas = await cliente.sales(
        { start: desde + "T00:00:00", end: ate, column: "shift_date" },
        vinculo.lojaSaiposId,
      );
      vendas.push(
        ...(await cliente.sales(
          { start: desde + "T00:00:00", end: ate, column: "updated_at" },
          vinculo.lojaSaiposId,
        )),
      );
    } else {
      vendas = (
        await cliente.incremental(
          {
            operation: "sales",
            storeId: vinculo.lojaSaiposId,
            through: vinculo.cursor,
          },
          ate,
        )
      ).sales;
      vendas.push(
        ...(await cliente.sales(
          {
            start: diaDeslocado(ate.slice(0, 10), -3) + "T00:00:00",
            end: ate,
            column: "shift_date",
          },
          vinculo.lojaSaiposId,
        )),
      );
    }
    const unicas = new Map<string, ReturnType<typeof normalizarVenda>>();
    for (const venda of vendas) {
      const registro = normalizarVenda(venda, vinculo.lojaSaiposId);
      const anterior = unicas.get(registro.vendaExternaId);
      if (
        !anterior ||
        registro.alteradaNoSaiposEm >= anterior.alteradaNoSaiposEm
      )
        unicas.set(registro.vendaExternaId, registro);
    }
    if (!vinculo.cursor && unicas.size === 0) {
      throw new SaiposError(
        "unverified",
        "A primeira carga não retornou vendas. Confirme loja, acesso e situação da conta; cursor preservado.",
      );
    }
    await repositorio.$transaction(
      async (tx) => {
        const trava = await tx.saiposVinculo.updateMany({
          where: {
            id,
            habilitado: true,
            excluidoEm: null,
            concessaoDono: dono,
            concessaoAte: { gt: new Date() },
          },
          data: {
            cursor: ate,
            coberturaDesde: desde,
            ultimoSucessoEm: new Date(),
            ultimaQuantidade: unicas.size,
            ultimoErro: null,
          },
        });
        if (!trava.count)
          throw new SaiposError(
            "lease",
            "Execução perdeu sua concessão; nenhuma gravação aplicada.",
          );
        for (const registro of unicas.values()) {
          const chave = {
            organizacaoId: vinculo.organizacaoId,
            unidadeId: vinculo.unidadeId,
            vendaExternaId: registro.vendaExternaId,
          };
          const anterior = await tx.saiposVenda.findUnique({
            where: { organizacaoId_unidadeId_vendaExternaId: chave },
          });
          if (
            anterior &&
            anterior.alteradaNoSaiposEm >= registro.alteradaNoSaiposEm
          )
            continue;
          const salvo = await tx.saiposVenda.upsert({
            where: { organizacaoId_unidadeId_vendaExternaId: chave },
            create: { ...chave, ...registro },
            update: registro,
          });
          const resumir = (r: {
            totalCentavos: number;
            cancelada: boolean;
            dataTurno: string;
          }) => ({
            totalCentavos: r.totalCentavos,
            cancelada: r.cancelada,
            dataTurno: r.dataTurno,
          });
          await tx.auditoria.create({
            data: {
              organizacaoId: vinculo.organizacaoId,
              unidadeId: vinculo.unidadeId,
              entidade: "SaiposVenda",
              entidadeId: salvo.id,
              acao: anterior ? "ALTEROU" : "CRIOU",
              valoresAntes: anterior ? resumir(anterior) : undefined,
              valoresDepois: resumir(registro),
            },
          });
        }
        await tx.auditoria.create({
          data: {
            organizacaoId: vinculo.organizacaoId,
            unidadeId: vinculo.unidadeId,
            entidade: "SaiposVinculo",
            entidadeId: id,
            acao: "ALTEROU",
            valoresAntes: { cursor: vinculo.cursor },
            valoresDepois: { cursor: ate, quantidade: unicas.size },
          },
        });
        await tx.saiposVinculo.update({
          where: { id },
          data: { concessaoDono: null, concessaoAte: null },
        });
      },
      { maxWait: 10000, timeout: 120000 },
    );
    return { ignorada: false, quantidade: unicas.size, cursor: ate };
  } catch (erro) {
    await repositorio.saiposVinculo.updateMany({
      where: { id, concessaoDono: dono },
      data: {
        concessaoDono: null,
        concessaoAte: null,
        ultimoErro:
          erro instanceof SaiposError
            ? erro.message
            : "Falha ao gravar vendas; cursor preservado.",
      },
    });
    throw erro;
  }
}

export function iniciarRelogioSaipos() {
  if (process.env.SAIPOS_SYNC_ENABLED !== "true") return;
  let ocupado = false;
  const rodada = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const vinculo = await configurarVinculo();
      const manual =
        vinculo.solicitadaEm &&
        (!vinculo.ultimaTentativaEm ||
          vinculo.solicitadaEm > vinculo.ultimaTentativaEm);
      if (
        vinculo.habilitado &&
        (manual ||
          deveRodar(new Date(), vinculo.ultimaTentativaEm, !vinculo.cursor))
      ) {
        await sincronizarVendas(
          vinculo.id,
          undefined,
          !manual,
          manual ? vinculo.solicitadaEm! : undefined,
        );
      }
    } catch {
      console.error(
        "[saipos] Sincronização não concluída; verifique configuração e estado da integração.",
      );
    } finally {
      ocupado = false;
    }
  };
  const timer = setInterval(() => void rodada(), 60000);
  timer.unref();
  void rodada();
}
