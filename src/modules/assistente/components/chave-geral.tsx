import { Botao } from "@/design-system/botao";

import { alternarInstanciaAcao } from "../acoes";

/**
 * A CHAVE GERAL.
 *
 * Desligada, a Severina cala por completo: o disparo não enfileira e a fila
 * não sai. É o botão do dia em que algo der errado — e ele precisa existir
 * ANTES de o dia chegar, não depois.
 *
 * Fica no topo da tela inicial do módulo, não escondido em configurações.
 * Quem precisa dele está com pressa.
 */
export function ChaveGeral({
  instancia,
  podeConfigurar,
}: {
  instancia: {
    id: string;
    nome: string;
    ativa: boolean;
    desconectadaEm: Date | null;
  } | null;
  podeConfigurar: boolean;
}) {
  if (!instancia) {
    return (
      <div className="border-line bg-surface-2 rounded-xl border px-4 py-3 text-sm">
        <strong>Nenhum número configurado.</strong>{" "}
        <span className="text-ink-3">
          Ele é criado sozinho quando você cadastrar o primeiro agente.
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
        instancia.ativa ? "border-line bg-surface-2" : "border-bad/50 bg-bad/10"
      }`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 flex-none rounded-full ${
          instancia.ativa ? "bg-good" : "bg-bad"
        }`}
      />

      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold">
          {instancia.ativa
            ? "Severina ligada"
            : "Severina desligada — nada sai"}
        </span>
        <span className="text-ink-3 block">
          Número: {instancia.nome}
          {instancia.desconectadaEm
            ? ` · última desconexão em ${new Intl.DateTimeFormat("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(instancia.desconectadaEm)}`
            : ""}
        </span>
      </span>

      {podeConfigurar && (
        <form action={alternarInstanciaAcao} className="flex-none">
          <input type="hidden" name="id" value={instancia.id} />
          <Botao
            type="submit"
            peso={instancia.ativa ? "destrutivo" : "primario"}
            tamanho="pequeno"
          >
            {instancia.ativa ? "Desligar tudo" : "Ligar"}
          </Botao>
        </form>
      )}
    </div>
  );
}
