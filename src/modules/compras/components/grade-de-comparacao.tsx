"use client";

import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { formatarMoeda, formatarQuantidade } from "@/lib/numero";

import { fecharCotacaoAcao, type EstadoCompras } from "../acoes";
import type { Comparacao } from "../schemas/comparacao";

/**
 * A GRADE — a tela que o módulo existe para mostrar.
 *
 * Fornecedores nas colunas, itens nas linhas, o mais barato de cada linha em
 * verde. É a planilha que todo dono de restaurante já tentou montar à mão e
 * abandonou, porque refazê-la a cada cotação leva uma hora e erra na
 * conversão de embalagem.
 *
 * O rodapé compara os dois cenários que importam de verdade:
 *
 *   TUDO DE UM SÓ     uma entrega, uma conta a pagar, um telefonema
 *   CADA UM DO SEU    o menor preço item a item, com os fretes somados
 *
 * O segundo nem sempre ganha — e é por isso que os dois aparecem. Três
 * entregas custam três fretes e três manhãs de alguém conferindo caminhão.
 *
 * A escolha final é de quem compra, não do sistema. O mais barato às vezes é o
 * que entrega atrasado, e isso não está em nenhuma coluna.
 */
export function GradeDeComparacao({
  cotacaoId,
  comparacao,
  aberta,
  podePedir,
}: {
  cotacaoId: string;
  comparacao: Comparacao;
  aberta: boolean;
  podePedir: boolean;
}) {
  const [estado, acao, enviando] = useActionState<EstadoCompras, FormData>(
    fecharCotacaoAcao,
    {},
  );

  // Começa com a sugestão do sistema já marcada: o vencedor de cada linha.
  const [escolhas, setEscolhas] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      comparacao.grade
        .filter((l) => l.vencedorId)
        .map((l) => [l.item.id, l.vencedorId!]),
    ),
  );

  const fornecedores = comparacao.totais;

  if (fornecedores.length === 0) {
    return (
      <p className="border-line-2 text-ink-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
        Nenhum fornecedor respondeu ainda. Lance os preços que chegarem e a
        comparação aparece aqui.
      </p>
    );
  }

  const escolhidos = new Set(Object.values(escolhas));
  const totalEscolhido = comparacao.grade.reduce((soma, linha) => {
    const forn = escolhas[linha.item.id];
    if (!forn) return soma;
    const celula = linha.celulas.find((c) => c.fornecedorId === forn);
    return soma + (celula?.total ?? 0);
  }, 0);
  const fretesEscolhidos = fornecedores
    .filter((f) => escolhidos.has(f.fornecedorId))
    .reduce((s, f) => s + f.frete, 0);

  return (
    <form action={acao} className="flex flex-col gap-4">
      <input type="hidden" name="cotacaoId" value={cotacaoId} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-line border-b">
              <th className="py-2 pr-3 text-left font-semibold">Item</th>
              {fornecedores.map((f) => (
                <th
                  key={f.fornecedorId}
                  className="px-3 py-2 text-right font-semibold"
                >
                  <span className="block truncate">{f.fornecedorNome}</span>
                  <span className="text-ink-3 block text-[10px] font-normal">
                    {f.completo
                      ? `${f.itensVencidos} melhores`
                      : `cotou ${f.itensCotados} de ${f.itensTotais}`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-line divide-y">
            {comparacao.grade.map((linha) => (
              <tr key={linha.item.id}>
                <td className="py-2 pr-3">
                  <input type="hidden" name="itemId" value={linha.item.id} />
                  <span className="block font-medium">{linha.item.nome}</span>
                  <span className="text-ink-3 block text-xs">
                    {formatarQuantidade(linha.item.quantidade)}{" "}
                    {linha.item.unidade.toLowerCase()}
                  </span>
                  {linha.vencedorId === null && (
                    <span className="text-warn block text-xs">
                      ninguém cotou
                    </span>
                  )}
                </td>

                {fornecedores.map((f) => {
                  const celula = linha.celulas.find(
                    (c) => c.fornecedorId === f.fornecedorId,
                  );
                  const temPreco =
                    celula?.total !== null && celula !== undefined;
                  const escolhido = escolhas[linha.item.id] === f.fornecedorId;

                  return (
                    <td
                      key={f.fornecedorId}
                      className={`px-3 py-2 text-right align-top tabular-nums ${
                        celula?.vencedor ? "bg-ok-sub" : ""
                      }`}
                    >
                      {temPreco ? (
                        <label className="flex cursor-pointer flex-col items-end gap-0.5">
                          <span
                            className={
                              celula.vencedor
                                ? "text-ok font-semibold"
                                : "text-ink-2"
                            }
                          >
                            {formatarMoeda(celula.total!)}
                          </span>
                          <span className="text-ink-3 text-[10px]">
                            {formatarMoeda(celula.precoUnitario!)}/
                            {linha.item.unidade.toLowerCase()}
                            {celula.acimaDoVencedor
                              ? ` · +${celula.acimaDoVencedor.toLocaleString("pt-BR")}%`
                              : ""}
                          </span>
                          {aberta && podePedir && (
                            <input
                              type="radio"
                              name={`escolha:${linha.item.id}`}
                              value={f.fornecedorId}
                              checked={escolhido}
                              onChange={() =>
                                setEscolhas((a) => ({
                                  ...a,
                                  [linha.item.id]: f.fornecedorId,
                                }))
                              }
                              className="accent-accent mt-0.5 size-4"
                            />
                          )}
                        </label>
                      ) : (
                        <span className="text-ink-3 text-xs">
                          {celula?.naoAtende ? "não atende" : "—"}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-line border-t-2 font-semibold">
              <td className="py-2 pr-3">Total com frete</td>
              {fornecedores.map((f) => (
                <td
                  key={f.fornecedorId}
                  className="px-3 py-2 text-right tabular-nums"
                >
                  <span
                    className={
                      f.fornecedorId ===
                      comparacao.melhorFornecedorUnico?.fornecedorId
                        ? "text-ok"
                        : ""
                    }
                  >
                    {formatarMoeda(f.total)}
                  </span>
                  <span className="text-ink-3 block text-[10px] font-normal">
                    {f.frete > 0
                      ? `frete ${formatarMoeda(f.frete)}`
                      : "sem frete"}
                    {f.abaixoDoMinimo ? " · abaixo do mínimo" : ""}
                    {!f.completo ? " · parcial" : ""}
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-line bg-surface-2 grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
        <div>
          <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
            Tudo de um só
          </span>
          {comparacao.melhorFornecedorUnico ? (
            <>
              <span className="block text-xl font-semibold tabular-nums">
                {formatarMoeda(comparacao.melhorFornecedorUnico.total)}
              </span>
              <span className="text-ink-3 block text-xs">
                {comparacao.melhorFornecedorUnico.fornecedorNome} · uma entrega
              </span>
            </>
          ) : (
            <span className="text-ink-3 text-sm">
              Ninguém cotou a lista inteira
            </span>
          )}
        </div>

        <div>
          <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
            Cada um do seu
          </span>
          {comparacao.divididoTotal !== null ? (
            <>
              <span className="block text-xl font-semibold tabular-nums">
                {formatarMoeda(comparacao.divididoTotal)}
              </span>
              <span className="text-ink-3 block text-xs">
                {comparacao.divididoFornecedores} entregas · fretes somados
              </span>
            </>
          ) : (
            <span className="text-ink-3 text-sm">
              Falta preço em algum item
            </span>
          )}
        </div>

        <div>
          <span className="text-ink-3 block text-xs font-semibold tracking-wide uppercase">
            Sua escolha
          </span>
          <span className="block text-xl font-semibold tabular-nums">
            {formatarMoeda(totalEscolhido + fretesEscolhidos)}
          </span>
          <span className="text-ink-3 block text-xs">
            {escolhidos.size}{" "}
            {escolhidos.size === 1 ? "fornecedor" : "fornecedores"} ·{" "}
            {Object.keys(escolhas).length} de {comparacao.grade.length} itens
          </span>
        </div>
      </div>

      {comparacao.economiaDoDividido !== null &&
        comparacao.economiaDoDividido !== 0 && (
          <p className="text-ink-2 text-sm">
            {comparacao.economiaDoDividido > 0 ? (
              <>
                Dividir entre {comparacao.divididoFornecedores} fornecedores
                economiza{" "}
                <strong className="text-ok tabular-nums">
                  {formatarMoeda(comparacao.economiaDoDividido)}
                </strong>{" "}
                — já contando os fretes a mais.
              </>
            ) : (
              <>
                Dividir sairia{" "}
                <strong className="text-bad tabular-nums">
                  {formatarMoeda(Math.abs(comparacao.economiaDoDividido))}
                </strong>{" "}
                mais caro: os fretes extras comem a diferença de preço.
              </>
            )}
          </p>
        )}

      {comparacao.itensSemPreco.length > 0 && (
        <p className="bg-warn-sub text-warn rounded-md px-3 py-2 text-sm">
          Sem preço: {comparacao.itensSemPreco.join(", ")}. Esses itens ficam de
          fora dos pedidos.
        </p>
      )}

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}

      {aberta && podePedir && (
        <div className="flex flex-wrap items-center gap-2">
          <Botao type="submit" carregando={enviando}>
            Fechar cotação e gerar pedidos
          </Botao>
          <span className="text-ink-3 text-sm">
            Um pedido por fornecedor escolhido, em rascunho — nada é enviado sem
            você olhar de novo.
          </span>
        </div>
      )}
    </form>
  );
}
