import { provedorPara } from "@/connectors/whatsapp";
import { configuracaoWebhook } from "@/connectors/whatsapp/configuracao";
import {
  EVENTOS_ASSINADOS,
  type ConfiguracaoDeEventos,
  type QrCode,
} from "@/connectors/whatsapp/tipos";
import type { ContextoSessao } from "@/core/sessao/contexto";
import { mascararTelefone } from "@/lib/telefone";
import {
  estadoParaExibir,
  ROTULO_DO_ESTADO,
  type EstadoNaTela,
} from "@/modules/assistente/schemas/conexao";
import {
  exigirNaLojaDaConexao,
  obterConexao,
  podeNaLoja,
  registrarConsulta,
  registrarEventosConfigurados,
  registrarPedidoDeQr,
} from "@/modules/assistente/services/conexao";

/**
 * O QUE A TELA "WHATSAPP" PRECISA DO PROVEDOR.
 *
 * Mora em `app/` porque junta as duas pontas: pergunta ao conector e grava
 * pela Severina. As ações da tela (`acoes-whatsapp.ts`) são uma casca fina
 * sobre estas funções — e o ensaio chama estas funções direto.
 */

type Ambiente = Record<string, string | undefined>;

export type EventosNaTela = ConfiguracaoDeEventos & {
  esperados: string[];
  /** Tudo como o Tetteo precisa: ativo, os 3 eventos, com senha, no endereço certo. */
  confere: boolean;
};

export type TelaDaConexao = {
  id: string;
  nome: string;
  provedor: "EVOLUTION_BAILEYS" | "SIMULADO";
  unidadeId: string | null;
  unidadeNome: string | null;
  estado: EstadoNaTela;
  rotulo: string;
  motivo: string | null;
  numero: string;
  atualizadoEm: Date | null;
  estadoDesde: Date | null;
  envioLigado: boolean;
  agendamentosPausados: boolean;
  eventos: EventosNaTela | null;
  eventosConfiguradosEm: Date | null;
  webhookPendente: string[];
  podeConectar: boolean;
};

function origemECaminho(url: string): string {
  try {
    const lida = new URL(url);
    return `${lida.origin}${lida.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Lê o estado AGORA (limite de 4 s) e grava o que ouviu. Se faltar
 * configuração, nada é gravado: o estado mostrado é "Configuração pendente",
 * com o NOME do que falta.
 */
export async function lerConexaoParaTela(
  contexto: ContextoSessao,
  conexaoId: string,
  env: Ambiente = process.env,
  agora: Date = new Date(),
): Promise<TelaDaConexao> {
  const conexao = await obterConexao(contexto, conexaoId);
  if (!conexao) throw new Error("Conexão não encontrada.");

  const provedor = provedorPara(conexao, env);
  const consulta = await provedor.consultarConexao({
    comNumero: !conexao.numeroProprio,
  });

  let faltando: string[] = [];
  if (consulta.tipo === "pendente") {
    faltando = consulta.faltando;
  } else {
    await registrarConsulta(
      conexao.id,
      consulta.tipo === "ok"
        ? { tipo: "ok", estado: consulta.estado }
        : { tipo: "erro", motivo: consulta.motivo },
      consulta.tipo === "ok" ? consulta.numero : null,
      agora,
    );
  }

  const atual = (await obterConexao(contexto, conexaoId)) ?? conexao;
  const exibido = estadoParaExibir(atual, faltando, agora);
  const podeConectar = await podeNaLoja(
    contexto.usuario.id,
    conexao.unidadeId,
    "assistente.conectar",
  );

  const configWebhook = configuracaoWebhook(env);
  let eventos: EventosNaTela | null = null;
  if (podeConectar && consulta.tipo !== "pendente") {
    const lidos = await provedor.lerEventos();
    if (lidos.ok) {
      const esperados = [...EVENTOS_ASSINADOS];
      eventos = {
        ...lidos.valor,
        esperados,
        confere:
          lidos.valor.ativo &&
          lidos.valor.comSenha &&
          esperados.every((e) => lidos.valor.eventos.includes(e)) &&
          (configWebhook.tipo !== "ok" ||
            lidos.valor.url === origemECaminho(configWebhook.url)),
      };
    }
  }

  return {
    id: atual.id,
    nome: atual.nome,
    provedor: atual.provedor,
    unidadeId: atual.unidadeId,
    unidadeNome: atual.unidadeNome,
    estado: exibido.estado,
    rotulo: ROTULO_DO_ESTADO[exibido.estado],
    motivo: exibido.motivo,
    numero: mascararTelefone(atual.numeroProprio),
    atualizadoEm: atual.vistoEm,
    estadoDesde: atual.estadoDesde,
    envioLigado: atual.ativa,
    agendamentosPausados: atual.agendamentosPausados,
    eventos,
    eventosConfiguradosEm: atual.eventosConfiguradosEm,
    webhookPendente:
      configWebhook.tipo === "pendente" ? configWebhook.faltando : [],
    podeConectar,
  };
}

/**
 * RECONECTAR / VER O QR CODE.
 *
 * Só quem pode conectar NA LOJA DA CONEXÃO. A permissão é conferida antes de
 * o provedor ser chamado: para quem não pode, o QR nem chega a ser pedido.
 *
 * Com o número conectado, a 2.3.7 só confirma que está conectado — nada
 * derruba. O QR, quando vem, volta dentro desta resposta e não é gravado:
 * a auditoria registra QUEM pediu, nunca a imagem.
 */
export async function pedirQrCodeDaConexao(
  contexto: ContextoSessao,
  conexaoId: string,
  env: Ambiente = process.env,
): Promise<QrCode> {
  const conexao = await exigirNaLojaDaConexao(
    contexto,
    conexaoId,
    "assistente.conectar",
    "ver o QR Code do WhatsApp",
  );

  const r = await provedorPara(conexao, env).pedirQrCode();
  if (!r.ok) throw new Error(r.motivo);

  await registrarPedidoDeQr(contexto, conexao);
  if (r.valor.tipo === "ja-conectado") {
    await registrarConsulta(
      conexao.id,
      { tipo: "ok", estado: "CONECTADO" },
      null,
      new Date(),
    );
  }
  return r.valor;
}

/**
 * APLICAR A CONFIGURAÇÃO DE EVENTOS na instância.
 *
 * Substitui o webhook que estiver lá — por isso a tela mostra o atual antes.
 * Assina só os três eventos de que o Tetteo precisa, com a senha do passe em
 * `jwt_key`.
 */
export async function aplicarEventosDaConexao(
  contexto: ContextoSessao,
  conexaoId: string,
  env: Ambiente = process.env,
): Promise<{ eventos: string[] }> {
  const conexao = await exigirNaLojaDaConexao(
    contexto,
    conexaoId,
    "assistente.conectar",
    "configurar os eventos do WhatsApp",
  );
  const config = configuracaoWebhook(env);
  if (config.tipo === "pendente") {
    throw new Error(
      `Falta configurar no servidor: ${config.faltando.join(", ")}.`,
    );
  }

  const r = await provedorPara(conexao, env).configurarEventos({
    url: config.url,
    senha: config.chave,
    eventos: EVENTOS_ASSINADOS,
  });
  if (!r.ok) throw new Error(r.motivo);

  await registrarEventosConfigurados(
    contexto,
    conexao.id,
    r.valor.eventos,
    new Date(),
  );
  return r.valor;
}
