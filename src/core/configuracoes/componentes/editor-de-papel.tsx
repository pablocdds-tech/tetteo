"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";

import { salvarPapelAcao, type EstadoConfig } from "../acoes";
import type { GrupoDePermissoes } from "../permissoes";

/**
 * O EDITOR DE PAPEL.
 *
 * As permissões vêm agrupadas por App, com o ícone e a cor do próprio App —
 * as mesmas do painel de módulos. Não é enfeite: quem monta um papel pensa
 * "o que o caixa faz no Estoque?", não "quais chaves começam com estoque.".
 *
 * A descrição de cada permissão é a que o App escreveu no manifesto. Mostrar
 * a chave técnica (`estoque.contar`) ao lado seria ruído para quem decide, e
 * a frase já diz o que ela libera.
 */
export function EditorDePapel({
  grupos,
  papel,
}: {
  grupos: GrupoDePermissoes[];
  papel?: {
    id: string;
    nome: string;
    descricao: string | null;
    temCoringa: boolean;
    permissoes: string[];
  };
}) {
  const [estado, acao, enviando] = useActionState<EstadoConfig, FormData>(
    salvarPapelAcao,
    {},
  );
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(papel?.permissoes ?? []),
  );

  function alternar(chave: string) {
    setMarcadas((antes) => {
      const novo = new Set(antes);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  function alternarGrupo(grupo: GrupoDePermissoes) {
    const chaves = grupo.permissoes.map((p) => p.chave);
    const todasMarcadas = chaves.every((c) => marcadas.has(c));
    setMarcadas((antes) => {
      const novo = new Set(antes);
      for (const c of chaves) {
        if (todasMarcadas) novo.delete(c);
        else novo.add(c);
      }
      return novo;
    });
  }

  // Só o papel DONO trava. Cozinha, Caixa, Gerente e Financeiro vêm com o
  // sistema mas existem para serem ajustados à operação de cada casa.
  const bloqueado = papel?.temCoringa === true;

  return (
    <form action={acao} className="flex flex-col gap-5">
      {papel && <input type="hidden" name="id" value={papel.id} />}
      {[...marcadas].map((chave) => (
        <input key={chave} type="hidden" name="permissoes" value={chave} />
      ))}
      {/* O papel de dono guarda o coringa; o editor não o mostra como caixinha
          porque "pode tudo" não é uma permissão entre outras. */}
      {bloqueado && <input type="hidden" name="permissoes" value="*" />}

      <div className="grid max-w-[640px] gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome do papel"
          name="nome"
          defaultValue={papel?.nome ?? ""}
          placeholder="Ex.: Cozinha"
          erro={estado.erros?.nome}
          readOnly={bloqueado}
          ajuda={
            bloqueado ? "O papel de dono não pode ser renomeado." : undefined
          }
          required
        />
        <Campo
          rotulo="Descrição"
          name="descricao"
          defaultValue={papel?.descricao ?? ""}
          placeholder="Ex.: conta estoque, não vê preço"
          erro={estado.erros?.descricao}
        />
      </div>

      {bloqueado ? (
        <div className="border-line bg-surface-2 rounded-xl border px-5 py-4">
          <p className="font-semibold">Este papel tem acesso total</p>
          <p className="text-ink-3 mt-1 text-sm">
            É o papel de dono do sistema: ele acompanha automaticamente todo App
            novo que for instalado, sem precisar marcar nada. Para dar menos
            poder a alguém, crie um papel novo em vez de reduzir este.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">O que este papel pode fazer</h2>
            <p className="text-ink-3 mt-1 text-sm">
              Agrupado por módulo. Marcar nada em um módulo faz o ícone dele nem
              aparecer para essa pessoa — melhor do que aparecer e dar
              &quot;acesso negado&quot;.
            </p>
          </div>

          {grupos.map((grupo) => {
            const chaves = grupo.permissoes.map((p) => p.chave);
            const todas = chaves.every((c) => marcadas.has(c));
            const algumas = chaves.some((c) => marcadas.has(c));

            return (
              <section
                key={grupo.chaveApp}
                className="border-line overflow-hidden rounded-xl border"
              >
                <div className="bg-surface-2 border-line flex items-center gap-3 border-b px-4 py-2.5">
                  <span
                    aria-hidden
                    className="grid size-7 flex-none place-items-center rounded-lg"
                    style={{
                      background: grupo.cor.fundo,
                      color: grupo.cor.frente,
                    }}
                  >
                    <Icone nome={grupo.icone} tamanho={15} />
                  </span>
                  <span className="flex-1 font-semibold">{grupo.nome}</span>
                  <span className="text-ink-3 text-xs tabular-nums">
                    {chaves.filter((c) => marcadas.has(c)).length} de{" "}
                    {chaves.length}
                  </span>
                  <Botao
                    type="button"
                    peso="fantasma"
                    tamanho="pequeno"
                    onClick={() => alternarGrupo(grupo)}
                  >
                    {todas ? "Desmarcar" : algumas ? "Marcar tudo" : "Marcar"}
                  </Botao>
                </div>

                <div className="divide-line divide-y">
                  {grupo.permissoes.map((p) => (
                    <label
                      key={p.chave}
                      className="hover:bg-surface-2 flex cursor-pointer items-start gap-3 px-4 py-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={marcadas.has(p.chave)}
                        onChange={() => alternar(p.chave)}
                        className="accent-accent mt-0.5 size-4 flex-none"
                      />
                      <span>{p.descricao}</span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Botao type="submit" carregando={enviando}>
          {papel ? "Salvar papel" : "Criar papel"}
        </Botao>
        <Link href="/configuracoes/usuarios">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
