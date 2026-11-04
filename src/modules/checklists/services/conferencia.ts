import { createHash } from "node:crypto";

import { pode, type ContextoSessao } from "@/core/sessao/nucleo";
import { SemPermissao } from "@/lib/erros";
import { lerArquivo } from "@/server/arquivos";
import {
  conferenciaChecklistConfigurada,
  conferirItemChecklist,
  LIMITE_BYTES_CONFERENCIA_IA,
  type ParecerChecklist,
  type PedidoConferenciaChecklist,
} from "@/server/ia/conferir-checklist";

import { ErroEvidencia, esquemaRevisaoChecklist } from "../schemas/evidencia";

import {
  auditarResposta,
  comRespostaBloqueada,
  exigirPodeResponder,
} from "./respostas";

const CONCESSAO_MS = 5 * 60 * 1000;

/** IA e revisão têm trilha própria; não alteram a conformidade declarada. */
export async function conferirResposta(
  contexto: ContextoSessao,
  respostaId: string,
) {
  if (!pode(contexto, "checklists.editar"))
    throw new SemPermissao("conferir checklists por IA");
  return executarConferencia(contexto, respostaId, false);
}

/** Chamada pelo servidor depois da conclusão, com o mesmo escopo do autor. */
export async function conferirRespostaAutomatica(
  contexto: ContextoSessao,
  respostaId: string,
) {
  return executarConferencia(contexto, respostaId, true);
}

async function executarConferencia(
  contexto: ContextoSessao,
  respostaId: string,
  automatica: boolean,
) {
  const ids = await comRespostaBloqueada(
    contexto,
    respostaId,
    async (tx, resposta) => {
      if (automatica) exigirPodeResponder(contexto, resposta);
      if (resposta.status === "CANCELADA")
        throw new ErroEvidencia("Este checklist foi cancelado.", 409);
      if (automatica && resposta.status !== "FECHADA") return [];
      const itens = await tx.respostaItem.findMany({
        where: { respostaId, analisarIA: true, naoSeAplica: false },
        select: { id: true },
        orderBy: { ordem: "asc" },
      });
      return itens.map((item) => item.id);
    },
  );
  const resumo = {
    analisados: 0,
    descartados: 0,
    indisponiveis: 0,
    configurada: conferenciaChecklistConfigurada(),
  };
  let proximo = 0;
  // Duas análises simultâneas: limita memória/custo e permite progresso por item.
  const consumir = async () => {
    while (proximo < ids.length) {
      const itemId = ids[proximo++];
      const snapshot = await comRespostaBloqueada(
        contexto,
        respostaId,
        async (tx, resposta) => {
          if (resposta.status === "CANCELADA") return null;
          if (automatica) exigirPodeResponder(contexto, resposta);
          const item = await tx.respostaItem.findFirst({
            where: { id: itemId, respostaId },
            include: {
              evidencias: {
                where: { excluidoEm: null },
                include: { arquivo: true },
                orderBy: { criadoEm: "asc" },
              },
            },
          });
          if (!item || !item.analisarIA || item.naoSeAplica || item.revisadoEm)
            return null;
          if (
            automatica &&
            item.analisadaVersao === item.versao &&
            ["APROVADO", "REPROVADO", "INCONCLUSIVO"].includes(item.resultadoIA)
          )
            return null;
          if (
            item.resultadoIA === "PENDENTE" &&
            item.analiseIniciadaEm &&
            Date.now() - item.analiseIniciadaEm.getTime() < CONCESSAO_MS
          )
            return null;
          if (
            item.analiseIniciadaEm &&
            Date.now() - item.analiseIniciadaEm.getTime() < 60_000
          )
            return null;
          const iniciadaEm = new Date();
          await tx.respostaItem.update({
            where: { id: item.id },
            data: {
              resultadoIA: "PENDENTE",
              motivoIA: "A IA está conferindo a resposta e os arquivos.",
              confiancaIA: null,
              analiseIniciadaEm: iniciadaEm,
            },
          });
          await auditarResposta(
            tx,
            contexto,
            respostaId,
            { itemId, resultadoIA: item.resultadoIA },
            { acao: "INICIOU_CONFERENCIA_IA", itemId, versao: item.versao },
          );
          return { item, unidadeId: resposta.unidadeId, iniciadaEm };
        },
      );
      if (!snapshot) {
        resumo.descartados++;
        continue;
      }
      const { item, unidadeId, iniciadaEm } = snapshot;
      const arquivos: PedidoConferenciaChecklist["evidencias"] = [];
      let falha: string | null = null;
      if (
        item.evidencias.reduce((s, e) => s + e.arquivo.tamanho, 0) >
        LIMITE_BYTES_CONFERENCIA_IA
      ) {
        falha =
          "Os arquivos ultrapassam 12 MB por item. O gestor precisa conferir as evidências.";
      } else {
        for (const evidencia of item.evidencias) {
          const registro = evidencia.arquivo;
          if (
            registro.organizacaoId !== contexto.organizacao.id ||
            registro.unidadeId !== unidadeId ||
            registro.excluidoEm ||
            registro.entidade !== "RespostaItem" ||
            registro.entidadeId !== item.id
          ) {
            falha =
              "Uma evidência não está disponível para conferência. O gestor precisa revisar.";
            break;
          }
          const arquivo = await lerArquivo(registro.id);
          if (
            !arquivo ||
            createHash("sha256").update(arquivo.bytes).digest("hex") !==
              evidencia.sha256
          ) {
            falha =
              "Uma evidência não pôde ser verificada. O gestor precisa revisar.";
            break;
          }
          arquivos.push({
            id: evidencia.id,
            tipo: registro.tipo,
            bytes: arquivo.bytes,
          });
        }
      }
      let parecer: ParecerChecklist;
      if (falha) {
        parecer = {
          resultado: "INCONCLUSIVO",
          motivo: falha,
          confianca: 0,
          evidencias: [],
        };
      } else if (
        (item.exigeFoto &&
          !arquivos.some((e) => e.tipo.startsWith("image/"))) ||
        (item.exigeVideo && !arquivos.some((e) => e.tipo.startsWith("video/")))
      ) {
        parecer = {
          resultado: "INCONCLUSIVO",
          motivo:
            "Falta uma evidência obrigatória. O gestor precisa solicitar o arquivo.",
          confianca: 0,
          evidencias: [],
        };
      } else {
        parecer = await conferirItemChecklist({
          pergunta: item.textoItem,
          criterio: item.criterioIA,
          resposta: {
            tipo: item.tipo,
            conforme: item.conforme,
            numero: item.valorNumero?.toString() ?? null,
            texto: item.valorTexto,
            selecao: item.valorSelecao,
            observacao: item.observacao,
            minimo: item.minimo?.toString() ?? null,
            maximo: item.maximo?.toString() ?? null,
            unidade: item.rotuloUnidade,
          },
          evidencias: arquivos,
        });
      }
      const aplicado = await comRespostaBloqueada(
        contexto,
        respostaId,
        async (tx, resposta) => {
          if (resposta.status === "CANCELADA") return false;
          const gravado = await tx.respostaItem.updateMany({
            where: {
              id: item.id,
              respostaId,
              versao: item.versao,
              revisadoEm: null,
              resultadoIA: "PENDENTE",
              analiseIniciadaEm: iniciadaEm,
            },
            data: {
              resultadoIA: parecer.resultado,
              motivoIA: parecer.motivo,
              confiancaIA: parecer.confianca,
              analisadaVersao: item.versao,
            },
          });
          if (!gravado.count) return false;
          await auditarResposta(
            tx,
            contexto,
            respostaId,
            { itemId: item.id, versao: item.versao },
            {
              acao: "CONFERIU_POR_IA",
              analisador: "gemini-checklists-v1",
              modelo: process.env.GEMINI_MODELO?.trim() ?? null,
              itemId: item.id,
              versao: item.versao,
              resultado: parecer.resultado,
              motivo: parecer.motivo,
              confianca: parecer.confianca,
              evidencias: parecer.evidencias,
            },
          );
          return true;
        },
      );
      if (!aplicado) resumo.descartados++;
      else if (parecer.resultado === "INDISPONIVEL") resumo.indisponiveis++;
      else resumo.analisados++;
    }
  };
  await Promise.all([consumir(), consumir()]);
  return resumo;
}

