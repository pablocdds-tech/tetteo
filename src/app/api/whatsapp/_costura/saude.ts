import { provedorPara } from "@/connectors/whatsapp";
import {
  conexoesCadastradas,
  registrarConsulta,
} from "@/modules/assistente/services/conexao";

/**
 * A SAÚDE DO NÚMERO — a consulta que o relógio faz a cada minuto.
 *
 * Existe porque a queda não avisa: quando o celular fica sem internet, a
 * Evolution 2.3.7 tenta reconectar calada e não manda evento nenhum. Sem esta
 * consulta, "desconectado" só seria descoberto quando alguém reclamasse que o
 * aviso não chegou.
 *
 * Configuração pendente não é gravada: não é estado do número, é falta do
 * servidor — e a tela a mostra, calculada na hora.
 */

type Ambiente = Record<string, string | undefined>;

export async function atualizarSaude({
  agora,
  env = process.env,
  apenasId,
}: {
  agora: Date;
  env?: Ambiente;
  apenasId?: string;
}): Promise<number> {
  let consultadas = 0;
  for (const conexao of await conexoesCadastradas(apenasId)) {
    const r = await provedorPara(conexao, env).consultarConexao({
      // O número do aparelho só é pedido enquanto o Tetteo não o conhece.
      comNumero: !conexao.numeroProprio,
    });
    if (r.tipo === "pendente") continue;

    await registrarConsulta(
      conexao.id,
      r.tipo === "ok"
        ? { tipo: "ok", estado: r.estado }
        : { tipo: "erro", motivo: r.motivo },
      r.tipo === "ok" ? r.numero : null,
      agora,
    );
    consultadas++;
  }
  return consultadas;
}
