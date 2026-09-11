"use client";

import {
  startTransition,
  useActionState,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { sigla, type Unidade } from "@/lib/unidades";

import {
  CASAS,
  NumeroInvalido,
  digitado,
  precoPorUnidade,
  reaisPorUnidade,
} from "../schemas/aritmetica";
import { fatorDaEmbalagem } from "../schemas/embalagem";

/**
 * A PROPOSTA — o mesmo formulário para o fornecedor (pelo link) e para o
 * comprador (digitando o que chegou pelo WhatsApp).
 *
 * Por item, três respostas que NUNCA se confundem: cotou, não tem, sem
 * resposta. Campo vazio não é zero. A embalagem é dita em partes (peças ×
 * conteúdo), e a tela mostra na hora a conversão e o preço por kg — com as
 * MESMAS funções que o servidor usa, para que o número que o fornecedor vê
 * seja o número que o comprador compara. Quem valida é o servidor.
 *
 * O envio sai pelo onSubmit (e não pelo `action` do formulário): com `action`
 * o React limpa os campos até quando o servidor devolve erro, e trinta preços
 * digitados sumiriam por causa de uma vírgula.
 */

export type ItemParaCotar = {
  itemDaSolicitacaoId: string;
  nome: string;
  unidade: Unidade;
  /** Já formatada: "10,8 kg". */
  quantidade: string;
  porLoja: { loja: string; quantidade: string }[];
  direcionado: boolean;
};

export type OfertaAnterior = {
  itemDaSolicitacaoId: string;
  situacao: "COTADO" | "INDISPONIVEL";
  nomeEmbalagem: string | null;
  pecas: number;
  conteudo: string | null;
  unidadeConteudo: string | null;
  fracionavel: boolean;
  precoEmbalagem: string | null;
  disponivel: string | null;
  observacao: string | null;
};

export type PropostaAnterior = {
  frete: string | null;
  pedidoMinimo: string | null;
  prazoEntregaDias: number | null;
  /** "2026-09-15" */
  validaAte: string | null;
  observacao: string | null;
  ofertas: OfertaAnterior[];
} | null;

export type EstadoDoFormulario = {
  erro?: string;
  erros?: Record<string, string>;
  ok?: string;
};

type Situacao = "COTADO" | "INDISPONIVEL" | "SEM_RESPOSTA";

type Linha = {
  situacao: Situacao;
  nomeEmbalagem: string;
  pecas: string;
  conteudo: string;
  unidadeConteudo: Unidade;
  fracionavel: boolean;
  precoEmbalagem: string;
  disponivel: string;
  observacao: string;
};

const UNIDADES: Unidade[] = ["KG", "G", "L", "ML", "UN"];

const PILULA =
  "border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub has-[:focus-visible]:outline-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 md:min-h-9";

const CAIXA =
  "bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent h-10 min-w-0 rounded-md border px-3 text-base transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/** "49.5" do banco → "49,5" para o campo. */
const paraCampo = (v: string | null | undefined) =>
  v ? v.replace(".", ",") : "";

function linhaInicial(item: ItemParaCotar, anterior: PropostaAnterior): Linha {
  const o = anterior?.ofertas.find(
    (x) => x.itemDaSolicitacaoId === item.itemDaSolicitacaoId,
  );
  if (!o) {
    return {
      situacao: "SEM_RESPOSTA",
      nomeEmbalagem: "",
      pecas: "1",
      conteudo: "",
      unidadeConteudo: item.unidade,
      fracionavel: false,
      precoEmbalagem: "",
      disponivel: "",
      observacao: "",
    };
  }
  return {
    situacao: o.situacao,
    nomeEmbalagem: o.nomeEmbalagem ?? "",
    pecas: String(o.pecas || 1),
    conteudo: paraCampo(o.conteudo),
    unidadeConteudo: (o.unidadeConteudo as Unidade | null) ?? item.unidade,
    fracionavel: o.fracionavel,
    precoEmbalagem: paraCampo(o.precoEmbalagem),
    disponivel: paraCampo(o.disponivel),
    observacao: o.observacao ?? "",
  };
}

/** A conversão e o preço por unidade, calculados como o servidor calcula. */
function previa(
  l: Linha,
  base: Unidade,
): { texto: string; tom: "ok" | "aviso" | "ruim" } | null {
  if (l.situacao !== "COTADO") return null;
  try {
    const pecas = l.fracionavel
      ? 1
      : l.pecas.trim() === ""
        ? 1
        : Number(l.pecas);
    if (!Number.isInteger(pecas) || pecas < 1) {
      return { texto: "Peças: um número inteiro, a partir de 1.", tom: "ruim" };
    }
    const conteudo = l.fracionavel
      ? null
      : digitado(l.conteudo, CASAS.dezMilesimos);
    const f = fatorDaEmbalagem(base, {
      pecas,
      conteudo,
      unidadeConteudo: conteudo === null ? null : l.unidadeConteudo,
      fracionavel: l.fracionavel,
    });
    if (!f.ok)
      return {
        texto: f.mensagem,
        tom: f.motivo === "invalido" ? "ruim" : "aviso",
      };
    const preco = digitado(l.precoEmbalagem, CASAS.centavos);
    const porUnidade =
      preco !== null && preco > 0n
        ? ` · ${reaisPorUnidade(precoPorUnidade(preco, f.fator), base)}`
        : "";
    return { texto: `${f.descricao}${porUnidade}`, tom: "ok" };
  } catch (erro) {
    if (erro instanceof NumeroInvalido)
      return { texto: erro.message, tom: "ruim" };
    throw erro;
  }
}

export function FormularioDeProposta({
  itens,
  anterior,
  acao,
  campos,
  modo,
  podeEnviar,
  negociacaoObrigatoria = false,
  rotuloEnviar,
}: {
  itens: ItemParaCotar[];
  anterior: PropostaAnterior;
  acao: (
    estado: EstadoDoFormulario,
    dados: FormData,
  ) => Promise<EstadoDoFormulario>;
  /** Campos escondidos: o código do link, ou a solicitação e a rodada. */
  campos: Record<string, string>;
  modo: "fornecedor" | "comprador";
  podeEnviar: boolean;
  /** Cotação encerrada: o comprador só registra como negociação. */
  negociacaoObrigatoria?: boolean;
  rotuloEnviar: string;
}) {
  const [linhas, setLinhas] = useState<Record<string, Linha>>(() =>
    Object.fromEntries(
      itens.map((i) => [i.itemDaSolicitacaoId, linhaInicial(i, anterior)]),
    ),
  );
  const [geral, setGeral] = useState({
    frete: paraCampo(anterior?.frete),
    pedidoMinimo: paraCampo(anterior?.pedidoMinimo),
    prazoEntregaDias: anterior?.prazoEntregaDias?.toString() ?? "",
    validaAte: anterior?.validaAte ?? "",
    observacao: anterior?.observacao ?? "",
  });
  const idObservacao = useId();

  // Um envio por vez: a trava vale já no segundo clique de um duplo clique.
  const emVoo = useRef(false);
  const [estado, despachar, enviando] = useActionState<
    EstadoDoFormulario,
    FormData
  >(async (estadoAnterior, dados) => {
    try {
      return await acao(estadoAnterior, dados);
    } finally {
      emVoo.current = false;
    }
  }, {});

  const erros = estado.erros ?? {};
  const respondidos = itens.filter(
    (i) => linhas[i.itemDaSolicitacaoId].situacao !== "SEM_RESPOSTA",
  ).length;

  function mudar(id: string, parcial: Partial<Linha>) {
    setLinhas((atual) => ({ ...atual, [id]: { ...atual[id], ...parcial } }));
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current || !podeEnviar) return;
    emVoo.current = true;
    const dados = new FormData(evento.currentTarget);
    dados.set(
      "resposta",
      JSON.stringify({
        frete: geral.frete.trim(),
        pedidoMinimo: geral.pedidoMinimo.trim(),
        prazoEntregaDias: geral.prazoEntregaDias.trim(),
        validaAte: geral.validaAte,
        observacao: geral.observacao.trim(),
        itens: itens.map((i) => {
          const l = linhas[i.itemDaSolicitacaoId];
          const granel = l.fracionavel;
          const comConteudo = !granel && l.conteudo.trim() !== "";
          return {
            itemDaSolicitacaoId: i.itemDaSolicitacaoId,
            situacao: l.situacao,
            nomeEmbalagem: granel ? "" : l.nomeEmbalagem.trim(),
            pecas: granel ? "1" : l.pecas.trim(),
            conteudo: comConteudo ? l.conteudo.trim() : "",
            unidadeConteudo: comConteudo ? l.unidadeConteudo : "",
            fracionavel: granel,
            precoEmbalagem: l.precoEmbalagem.trim(),
            disponivel: l.disponivel.trim(),
            observacao: l.observacao.trim(),
          };
        }),
      }),
    );
    startTransition(() => despachar(dados));
  }

  return (
    <form onSubmit={enviar} noValidate className="flex min-w-0 flex-col gap-4">
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}

      <fieldset disabled={!podeEnviar} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">Itens da cotação</legend>

        {itens.map((item) => (
          <BlocoDoItem
            key={item.itemDaSolicitacaoId}
            item={item}
            linha={linhas[item.itemDaSolicitacaoId]}
            mudar={(parcial) => mudar(item.itemDaSolicitacaoId, parcial)}
            erros={erros}
            modo={modo}
          />
        ))}

        <fieldset className="bg-surface border-line flex min-w-0 flex-col gap-3 rounded-lg border p-4">
          <legend className="px-1 text-[15px] font-semibold">
            Condições da proposta
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo="Frete por entrega (R$)"
              value={geral.frete}
              onChange={(e) =>
                setGeral((g) => ({ ...g, frete: e.target.value }))
              }
              inputMode="decimal"
              maxLength={20}
              erro={erros.frete}
              ajuda="Por loja atendida. Frete grátis: escreva 0. Em branco = não informado."
            />
            <Campo
              rotulo="Pedido mínimo (R$) — opcional"
              value={geral.pedidoMinimo}
              onChange={(e) =>
                setGeral((g) => ({ ...g, pedidoMinimo: e.target.value }))
              }
              inputMode="decimal"
              maxLength={20}
              erro={erros.pedidoMinimo}
              ajuda="Por entrega."
            />
            <Campo
              rotulo="Entrega em (dias)"
              value={geral.prazoEntregaDias}
              onChange={(e) =>
                setGeral((g) => ({ ...g, prazoEntregaDias: e.target.value }))
              }
              inputMode="numeric"
              maxLength={4}
              erro={erros.prazoEntregaDias}
            />
            <Campo
              rotulo="Preços valem até — opcional"
              type="date"
              value={geral.validaAte}
              onChange={(e) =>
                setGeral((g) => ({ ...g, validaAte: e.target.value }))
              }
              erro={erros.validaAte}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={idObservacao}
              className="text-ink-2 text-sm font-semibold"
            >
              Observação — opcional
            </label>
            <textarea
              id={idObservacao}
              value={geral.observacao}
              onChange={(e) =>
                setGeral((g) => ({ ...g, observacao: e.target.value }))
              }
              maxLength={500}
              rows={2}
              className="bg-surface border-line-2 text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm"
            />
          </div>
        </fieldset>

        {modo === "comprador" && (
          <fieldset className="bg-surface border-line flex min-w-0 flex-col gap-3 rounded-lg border p-4">
            <legend className="px-1 text-[15px] font-semibold">
              Como esta proposta chegou
            </legend>
            <label className={PILULA}>
              <input
                type="radio"
                name="origem"
                value="COMPRADOR_DIGITOU"
                defaultChecked={!negociacaoObrigatoria}
                disabled={negociacaoObrigatoria}
                className="size-4"
              />
              O fornecedor mandou (WhatsApp, telefone) e estou digitando
            </label>
            <label className={PILULA}>
              <input
                type="radio"
                name="origem"
                value="NEGOCIACAO"
                defaultChecked={negociacaoObrigatoria}
                className="size-4"
              />
              Negociei um preço diferente do que ele mandou
            </label>
            {negociacaoObrigatoria && (
              <p className="text-warn text-sm leading-5">
                A cotação já foi encerrada: proposta nova só como negociação,
                com o motivo.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${idObservacao}-motivo`}
                className="text-ink-2 text-sm font-semibold"
              >
                Motivo — obrigatório em negociação e em preço zero
              </label>
              <textarea
                id={`${idObservacao}-motivo`}
                name="motivo"
                maxLength={300}
                rows={2}
                className="bg-surface border-line-2 text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm"
              />
            </div>
            <label className="flex items-start gap-2 text-sm leading-5">
              <input
                type="checkbox"
                name="autorizarZero"
                className="mt-0.5 size-4"
              />
              Autorizo preço zero nesta proposta (bonificação combinada com o
              fornecedor)
            </label>
          </fieldset>
        )}
      </fieldset>

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm leading-5"
        >
          {estado.erro}
          {erros.geral && erros.geral !== estado.erro ? ` ${erros.geral}` : ""}
        </p>
      )}
      {estado.ok && (
        <p
          role="status"
          className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm leading-5"
        >
          {estado.ok}
        </p>
      )}

      <div className="bg-surface border-line sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-[0_-6px_18px_rgb(0_0_0/0.06)]">
        <p className="text-ink-2 text-sm tabular-nums" aria-live="polite">
          {respondidos} de {itens.length}{" "}
          {itens.length === 1 ? "item respondido" : "itens respondidos"}
        </p>
        <Botao type="submit" carregando={enviando} disabled={!podeEnviar}>
          {rotuloEnviar}
        </Botao>
      </div>
    </form>
  );
}

function BlocoDoItem({
  item,
  linha,
  mudar,
  erros,
  modo,
}: {
  item: ItemParaCotar;
  linha: Linha;
  mudar: (parcial: Partial<Linha>) => void;
  erros: Record<string, string>;
  modo: "fornecedor" | "comprador";
}) {
  const id = useId();
  const u = item.unidade;
  const p = previa(linha, u);
  const erro = (campo: string) => erros[`${campo}:${item.itemDaSolicitacaoId}`];
  const nomeDaEmbalagem = linha.nomeEmbalagem.trim() || "Embalagem";

  const opcoes: { valor: Situacao; texto: string }[] =
    modo === "fornecedor"
      ? [
          { valor: "COTADO", texto: "Tenho — vou cotar" },
          { valor: "INDISPONIVEL", texto: "Não trabalho com este item" },
          { valor: "SEM_RESPOSTA", texto: "Deixar em branco" },
        ]
      : [
          { valor: "COTADO", texto: "Cotou" },
          { valor: "INDISPONIVEL", texto: "Não tem" },
          { valor: "SEM_RESPOSTA", texto: "Sem resposta" },
        ];

  return (
    <fieldset className="bg-surface border-line flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <legend className="sr-only">{item.nome}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] leading-6 font-semibold">{item.nome}</h3>
        <p className="text-ink-2 text-sm tabular-nums">
          Quantidade:{" "}
          <strong className="text-ink font-semibold">{item.quantidade}</strong>
        </p>
      </div>
      {item.porLoja.length > 0 && (
        <p className="text-ink-3 -mt-2 text-xs leading-[18px]">
          {item.porLoja.map((l) => `${l.loja}: ${l.quantidade}`).join(" · ")}
        </p>
      )}
      {item.direcionado && (
        <p className="bg-info-sub text-info rounded-md px-3 py-1.5 text-xs leading-[18px]">
          {modo === "fornecedor"
            ? "Este item já é comprado de você. Confirme o preço e a embalagem."
            : "Item do fornecedor fixo: registre o preço que ele confirmou."}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label={`Resposta para ${item.nome}`}
        className="flex flex-wrap gap-2"
      >
        {opcoes.map((o) => (
          <label key={o.valor} className={PILULA}>
            <input
              type="radio"
              name={`situacao-${item.itemDaSolicitacaoId}`}
              value={o.valor}
              checked={linha.situacao === o.valor}
              onChange={() => mudar({ situacao: o.valor })}
              className="size-4"
            />
            {o.texto}
          </label>
        ))}
      </div>

      {linha.situacao === "COTADO" && (
        <div className="flex flex-col gap-3">
          <div
            role="radiogroup"
            aria-label="Como é vendido"
            className="flex flex-wrap gap-2"
          >
            <label className={PILULA}>
              <input
                type="radio"
                name={`venda-${item.itemDaSolicitacaoId}`}
                checked={!linha.fracionavel}
                onChange={() => mudar({ fracionavel: false })}
                className="size-4"
              />
              Em embalagem fechada
            </label>
            <label className={PILULA}>
              <input
                type="radio"
                name={`venda-${item.itemDaSolicitacaoId}`}
                checked={linha.fracionavel}
                onChange={() => mudar({ fracionavel: true })}
                className="size-4"
              />
              A granel, por {sigla(u)}
            </label>
          </div>

          {!linha.fracionavel && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.5fr)]">
              <Campo
                rotulo="Embalagem"
                value={linha.nomeEmbalagem}
                onChange={(e) => mudar({ nomeEmbalagem: e.target.value })}
                placeholder="Caixa, fardo, saco…"
                maxLength={40}
              />
              <Campo
                rotulo="Peças por embalagem"
                value={linha.pecas}
                onChange={(e) => mudar({ pecas: e.target.value })}
                inputMode="numeric"
                maxLength={6}
                erro={erro("pecas")}
              />
              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor={`${id}-conteudo`}
                  className="text-ink-2 text-sm font-semibold"
                >
                  Conteúdo de cada peça
                </label>
                <div className="flex gap-2">
                  <input
                    id={`${id}-conteudo`}
                    value={linha.conteudo}
                    onChange={(e) => mudar({ conteudo: e.target.value })}
                    inputMode="decimal"
                    maxLength={14}
                    placeholder="900"
                    aria-invalid={erro("conteudo") ? true : undefined}
                    aria-describedby={
                      erro("conteudo") ? `${id}-erro-conteudo` : undefined
                    }
                    className={`${CAIXA} w-full`}
                  />
                  <select
                    aria-label="Unidade do conteúdo"
                    value={linha.unidadeConteudo}
                    onChange={(e) =>
                      mudar({ unidadeConteudo: e.target.value as Unidade })
                    }
                    className={`${CAIXA} w-20 flex-none px-2`}
                  >
                    {UNIDADES.map((x) => (
                      <option key={x} value={x}>
                        {sigla(x)}
                      </option>
                    ))}
                  </select>
                </div>
                {erro("conteudo") && (
                  <span id={`${id}-erro-conteudo`} className="text-bad text-sm">
                    {erro("conteudo")}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              rotulo={
                linha.fracionavel
                  ? `Preço por ${sigla(u)} (R$)`
                  : `Preço por ${nomeDaEmbalagem.toLowerCase()} (R$)`
              }
              value={linha.precoEmbalagem}
              onChange={(e) => mudar({ precoEmbalagem: e.target.value })}
              inputMode="decimal"
              maxLength={20}
              erro={erro("preco")}
            />
            <Campo
              rotulo={`Tem para entregar (${sigla(u)}) — opcional`}
              value={linha.disponivel}
              onChange={(e) => mudar({ disponivel: e.target.value })}
              inputMode="decimal"
              maxLength={20}
              erro={erro("disponivel")}
              ajuda="Em branco se tem a quantidade toda."
            />
          </div>

          {p && (
            <p
              aria-live="polite"
              className={`text-sm leading-5 ${
                p.tom === "ok"
                  ? "text-ink-2"
                  : p.tom === "aviso"
                    ? "text-warn"
                    : "text-bad"
              }`}
            >
              {p.tom === "ok"
                ? `${linha.fracionavel ? "Venda" : nomeDaEmbalagem}: ${p.texto}`
                : p.texto}
            </p>
          )}
        </div>
      )}

      {linha.situacao !== "SEM_RESPOSTA" && (
        <Campo
          rotulo="Observação sobre o item — opcional"
          value={linha.observacao}
          onChange={(e) => mudar({ observacao: e.target.value })}
          maxLength={300}
        />
      )}

      {erro("item") && (
        <p role="alert" className="text-bad text-sm">
          {erro("item")}
        </p>
      )}
    </fieldset>
  );
}