export async function revisarItemChecklist(
  contexto: ContextoSessao,
  respostaId: string,
  entrada: unknown,
) {
  if (!pode(contexto, "checklists.editar"))
    throw new SemPermissao("revisar checklists");
  const dados = esquemaRevisaoChecklist.parse(entrada);
  return comRespostaBloqueada(contexto, respostaId, async (tx, resposta) => {
    if (resposta.status === "CANCELADA")
      throw new ErroEvidencia("Este checklist foi cancelado.", 409);
    const item = await tx.respostaItem.findFirst({
      where: { id: dados.itemId, respostaId },
    });
    if (!item) throw new ErroEvidencia("Item não encontrado.", 404);
    if (item.versao !== dados.versaoEsperada)
      throw new ErroEvidencia(
        "A resposta mudou. Atualize a página antes de revisar.",
        409,
      );
    const revisadoEm = new Date();
    const atualizado = await tx.respostaItem.update({
      where: { id: item.id },
      data: {
        versao: { increment: 1 },
        resultadoIA: dados.resultado,
        motivoIA: dados.motivo,
        confiancaIA: null,
        analisadaVersao: item.versao + 1,
        analiseIniciadaEm: null,
        revisadoEm,
        revisadoPorId: contexto.usuario.id,
      },
      select: { versao: true },
    });
    await tx.respostaDeChecklist.update({
      where: { id: respostaId },
      data: { versao: { increment: 1 } },
    });
    await auditarResposta(
      tx,
      contexto,
      respostaId,
      {
        itemId: item.id,
        versao: item.versao,
        resultado: item.resultadoIA,
        motivo: item.motivoIA,
        revisadoPorId: item.revisadoPorId,
        revisadoEm: item.revisadoEm,
      },
      {
        acao: "REVISAO_HUMANA",
        itemId: item.id,
        versao: atualizado.versao,
        resultado: dados.resultado,
        motivo: dados.motivo,
        revisadoPorId: contexto.usuario.id,
      },
    );
    return atualizado;
  });
}
