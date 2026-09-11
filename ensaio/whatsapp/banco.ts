import "./ambiente";

import { contextoDeFundo, type ContextoSessao } from "@/core/sessao/contexto";
import { db } from "@/server/db";

/**
 * O CENÁRIO FICTÍCIO DO ENSAIO.
 *
 * Uma rede inventada com duas lojas e quatro pessoas, montada do zero a cada
 * rodada. Nenhum nome, telefone ou e-mail aqui é de gente de verdade: os
 * telefones são da faixa 5511 9000-00xx e os e-mails terminam em `.invalid`,
 * o domínio que a internet reserva para o que não existe.
 *
 *   Ana     Responsável na Loja Centro   → conecta, autoriza, confirma
 *   Bruno   Responsável na Loja Sul      → "o usuário de outra loja"
 *   Carla   Operadora na Loja Centro     → prepara rascunho, não confirma
 *   Diretor Diretor da rede              → vê tudo
 */

/** Apaga TUDO do banco de ensaio. A trava em `ambiente.ts` garante qual banco. */
export async function limparBancoDeEnsaio(): Promise<void> {
  const tabelas = await db.$queryRaw<{ table_name: string }[]>`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
       and table_name <> '_prisma_migrations'`;
  if (tabelas.length === 0) return;
  const lista = tabelas.map((t) => `"${t.table_name}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${lista} CASCADE`);
}

const RESPONSAVEL = [
  "assistente.ver",
  "assistente.preparar",
  "assistente.conectar",
  "assistente.autorizar",
  "assistente.vincular",
  "checklists.ver",
  "checklists.responder",
];

const OPERADOR = [
  "assistente.ver",
  "assistente.preparar",
  "checklists.ver",
  "checklists.responder",
];

export type Cenario = {
  organizacaoId: string;
  centroId: string;
  sulId: string;
  ana: string;
  bruno: string;
  carla: string;
  diretor: string;
  vinculoAna: string;
  vinculoCarla: string;
  conexaoId: string;
  respostaFechamentoId: string;
};

export async function montarCenario(): Promise<Cenario> {
  const organizacao = await db.organizacao.create({
    data: { nome: "Pizzaria Ensaio", slug: "pizzaria-ensaio" },
  });
  const centro = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Loja Centro (ensaio)",
      codigo: "CEN",
    },
  });
  const sul = await db.unidade.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Loja Sul (ensaio)",
      codigo: "SUL",
    },
  });

  const papel = (nome: string, permissoes: string[]) =>
    db.papel.create({
      data: {
        organizacaoId: organizacao.id,
        nome,
        permissoes: { create: permissoes.map((chave) => ({ chave })) },
      },
    });
  const diretorP = await papel("Diretor", ["*"]);
  const responsavelP = await papel("Responsável", RESPONSAVEL);
  const operadorP = await papel("Operador", OPERADOR);

  const pessoa = async (
    nome: string,
    email: string,
    papelId: string,
    unidadeId: string | null,
  ) => {
    const usuario = await db.usuario.create({
      data: { nome, email, status: "ATIVO" },
    });
    await db.acesso.create({
      data: {
        usuarioId: usuario.id,
        organizacaoId: organizacao.id,
        unidadeId,
        papelId,
      },
    });
    return usuario.id;
  };

  const ana = await pessoa(
    "Ana Ensaio",
    "ana@ensaio.invalid",
    responsavelP.id,
    centro.id,
  );
  const bruno = await pessoa(
    "Bruno Ensaio",
    "bruno@ensaio.invalid",
    responsavelP.id,
    sul.id,
  );
  const carla = await pessoa(
    "Carla Ensaio",
    "carla@ensaio.invalid",
    operadorP.id,
    centro.id,
  );
  const diretor = await pessoa(
    "Diretor Ensaio",
    "diretor@ensaio.invalid",
    diretorP.id,
    null,
  );

  const vinculoAna = await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: organizacao.id,
      usuarioId: ana,
      remoteJid: "5511900000012@s.whatsapp.net",
      telefone: "5511900000012",
      autorizadoEm: new Date(),
      autorizadoPorId: diretor,
    },
  });
  // Vinculada, mas NÃO autorizada para avisos.
  const vinculoCarla = await db.vinculoWhatsapp.create({
    data: {
      organizacaoId: organizacao.id,
      usuarioId: carla,
      remoteJid: "5511900000013@s.whatsapp.net",
      telefone: "5511900000013",
    },
  });

  const conexao = await db.instanciaWhatsapp.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "loja-ensaio",
      provedor: "SIMULADO",
      unidadeId: centro.id,
      estado: "CONECTADO",
      estadoDesde: new Date(),
      vistoEm: new Date(),
      numeroProprio: "5511900000001",
      ativa: true,
    },
  });

  const modelo = await db.modeloDeChecklist.create({
    data: {
      organizacaoId: organizacao.id,
      nome: "Fechamento da Pizzaria",
      itens: { create: [{ texto: "Forno desligado?", ordem: 1 }] },
    },
  });
  const resposta = await db.respostaDeChecklist.create({
    data: {
      unidadeId: centro.id,
      modeloId: modelo.id,
      referencia: new Date(),
      status: "FECHADA",
      abertaPorId: ana,
      fechadaPorId: ana,
      fechadaEm: new Date(Date.now() - 10 * 60_000),
      itensConformes: 12,
      itensNaoConformes: 2,
      pontuacao: 85.7,
    },
  });

  return {
    organizacaoId: organizacao.id,
    centroId: centro.id,
    sulId: sul.id,
    ana,
    bruno,
    carla,
    diretor,
    vinculoAna: vinculoAna.id,
    vinculoCarla: vinculoCarla.id,
    conexaoId: conexao.id,
    respostaFechamentoId: resposta.id,
  };
}

/** O mesmo contexto que a tela monta — só que sem navegador. */
export async function contextoDe(
  usuarioId: string,
  unidadeId: string | null,
): Promise<ContextoSessao> {
  const contexto = await contextoDeFundo(usuarioId, unidadeId);
  if (!contexto) throw new Error("o contexto do ensaio não montou");
  return contexto;
}
