import type { CanalDeFornecedor } from "@/connectors/fornecedores";
import { INTERVALO_MS, LOTE } from "@/modules/compras/schemas/ritmo-envio";
import { abrirRodadasAgendadas } from "@/modules/compras/services/agenda";
import {
  aplicarConsulta,
  corpoParaEnvio,
  incertasParaConsultar,
  marcarResultado,
  reivindicar,
  vencerTravas,
} from "@/modules/compras/services/fila";

/**
 * O RELÓGIO DE COMPRAS — a única costura entre a fila e o canal.
 *
 * Mora na camada `app/` porque é a única que enxerga módulo e conector ao
 * mesmo tempo. Não decide nada: pergunta à fila, entrega ao canal, grava o
 * que o canal disse. Uma batida, nesta ordem:
 *
 *   1. abre as rodadas agendadas cuja hora chegou;
 *   2. marca como INCERTA quem ficou com a trava vencida (morreu no meio);
 *   3. pergunta ao canal pelas incertas — "aceita" resolve, "não encontrada"
 *      devolve à fila, "desconhecido" deixa para uma pessoa;
 *   4. pega um lote COM TRAVA e envia uma por vez, com respiro.
 *
 * Recebe o canal por parâmetro: nos testes é um simulador com roteiro; em
 * produção, `canalAtivo()`.
 */

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rodarRelogio(
  canal: CanalDeFornecedor,
  opcoes: { dono: string; agora?: Date; intervaloMs?: number },
) {
  const agora = opcoes.agora ?? new Date();
  const intervalo = opcoes.intervaloMs ?? INTERVALO_MS;
  const identidade = { nome: canal.nome, simulado: canal.simulado };

  const abertas = await abrirRodadasAgendadas(agora);
  const travasVencidas = await vencerTravas(agora);

  let conferidas = 0;
  for (const m of await incertasParaConsultar()) {
    // Só o canal que tentou sabe responder sobre a própria mensagem.
    if (m.canal && m.canal !== canal.nome) continue;
    const consulta = await canal.consultar({
      chave: m.chave,
      idProvedor: m.idProvedor,
    });
    await aplicarConsulta(m.id, consulta, agora);
    if (consulta !== "desconhecido") conferidas++;
  }

  const lote = await reivindicar(opcoes.dono, LOTE, agora);
  let enviadas = 0;
  let incertas = 0;
  let falhas = 0;

  for (const [indice, m] of lote.entries()) {
    if (indice > 0 && intervalo > 0) await espera(intervalo);

    let texto: string;
    try {
      texto = await corpoParaEnvio(m.id);
    } catch (erro) {
      // Sem texto não há o que enviar (ex.: link revogado). Falha de vez,
      // com o motivo à vista no painel.
      await marcarResultado(
        m.id,
        opcoes.dono,
        {
          tipo: "recusada-antes",
          erro: erro instanceof Error ? erro.message : String(erro),
          tentarDeNovo: false,
        },
        identidade,
        new Date(),
      );
      falhas++;
      continue;
    }

    const resultado = await canal.enviar({
      destino: m.destino,
      texto,
      chave: m.chave,
    });
    await marcarResultado(m.id, opcoes.dono, resultado, identidade, new Date());
    if (resultado.tipo === "aceita") enviadas++;
    else if (resultado.tipo === "incerta") incertas++;
    else falhas++;
  }

  return { abertas, travasVencidas, conferidas, enviadas, incertas, falhas };
}
