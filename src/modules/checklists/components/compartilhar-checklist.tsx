"use client";

import { useActionState, useState } from "react";
import { Botao } from "@/design-system/botao";
import { atribuirRespostaAcao, type EstadoChecklist } from "../acoes";

const campo =
  "border-line-2 bg-surface min-h-11 w-full rounded-md border px-3 py-2 text-base";

export function CompartilharChecklist({
  respostaId,
  nome,
  pessoas,
  responsavelId,
  prazoEm,
}: {
  respostaId: string;
  nome: string;
  pessoas: { id: string; nome: string }[];
  responsavelId: string | null;
  prazoEm: string | null;
}) {
  const [estado, acao, pendente] = useActionState<EstadoChecklist, FormData>(
    atribuirRespostaAcao,
    {},
  );
  const [copiado, setCopiado] = useState("");
  const [alterado, setAlterado] = useState(false);
  const [selecionado, setSelecionado] = useState(responsavelId ?? "");
  const pronto = Boolean(selecionado) && !alterado && !pendente;
  function link() {
    return `${window.location.origin}/checklists/acessar/${respostaId}`;
  }
  return (
    <section
      className="border-line bg-surface mt-5 rounded-lg border p-4"
      aria-label="Atribuir e compartilhar checklist"
    >
      <h2 className="text-lg font-semibold">Enviar ao funcionário</h2>
      <p className="text-ink-3 mt-1 text-sm">
        O link exige login. Cada resposta registra a conta de quem preencheu.
      </p>
      <form
        action={async (dados) => {
          dados.set(
            "prazoEm",
            dados.get("prazoLocal")
              ? new Date(`${dados.get("prazoLocal")}:00-03:00`).toISOString()
              : "",
          );
          acao(dados);
          setAlterado(false);
        }}
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onChange={() => setAlterado(true)}
      >
        <input type="hidden" name="respostaId" value={respostaId} />
        <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
          Funcionário
          <select
            name="responsavelId"
            required
            value={selecionado}
            onChange={(e) => setSelecionado(e.target.value)}
            className={campo}
          >
            <option value="">Escolha o funcionário</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
          Prazo (horário de Brasília)
          <input
            type="datetime-local"
            name="prazoLocal"
            defaultValue={
              prazoEm
                ? new Intl.DateTimeFormat("sv-SE", {
                    timeZone: "America/Sao_Paulo",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                    .format(new Date(prazoEm))
                    .replace(" ", "T")
                : ""
            }
            className={campo}
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Botao type="submit" peso="secundario" carregando={pendente}>
            Salvar atribuição
          </Botao>
          <Botao
            type="button"
            peso="secundario"
            disabled={!pronto || Boolean(estado.erro)}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link());
                setCopiado("Link copiado.");
              } catch {
                setCopiado(`Copie o link: ${link()}`);
              }
            }}
          >
            Copiar link
          </Botao>
          <Botao
            type="button"
            disabled={!pronto || Boolean(estado.erro)}
            onClick={() => {
              const funcionario =
                pessoas.find((p) => p.id === selecionado)?.nome ?? "";
              window.open(
                `https://wa.me/?text=${encodeURIComponent(`${funcionario}, preencha o checklist “${nome}”. Entre com sua conta para registrar as respostas: ${link()}`)}`,
                "_blank",
                "noopener,noreferrer",
              );
            }}
          >
            Abrir no WhatsApp
          </Botao>
        </div>
      </form>
      {alterado && (
        <p className="text-warn mt-2 text-sm">
          Salve a atribuição antes de compartilhar.
        </p>
      )}
      {(estado.erro || estado.ok || copiado) && (
        <p
          role={estado.erro ? "alert" : "status"}
          className={`mt-2 text-sm break-words ${estado.erro ? "text-bad" : "text-ink-2"}`}
        >
          {estado.erro || estado.ok || copiado}
        </p>
      )}
    </section>
  );
}
