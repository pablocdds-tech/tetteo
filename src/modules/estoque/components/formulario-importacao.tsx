"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";

import {
  analisarImportacao,
  confirmarImportacao,
  type EstadoImportacao,
} from "../acoes";

/**
 * IMPORTAR O CADASTRO EM LOTE.
 *
 * Duas etapas, e a primeira é a que importa: nada é gravado antes de a pessoa
 * ver o que vai acontecer. Duzentos e sessenta produtos entram de uma vez, e
 * ninguém confere isso item a item depois — a hora de conferir é antes.
 *
 * A prévia mostra três coisas em ordem de risco: o que vai ser JUNTADO (é a
 * decisão mais forte que o sistema toma sozinho), o que veio com AVISO, e só
 * então a contagem geral.
 */
export function FormularioImportacao() {
  const [analise, acaoAnalisar, analisando] = useActionState<
    EstadoImportacao,
    FormData
  >(analisarImportacao, {});

  const [gravacao, acaoConfirmar, gravando] = useActionState<
    EstadoImportacao,
    FormData
  >(confirmarImportacao, {});

  if (gravacao.resumo) {
    const r = gravacao.resumo;
    return (
      <div className="border-line bg-surface-2 rounded-xl border px-6 py-8 text-center">
        <p aria-hidden className="text-2xl">
          ✅
        </p>
        <p className="mt-2 text-lg font-semibold">Cadastro importado</p>
        <p className="text-ink-3 mx-auto mt-1 max-w-lg text-sm">
          {r.linhas} linhas da planilha viraram{" "}
          <strong className="text-ink">{r.insumosCriados} insumos novos</strong>
          {r.insumosAtualizados > 0 && ` e ${r.insumosAtualizados} atualizados`}
          , com {r.posicoes} posições distribuídas em {r.locais} lugares.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Link href="/cardapio">
            <Botao>Ver os insumos</Botao>
          </Link>
          <Link href="/estoque/contagens/nova">
            <Botao peso="secundario">Abrir a primeira contagem</Botao>
          </Link>
        </div>
      </div>
    );
  }

  const plano = gravacao.plano ?? analise.plano;
  const texto = gravacao.texto ?? analise.texto ?? "";
  const erro = gravacao.erro ?? analise.erro;

  const fundidos = plano?.insumos.filter((i) => i.posicoes.length > 1) ?? [];
  const comAviso = plano?.insumos.filter((i) => i.avisos.length > 0) ?? [];

  return (
    <div className="flex flex-col gap-6">
      {!plano && (
        <form action={acaoAnalisar} className="flex flex-col gap-3">
          <label
            htmlFor="planilha"
            className="text-ink-2 text-sm font-semibold"
          >
            Cole a planilha aqui
          </label>
          <p className="text-ink-3 -mt-2 text-sm">
            Abra a planilha, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole
            aqui. A primeira linha precisa ser o título das colunas — o sistema
            procura por <strong>Produto</strong>, <strong>Unidade</strong>,{" "}
            <strong>Quantidade</strong>, <strong>Preço</strong>,{" "}
            <strong>Estoque mínimo</strong> e <strong>Categorias</strong>.
          </p>

          <textarea
            id="planilha"
            name="planilha"
            rows={10}
            defaultValue={texto}
            placeholder={
              "Produto\tQuantidade\tUnidade\tÚltimo preço\tCategorias\nmussarela\t8\tkg\t38,90\tLATICÍNIOS"
            }
            className="border-line-2 bg-surface text-ink focus:border-accent w-full rounded-md border p-3 font-mono text-xs focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
          />

          {erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
            >
              {erro}
            </p>
          )}

          <div>
            <Botao type="submit" carregando={analisando}>
              Conferir antes de importar
            </Botao>
          </div>
        </form>
      )}

      {plano && (
        <>
          <div className="border-line bg-surface-2 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border px-5 py-4">
            <Numero rotulo="Linhas lidas" valor={plano.linhas.length} />
            <Numero rotulo="Insumos" valor={plano.insumos.length} />
            <Numero rotulo="Juntados" valor={fundidos.length} />
            <Numero rotulo="Lugares" valor={plano.locais.length} />
          </div>

          <p className="text-ink-3 text-sm">
            Lugares encontrados: <strong>{plano.locais.join(" · ")}</strong>
          </p>

          {fundidos.length > 0 && (
            <section>
              <h2 className="font-semibold">
                {fundidos.length} produtos estavam cadastrados em dobro
              </h2>
              <p className="text-ink-3 mt-1 mb-3 text-sm">
                Eram linhas separadas por causa do lugar escrito no nome. Viram
                um produto só, com saldo por lugar — assim &quot;quantas eu
                tenho?&quot; passa a ter uma resposta.
              </p>
              <div className="border-line divide-line max-h-80 divide-y overflow-y-auto rounded-xl border">
                {fundidos.map((i) => (
                  <div key={i.nome} className="px-4 py-2.5 text-sm">
                    <span className="font-medium">{i.nome}</span>
                    <span className="text-ink-3">
                      {" "}
                      · {i.unidadeRotulo ?? i.unidadeMedida.toLowerCase()}
                    </span>
                    <div className="text-ink-3 mt-0.5 flex flex-wrap gap-x-4 text-xs tabular-nums">
                      {i.posicoes.map((p) => (
                        <span key={p.local}>
                          {p.local}: {formatarQuantidade(p.quantidade)}
                        </span>
                      ))}
                      <span className="text-ink">
                        total{" "}
                        {formatarQuantidade(
                          i.posicoes.reduce((s, p) => s + p.quantidade, 0),
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {comAviso.length > 0 && (
            <section>
              <h2 className="font-semibold">
                {comAviso.length} {comAviso.length === 1 ? "item" : "itens"} com
                observação
              </h2>
              <p className="text-ink-3 mt-1 mb-3 text-sm">
                Nada impede a importação. São coisas que valem corrigir depois.
              </p>
              <div className="border-line divide-line max-h-64 divide-y overflow-y-auto rounded-xl border">
                {comAviso.map((i) => (
                  <div key={i.nome} className="px-4 py-2.5 text-sm">
                    <span className="font-medium">{i.nome}</span>
                    {i.avisos.map((a) => (
                      <span key={a} className="text-warn block text-xs">
                        {a}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="font-semibold">O que vai ser criado</h2>
            <div className="border-line mt-3 max-h-96 overflow-auto rounded-xl border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface-2 sticky top-0">
                  <tr className="border-line border-b">
                    <th className="text-ink-3 px-4 py-2 text-left text-xs font-semibold uppercase">
                      Insumo
                    </th>
                    <th className="text-ink-3 px-4 py-2 text-left text-xs font-semibold uppercase">
                      Categoria
                    </th>
                    <th className="text-ink-3 px-4 py-2 text-right text-xs font-semibold uppercase">
                      Custo
                    </th>
                    <th className="text-ink-3 px-4 py-2 text-left text-xs font-semibold uppercase">
                      Onde fica
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plano.insumos.map((i) => (
                    <tr key={i.nome} className="border-line border-b">
                      <td className="px-4 py-2">
                        {i.nome}
                        <span className="text-ink-3">
                          {" "}
                          ({i.unidadeRotulo ?? i.unidadeMedida.toLowerCase()})
                        </span>
                      </td>
                      <td className="text-ink-2 px-4 py-2">
                        {i.categoria ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {i.custoUltimo > 0 || i.custoMedio > 0
                          ? formatarMoeda(i.custoMedio || i.custoUltimo)
                          : "—"}
                      </td>
                      <td className="text-ink-3 px-4 py-2 text-xs">
                        {i.posicoes.map((p) => p.local).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
            >
              {erro}
            </p>
          )}

          <form action={acaoConfirmar} className="flex items-center gap-2">
            <input type="hidden" name="planilha" value={texto} />
            <Botao type="submit" carregando={gravando}>
              Importar {plano.insumos.length} insumos
            </Botao>
            <Link href="/estoque/importar">
              <Botao type="button" peso="fantasma">
                Recomeçar
              </Botao>
            </Link>
          </form>
        </>
      )}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <p className="text-ink-3 font-mono text-[10px] tracking-[0.14em] uppercase">
        {rotulo}
      </p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
