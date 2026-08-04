"use client";

import { Botao } from "@/design-system/botao";

import { alternarAcessoAcao, trocarPapelAcao } from "../acoes";

type Pessoa = {
  acessoId: string;
  usuarioId: string;
  nome: string;
  email: string;
  status: string;
  papel: { id: string; nome: string };
  unidade: { id: string; nome: string } | null;
  ehDono: boolean;
  ehVoce: boolean;
  ultimoAcessoEm: Date | null;
};

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * QUEM ENTRA NO SISTEMA.
 *
 * A coluna que decide tudo é "Onde": vazio significa a REDE INTEIRA, e é a
 * diferença entre o gerente que vê a própria loja e quem vê todas. Escrever
 * "Rede inteira" por extenso, em vez de deixar a célula vazia, evita a leitura
 * errada de que a pessoa não tem loja nenhuma.
 *
 * Trocar o papel é um `select` que salva ao mudar, sem botão: é a operação
 * mais frequente aqui, e um passo a menos numa tela de dez pessoas conta.
 */
export function ListaPessoas({
  pessoas,
  papeis,
  podeEditar,
}: {
  pessoas: Pessoa[];
  papeis: { id: string; nome: string }[];
  podeEditar: boolean;
}) {
  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-surface-2 border-line border-b">
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Pessoa
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Onde
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Papel
            </th>
            <th className="text-ink-3 px-4 py-2.5 text-left text-xs font-semibold tracking-wider uppercase">
              Último acesso
            </th>
            <th className="w-px px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => (
            <tr
              key={p.acessoId}
              className={`border-line border-b last:border-b-0 ${p.status === "SUSPENSO" ? "opacity-55" : ""}`}
            >
              <td className="px-4 py-2.5">
                <span className="text-ink block font-medium">
                  {p.nome}
                  {p.ehVoce && (
                    <span className="bg-accent-sub text-accent ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      você
                    </span>
                  )}
                  {p.status === "SUSPENSO" && (
                    <span className="bg-warn-sub text-warn ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      suspenso
                    </span>
                  )}
                </span>
                <span className="text-ink-3 block text-xs">{p.email}</span>
              </td>

              <td className="text-ink-2 px-4 py-2.5">
                {p.unidade ? (
                  p.unidade.nome
                ) : (
                  <span className="font-medium">Rede inteira</span>
                )}
              </td>

              <td className="px-4 py-2.5">
                {podeEditar && !p.ehVoce ? (
                  <form action={trocarPapelAcao}>
                    <input type="hidden" name="acessoId" value={p.acessoId} />
                    <select
                      name="papelId"
                      defaultValue={p.papel.id}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="border-line-2 bg-surface text-ink focus:border-accent h-8 rounded-md border px-2 text-sm focus:outline-none"
                    >
                      {papeis.map((papel) => (
                        <option key={papel.id} value={papel.id}>
                          {papel.nome}
                        </option>
                      ))}
                    </select>
                  </form>
                ) : (
                  <span className="text-ink-2">{p.papel.nome}</span>
                )}
              </td>

              <td className="text-ink-3 px-4 py-2.5 tabular-nums">
                {p.ultimoAcessoEm ? quando.format(p.ultimoAcessoEm) : "nunca"}
              </td>

              <td className="px-4 py-2.5 text-right">
                {podeEditar && !p.ehVoce && (
                  <form action={alternarAcessoAcao}>
                    <input type="hidden" name="acessoId" value={p.acessoId} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      {p.status === "ATIVO" ? "Suspender" : "Reativar"}
                    </Botao>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
