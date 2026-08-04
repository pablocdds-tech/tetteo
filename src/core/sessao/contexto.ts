import { cookies } from "next/headers";
import { cache } from "react";

import { auth } from "@/core/auth";
import { db } from "@/server/db";

/**
 * O CONTEXTO DA SESSÃO.
 *
 * Responde as três perguntas que toda tela do sistema precisa fazer:
 * quem é a pessoa, em qual unidade ela está, e o que ela pode fazer.
 *
 * Nenhuma consulta do Tetteo deve buscar dado sem passar por aqui. É isso que
 * garante o isolamento entre unidades por DESENHO, não por disciplina de quem
 * programa — o gerente da Zona Sul não vê o caixa do Centro porque a consulta
 * nem chega a ser montada com o escopo errado.
 *
 * `cache` do React garante uma consulta só por requisição, mesmo que dez
 * componentes peçam o contexto.
 */

export const COOKIE_UNIDADE = "tetteo.unidade";

/** Valor especial do seletor: ver todas as unidades de uma vez. */
export const REDE_INTEIRA = "rede";

export type UnidadeVisivel = { id: string; nome: string; codigo: string };

export type ContextoSessao = {
  usuario: {
    id: string;
    nome: string;
    email: string;
    avatarUrl: string | null;
  };
  organizacao: { id: string; nome: string };

  /** As unidades que ESTE usuário enxerga — nunca todas do banco. */
  unidadesVisiveis: UnidadeVisivel[];

  /** `null` quando o usuário está vendo a rede inteira. */
  unidadeAtiva: UnidadeVisivel | null;

  /** Só quem tem acesso de rede pode escolher "Rede Completa". */
  podeVerRedeInteira: boolean;

  permissoes: Set<string>;

  /** `true` se o papel for Diretor (permissão coringa). */
  ehDiretor: boolean;
};

export const obterContexto = cache(async (): Promise<ContextoSessao | null> => {
  const sessao = await auth();
  if (!sessao?.user?.id) return null;

  const acessos = await db.acesso.findMany({
    where: {
      usuarioId: sessao.user.id,
      status: "ATIVO",
      excluidoEm: null,
      organizacao: { ativa: true, excluidoEm: null },
    },
    include: {
      usuario: {
        select: { id: true, nome: true, email: true, avatarUrl: true },
      },
      organizacao: { select: { id: true, nome: true } },
      unidade: { select: { id: true, nome: true, codigo: true } },
      papel: { include: { permissoes: { select: { chave: true } } } },
    },
    orderBy: { criadoEm: "asc" },
  });

  if (acessos.length === 0) return null;

  const primeiro = acessos[0];
  const organizacao = primeiro.organizacao;

  // Acesso com unidade vazia = REDE INTEIRA.
  const acessosDeRede = acessos.filter((a) => a.unidadeId === null);
  const podeVerRedeInteira = acessosDeRede.length > 0;

  const unidadesVisiveis: UnidadeVisivel[] = podeVerRedeInteira
    ? await db.unidade.findMany({
        where: {
          organizacaoId: organizacao.id,
          ativa: true,
          excluidoEm: null,
        },
        select: { id: true, nome: true, codigo: true },
        orderBy: { nome: "asc" },
      })
    : acessos
        .filter((a) => a.unidade !== null)
        .map((a) => a.unidade!)
        .filter((u, i, todas) => todas.findIndex((o) => o.id === u.id) === i);

  // Qual unidade está ativa: a escolhida no seletor, se ainda for válida.
  const escolhida = (await cookies()).get(COOKIE_UNIDADE)?.value;

  let unidadeAtiva: UnidadeVisivel | null = null;
  if (escolhida === REDE_INTEIRA && podeVerRedeInteira) {
    unidadeAtiva = null;
  } else {
    unidadeAtiva =
      unidadesVisiveis.find((u) => u.id === escolhida) ??
      // Sem escolha válida: quem vê a rede começa nela; quem não vê,
      // começa na primeira unidade a que tem acesso.
      (podeVerRedeInteira ? null : (unidadesVisiveis[0] ?? null));
  }

  // As permissões somam todos os acessos, mas só valem no escopo atual: um
  // acesso de unidade não concede nada quando se olha a rede inteira.
  const relevantes = acessos.filter((a) => {
    if (unidadeAtiva === null) return a.unidadeId === null;
    return a.unidadeId === null || a.unidadeId === unidadeAtiva.id;
  });

  const permissoes = new Set<string>();
  for (const acesso of relevantes) {
    for (const p of acesso.papel.permissoes) permissoes.add(p.chave);
  }

  return {
    usuario: primeiro.usuario,
    organizacao,
    unidadesVisiveis,
    unidadeAtiva,
    podeVerRedeInteira,
    permissoes,
    ehDiretor: permissoes.has("*"),
  };
});

/**
 * O checador de permissão.
 *
 * O Core não sabe o que "cardapio.editar" significa — só confere se a string
 * está no conjunto. O significado pertence ao App que a declarou.
 */
export function pode(contexto: ContextoSessao, chave: string): boolean {
  if (contexto.permissoes.has("*")) return true;
  if (contexto.permissoes.has(chave)) return true;

  // "cardapio.*" concede tudo dentro do App de Cardápio.
  const [app] = chave.split(".");
  return contexto.permissoes.has(`${app}.*`);
}
