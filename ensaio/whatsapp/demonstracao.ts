import "./ambiente";

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import bcrypt from "bcryptjs";

import { aplicarEventosDaConexao } from "@/app/api/whatsapp/_costura/conexao-tela";
import { entregarAvisos } from "@/app/api/whatsapp/_costura/entrega";
import { verificarIncertos } from "@/app/api/whatsapp/_costura/verificacao";
import { reiniciarSimulador, simulador } from "@/connectors/whatsapp/simulado";
import {
  gerarReferencia,
  montarCorpo,
} from "@/modules/assistente/schemas/aviso";
import type { EventoNormalizado } from "@/modules/assistente/schemas/evento";
import {
  confirmarAviso,
  criarRascunho,
  descartarAviso,
} from "@/modules/assistente/services/avisos";
import {
  processarEvento,
  registrarEvento,
} from "@/modules/assistente/services/eventos";
import { coletarRascunhos } from "@/modules/assistente/services/rascunhos";
import { db } from "@/server/db";

import { contextoDe, limparBancoDeEnsaio, montarCenario } from "./banco";

/**
 * DADOS DE DEMONSTRAÇÃO — para olhar as telas antes de existir número real.
 *
 * Roda contra o banco descartável do ensaio (a trava em `ambiente.ts` garante
 * qual), com o provedor SIMULADO. Deixa um aviso em cada estado que a tela
 * conhece, eventos de cada tipo, e um login para o Diretor fictício.
 *
 *   npx tsx --require ./ensaio/whatsapp/sem-server-only.cjs ensaio/whatsapp/demonstracao.ts
 *   npx tsx --require ./ensaio/whatsapp/sem-server-only.cjs ensaio/whatsapp/demonstracao.ts --apagar
 *
 * A senha do Diretor fictício é gerada a cada rodada e gravada FORA do
 * repositório (pasta temporária do sistema). Nenhum nome, telefone ou e-mail
 * aqui é de gente de verdade.
 */

/**
 * O TEMPO DO ENSAIO: em vez de dormir, a espera ADIANTA um relógio. O ritmo
 * de 4 s entre mensagens do mesmo número continua valendo — só que sem os
 * 4 s de verdade. Tudo que carimba hora usa `relogio()`.
 */
const tempo = { desloc: 0 };
const esperar = async (ms: number) => {
  tempo.desloc += ms;
};
const relogio = () => new Date(Date.now() + tempo.desloc);
const daqui = (ms: number) => new Date(relogio().getTime() + ms);
const ENV: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: "development",
};

