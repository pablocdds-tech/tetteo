import { configuracaoEvolution } from "./configuracao";
import { criarProvedorEvolution } from "./evolution";
import { criarProvedorSimulado } from "./simulado";
import type { ProvedorWhatsapp } from "./tipos";

/**
 * QUAL PROVEDOR FALA POR ESTA CONEXÃO.
 *
 * A linha da conexão diz o provedor; o ambiente do servidor diz a credencial.
 * A credencial só vale para a instância que ela nomeia: se o banco disser uma
 * instância e o ambiente outra, a resposta é "configuração pendente" — nunca
 * usar a chave de um número para falar com outro.
 */

export type ConexaoDoProvedor = {
  provedor: "EVOLUTION_BAILEYS" | "SIMULADO";
  nome: string;
};

type Ambiente = Record<string, string | undefined>;

export function provedorPara(
  conexao: ConexaoDoProvedor,
  env: Ambiente = process.env,
): ProvedorWhatsapp {
  if (conexao.provedor === "SIMULADO") {
    // O simulado aceita qualquer coisa e não envia nada. Em produção, isso
    // seria um número que "funciona" e nunca avisa ninguém.
    if (env.NODE_ENV === "production") {
      return indisponivel("O provedor simulado não funciona em produção.", []);
    }
    return criarProvedorSimulado();
  }

  const config = configuracaoEvolution(env);
  if (config.tipo === "pendente") {
    return indisponivel(
      `Configuração pendente: ${config.faltando.join(", ")}.`,
      config.faltando,
    );
  }
  // Não é "falta configurar": é um nome que não bate. A frase diz os dois e a
  // tela WhatsApp oferece adotar o configurado — o cadastro nasce com nome
  // provisório quando a variável ainda não existia.
  if (config.instancia !== conexao.nome) {
    return indisponivel(
      `O servidor está configurado para a instância "${config.instancia}", mas este cadastro se chama "${conexao.nome}". Confira EVOLUTION_INSTANCIA no servidor, ou adote o nome configurado neste cadastro.`,
      [],
    );
  }
  return criarProvedorEvolution(config);
}

/** O provedor que diz "não posso" em toda operação, com o motivo. */
function indisponivel(motivo: string, faltando: string[]): ProvedorWhatsapp {
  const recusa = { ok: false as const, motivo, faltando };
  return {
    nome: "indisponivel",
    consultarConexao: async () =>
      faltando.length > 0
        ? { tipo: "pendente", faltando }
        : { tipo: "erro", motivo },
    lerEventos: async () => recusa,
    configurarEventos: async () => recusa,
    pedirQrCode: async () => recusa,
    enviarMensagem: async () => ({ tipo: "nao-chegou", motivo }),
    consultarMensagem: async () => recusa,
  };
}
