import { db } from "@/server/db";

/**
 * O NÚCLEO DA SESSÃO — o que não depende do Next.
 *
 * `contexto.ts` lê o cookie da unidade e a sessão do Auth.js, e por isso só
 * funciona dentro de uma requisição de tela. Tudo o que NÃO precisa disso mora
 * aqui: o formato do contexto, o checador de permissão e o contexto montado a
 * partir do banco.
 *
 * A separação existe por dois motivos concretos: o relógio (Severina, Compras)
 * roda sem navegador, e os testes com banco de verdade rodam fora do Next —
 * importar `next/headers` num teste derruba o teste antes da primeira linha.
 * `contexto.ts` reexporta tudo, então quem já importava de lá não muda nada.
 */

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

/**
 * O CONTEXTO SEM NAVEGADOR.
 *
 * `obterContexto` depende de duas coisas que só existem numa requisição de
 * tela: a sessão do Auth.js e o cookie da unidade. O relógio da Severina roda
 * sem nenhuma das duas — não há quem esteja logado às 7h da manhã.
 *
 * Esta função monta o MESMO `ContextoSessao` a partir do banco, para um
 * usuário e uma unidade escolhidos. Daí em diante `pode()` funciona igual, e
 * todo serviço do sistema continua sendo chamado do jeito que já era.
 *
 * É isso que faz "a Severina age como a pessoa" não custar código novo: não
 * existe caminho paralelo de autorização, existe o mesmo caminho com outra
 * origem.
 *
 * NÃO usa `cache` do React de propósito: o relógio monta contexto para várias
 * pessoas na mesma execução, e o cache devolveria o primeiro para todos.
 */
export async function contextoDeFundo(
  usuarioId: string,
  unidadeId: string | null,
): Promise<ContextoSessao | null> {
  const acessos = await db.acesso.findMany({
    where: {
      usuarioId,
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

  const podeVerRedeInteira = acessos.some((a) => a.unidadeId === null);

  const unidadesVisiveis: UnidadeVisivel[] = podeVerRedeInteira
    ? await db.unidade.findMany({
        where: { organizacaoId: organizacao.id, ativa: true, excluidoEm: null },
        select: { id: true, nome: true, codigo: true },
        orderBy: { nome: "asc" },
      })
    : acessos
        .filter((a) => a.unidade !== null)
        .map((a) => a.unidade!)
        .filter((u, i, todas) => todas.findIndex((o) => o.id === u.id) === i);

  // Unidade pedida que a pessoa não enxerga não vira "rede inteira" por
  // descuido: devolve nada. Um agente configurado para uma loja não pode
  // acabar cobrando as duas porque o destinatário foi transferido.
  const unidadeAtiva = unidadeId
    ? (unidadesVisiveis.find((u) => u.id === unidadeId) ?? null)
    : null;
  if (unidadeId && !unidadeAtiva) return null;

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
}

/**
 * O checador de permissão.
 *
 * O Core não sabe o que "cardapio.editar" significa — só confere se a string
 * está no conjunto. O significado pertence ao App que a declarou.
 */
export function pode(
  contexto: Pick<ContextoSessao, "permissoes">,
  chave: string,
): boolean {
  if (contexto.permissoes.has("*")) return true;
  if (contexto.permissoes.has(chave)) return true;

  // "cardapio.*" concede tudo dentro do App de Cardápio.
  const [app] = chave.split(".");
  return contexto.permissoes.has(`${app}.*`);
}