async function main() {
  if (process.argv.includes("--apagar")) {
    await limparBancoDeEnsaio();
    console.log("banco de ensaio esvaziado");
    return;
  }

  await limparBancoDeEnsaio();
  const cenario = await montarCenario();
  reiniciarSimulador();
  const agora = relogio();

  // O login do Diretor fictício. A senha nasce aqui e vai para um arquivo na
  // pasta temporária — nunca para a tela nem para o repositório.
  const senha = randomBytes(12).toString("base64url");
  await db.usuario.update({
    where: { id: cenario.diretor },
    data: { senhaHash: await bcrypt.hash(senha, 12) },
  });
  const arquivoDaSenha = join(tmpdir(), "tetteo-ensaio-login.txt");
  writeFileSync(arquivoDaSenha, `diretor@ensaio.invalid\n${senha}\n`, {
    mode: 0o600,
  });

  const diretor = await contextoDe(cenario.diretor, cenario.centroId);
  const ana = await contextoDe(cenario.ana, cenario.centroId);
  const carla = await contextoDe(cenario.carla, cenario.centroId);
  const conexao = {
    id: cenario.conexaoId,
    organizacaoId: cenario.organizacaoId,
  };

  const evento = async (e: EventoNormalizado) => {
    const { id } = await registrarEvento(conexao, e, relogio());
    await processarEvento(id, relogio(), e);
    return id;
  };

  // 1. O fechamento do checklist vira rascunho — "Para revisar".
  await coletarRascunhos(agora, process.env.APP_URL ?? null);

  // 2. Um rascunho preparado à mão pela operadora.
  await criarRascunho(
    carla,
    {
      titulo: "Entrega de queijo atrasada",
      texto:
        "O fornecedor avisou que a mussarela só chega às 14h.\nO almoço roda com o estoque da câmara.",
      unidadeId: cenario.centroId,
    },
    agora,
  );

  const confirmadoPelaAna = async (titulo: string, texto: string) => {
    const { id } = await criarRascunho(
      ana,
      { titulo, texto, unidadeId: cenario.centroId },
      relogio(),
    );
    await confirmarAviso(ana, id, cenario.vinculoAna, relogio());
    await entregarAvisos({
      agora: relogio(),
      limite: 1,
      apenasId: id,
      env: ENV,
      esperar,
      relogio,
    });
    return db.avisoWhatsapp.findUniqueOrThrow({ where: { id } });
  };

  // 3. Um aviso que foi até o fim: aceito → entregue → lido. O "entregue"
  //    chega duas vezes, como a Evolution faz — e só conta uma.
  const lido = await confirmadoPelaAna(
    "Caixa conferido",
    "O fechamento de ontem bateu com o extrato. Nada a corrigir.",
  );
  const entregueLido: EventoNormalizado = {
    tipo: "messages.update",
    idExterno: `status:${lido.idMensagemProvedor}:DELIVERY_ACK`,
    idMensagem: lido.idMensagemProvedor ?? "",
    status: "DELIVERY_ACK",
    deMim: true,
  };
  await evento(entregueLido);
  await registrarEvento(conexao, entregueLido, relogio());
  await evento({
    tipo: "messages.update",
    idExterno: `status:${lido.idMensagemProvedor}:READ`,
    idMensagem: lido.idMensagemProvedor ?? "",
    status: "READ",
    deMim: true,
  });

  // 4. Um entregue, ainda não lido.
  const entregue = await confirmadoPelaAna(
    "Forno desligado",
    "Forno e exaustor desligados às 23:50. Gás fechado.",
  );
  await evento({
    tipo: "messages.update",
    idExterno: `status:${entregue.idMensagemProvedor}:DELIVERY_ACK`,
    idMensagem: entregue.idMensagemProvedor ?? "",
    status: "DELIVERY_ACK",
    deMim: true,
  });

  // 5. Um aceito pelo provedor, sem notícia de entrega ainda.
  await confirmadoPelaAna(
    "Contagem da câmara fria feita",
    "A contagem semanal da câmara fria foi concluída às 22:10.",
  );

  // 6. Um resultado desconhecido: a Evolution não respondeu, e a consulta não
  //    achou a mensagem. Fica esperando uma pessoa.
  simulador().comportamento = "tempo-esgotado-nao-saiu";
  await confirmadoPelaAna(
    "Pendência da coifa resolvida",
    "A coifa foi limpa e a pendência de segunda-feira pode ser fechada.",
  );
  simulador().comportamento = "aceita";
  await verificarIncertos({ agora: daqui(30_000), env: ENV });

  // 7. Uma falha: o destinatário não está autorizado para avisos.
  const referenciaDaFalha = gerarReferencia();
  const falha = await db.avisoWhatsapp.create({
    data: {
      organizacaoId: cenario.organizacaoId,
      unidadeId: cenario.centroId,
      instanciaId: cenario.conexaoId,
      idPedido: "demo:falha-destinatario",
      referencia: referenciaDaFalha,
      origemTipo: "manual",
      titulo: "Troca de turno",
      corpo: montarCorpo({
        titulo: "Troca de turno",
        linhas: ["Carla assume o caixa às 18h."],
        link: null,
        referencia: referenciaDaFalha,
      }),
      destinatarioRef: cenario.vinculoCarla,
      status: "CONFIRMADO",
      confirmadoEm: relogio(),
      confirmadoPorId: cenario.ana,
      solicitadoPorId: cenario.ana,
    },
  });
  await entregarAvisos({
    agora: relogio(),
    limite: 1,
    apenasId: falha.id,
    env: ENV,
    esperar,
    relogio,
  });

  // 8. Um descartado.
  const descartado = await criarRascunho(
    carla,
    {
      titulo: "Teste de texto",
      texto: "Só para ver como fica. Pode apagar.",
      unidadeId: cenario.centroId,
    },
    relogio(),
  );
  await descartarAviso(carla, descartado.id, relogio());

  // 9. Eventos de cada tipo — inclusive os ignorados, e um que falhou.
  await evento({
    tipo: "connection.update",
    idExterno: "conexao:demo-open",
    estado: "open",
    codigo: 200,
    numero: "5511900000001",
  });
  await evento({
    tipo: "send.message",
    idExterno: "envio:3EB0DEMOFORA01",
    idMensagem: "3EB0DEMOFORA01",
    hashTexto: "0".repeat(64),
    enviadaEm: relogio(),
  });
  await evento({
    tipo: "messages.upsert",
    idExterno: "entrada:3EB0DEMOPROPRIA01",
    idMensagem: "3EB0DEMOPROPRIA01",
    deMim: true,
    grupo: false,
    vinculoId: null,
  });
  await evento({
    tipo: "messages.upsert",
    idExterno: "entrada:3EB0DEMOGRUPO01",
    idMensagem: "3EB0DEMOGRUPO01",
    deMim: false,
    grupo: true,
    vinculoId: null,
  });
  const quebrado = await db.eventoWhatsapp.create({
    data: {
      organizacaoId: cenario.organizacaoId,
      instanciaId: cenario.conexaoId,
      idExterno: "demo:tipo-desconhecido",
      tipo: "labels.edit",
      resumo: {},
    },
  });
  await processarEvento(quebrado.id, relogio());

  // 10. O webhook "aplicado" pelo Tetteo — grava a data na conexão.
  await aplicarEventosDaConexao(diretor, cenario.conexaoId, ENV);

  const porStatus = await db.avisoWhatsapp.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log(
    "avisos:",
    porStatus.map((l) => `${l.status}=${l._count._all}`).join(" "),
  );
  console.log("eventos:", await db.eventoWhatsapp.count());
  console.log(`login do Diretor fictício gravado em: ${arquivoDaSenha}`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
