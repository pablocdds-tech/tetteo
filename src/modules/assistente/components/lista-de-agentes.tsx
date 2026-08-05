import { Botao } from "@/design-system/botao";

import { alternarAgenteAcao, excluirAgenteAcao } from "../acoes";
import type { AgenteNaLista } from "../services/agentes";

const GATILHOS: Record<string, string> = {
  HORARIO: "Em horário fixo",
  ROTINA_VENCIDA: "Quando a contagem vence",
  DISCREPANCIA: "Quando algo foge do normal",
  MENSAGEM_RECEBIDA: "Quando alguém escreve",
};

/**
 * A lista de agentes.
 *
 * O estado ligado/desligado é a informação mais importante da linha, e por
 * isso vem antes do nome: quem abre esta tela quase sempre veio saber se algo
 * está falando quando não devia.
 */
export function ListaDeAgentes({
  agentes,
  podeConfigurar,
}: {
  agentes: AgenteNaLista[];
  podeConfigurar: boolean;
}) {
  if (agentes.length === 0) {
    return (
      <div className="border-line text-ink-3 rounded-xl border border-dashed px-4 py-10 text-center text-sm">
        Nenhum agente ainda. Crie o primeiro e a Severina começa a cobrar
        sozinha.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {agentes.map((a) => (
        <li
          key={a.id}
          className="border-line bg-surface-2 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
        >
          <span
            aria-label={a.ativo ? "Ligado" : "Desligado"}
            title={a.ativo ? "Ligado" : "Desligado"}
            className={`h-2.5 w-2.5 flex-none rounded-full ${
              a.ativo ? "bg-good" : "bg-line-2"
            }`}
          />

          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{a.nome}</span>
            <span className="text-ink-3 block text-sm">
              {GATILHOS[a.gatilho] ?? a.gatilho}
              {a.horario ? ` · ${a.horario}` : ""}
              {a.unidadeNome ? ` · ${a.unidadeNome}` : " · todas as lojas"}
              {` · ${a.destinatarios} destinatário${a.destinatarios === 1 ? "" : "s"}`}
            </span>
          </span>

          {podeConfigurar && (
            <span className="flex flex-none items-center gap-2">
              <form action={alternarAgenteAcao}>
                <input type="hidden" name="id" value={a.id} />
                <Botao
                  type="submit"
                  peso={a.ativo ? "secundario" : "primario"}
                  tamanho="pequeno"
                >
                  {a.ativo ? "Desligar" : "Ligar"}
                </Botao>
              </form>

              <form action={excluirAgenteAcao}>
                <input type="hidden" name="id" value={a.id} />
                <Botao type="submit" peso="fantasma" tamanho="pequeno">
                  Excluir
                </Botao>
              </form>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
