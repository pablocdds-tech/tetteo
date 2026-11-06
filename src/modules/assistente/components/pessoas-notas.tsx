"use client";
import { useActionState } from "react";
import { Botao } from "@/design-system/botao";
import { Etiqueta } from "@/design-system/etiqueta";
import { alterarAutorizacaoNotaAcao } from "../acoes-notas";
import type { PessoaNotas } from "../services/notas-autorizacao";
import { formatarTelefone } from "../schemas/telefone-notas";

export function PessoaAutorizacaoNotas({
  pessoa,
  podeAutorizar,
  unidadeId,
}: {
  pessoa: PessoaNotas;
  podeAutorizar: boolean;
  unidadeId: string;
}) {
  const [estado, acao, pendente] = useActionState(
    alterarAutorizacaoNotaAcao,
    {},
  );
  const ativa = pessoa.autorizada && pessoa.elegivel;
  return (
    <li className="border-line py-5 first:pt-0 last:pb-0 [&+li]:border-t">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{pessoa.nome}</h3>
            <Etiqueta
              tom={ativa ? "ok" : pessoa.autorizada ? "aviso" : "neutro"}
            >
              {ativa
                ? "Autorizado para notas"
                : pessoa.autorizada
                  ? "Notas bloqueadas por acesso"
                  : "Não autorizado para notas"}
            </Etiqueta>
          </div>
          <p className="text-ink-2 mt-1 tabular-nums">
            {formatarTelefone(pessoa.telefone)}
          </p>
          <p className="text-ink-3 mt-1 text-sm">
            Avisos: {pessoa.recebeAvisos ? "recebe" : "não recebe"} ·
            autorização independente
          </p>
          {pessoa.autorizada && pessoa.autorizadoPor ? (
            <p className="text-ink-3 mt-1 text-sm">
              Notas autorizadas por {pessoa.autorizadoPor}
              {pessoa.autorizadoEm
                ? ` em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(new Date(pessoa.autorizadoEm))}`
                : ""}
              .
            </p>
          ) : null}
          {pessoa.motivo ? (
            <p className="text-warn mt-2 text-sm">{pessoa.motivo}</p>
          ) : null}
        </div>
        {podeAutorizar ? (
          <form action={acao} className="shrink-0">
            <input type="hidden" name="vinculoId" value={pessoa.id} />
            <input type="hidden" name="unidadeId" value={unidadeId} />
            <input type="hidden" name="usuarioId" value={pessoa.usuarioId} />
            <input type="hidden" name="telefone" value={pessoa.telefone} />
            <input type="hidden" name="versao" value={pessoa.versao} />
            <input
              type="hidden"
              name="autorizar"
              value={pessoa.autorizada ? "nao" : "sim"}
            />
            <Botao
              type="submit"
              peso="secundario"
              carregando={pendente}
              disabled={!pessoa.autorizada && !pessoa.elegivel}
              className="min-h-11"
              aria-label={`${pessoa.autorizada ? "Revogar notas de" : "Autorizar notas para"} ${pessoa.nome}`}
            >
              {pessoa.autorizada ? "Revogar notas" : "Autorizar notas"}
            </Botao>
          </form>
        ) : null}
      </div>
      {estado.erro ? (
        <p role="alert" className="text-bad mt-3 text-sm">
          {estado.erro}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-ok mt-3 text-sm">
          Autorização de notas atualizada. A autorização de avisos foi
          preservada.
        </p>
      ) : null}
    </li>
  );
}
