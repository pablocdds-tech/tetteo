"use client";

import {
  startTransition,
  useActionState,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Botao } from "@/design-system/botao";
import { Vazio } from "@/design-system/vazio";
import { sigla } from "@/lib/unidades";

import {
  enviarRequisicaoAcao,
  salvarRequisicaoAcao,
  type EstadoCompras,
} from "../acoes";
import { CASAS, digitado } from "../schemas/aritmetica";
import type {
  LinhaSugerida,
  RequisicaoCompleta,
} from "../services/requisicoes";

import { Acao } from "./acao";
import { qtd } from "./formato";

/**
 * A LISTA DA LOJA — o que pedir nesta rodada, insumo por insumo.
 *
 * Ao lado de cada campo, o que o sistema sabe: quanto a loja tem, o mínimo,
 * o que já está pedido e ainda não chegou, e a SUGESTÃO com a conta escrita
 * ("mínimo 15 kg − disponível 4 kg − em pedido 2 kg"). A sugestão preenche o
 * campo só quando a pessoa clica em "Usar": o número que vai para a compra é
 * sempre uma decisão de alguém.
 *
 * Salvar e enviar são gestos separados. "Enviar requisição" só aparece com
 * tudo salvo — a loja envia exatamente a lista que está vendo.
 */

type Item = RequisicaoCompleta["itens"][number];
type Valor = { quantidade: string; observacao: string };
type Filtro = "lista" | "abaixo" | "todos";

type Linha = {
  insumoId: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  disponivel: string | null;
  minimo: string | null;
  emPedidoAberto: string;
  sugestao: {
    quantidade: string | null;
    formula: string | null;
    alertas: string[];
  } | null;
};

const paraCampo = (v: string) => v.replace(".", ",");

/** "12,50" e "12,5" são o mesmo número: não é alteração. */
function mesmoNumero(a: string, b: string): boolean {
  try {
    return digitado(a, CASAS.milesimos) === digitado(b, CASAS.milesimos);
  } catch {
    return a.trim() === b.trim();
  }
}

const GRADE =
  "md:grid md:grid-cols-[minmax(0,2.1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.9fr)_minmax(0,1.3fr)_minmax(0,1.4fr)] md:items-start md:gap-3";

export function EditorDaRequisicao({
  requisicao,
  sugestoes,
}: {
  requisicao: { id: string; versao: number; itens: Item[] };
  sugestoes: LinhaSugerida[];
}) {
  const salvos = useMemo(
    () =>
      new Map(
        requisicao.itens.map((i) => [
          i.insumoId,
          {
            id: i.id,
            quantidade: paraCampo(i.quantidade),
            observacao: i.observacao ?? "",
          },
        ]),
      ),
    [requisicao.itens],
  );

  const [valores, setValores] = useState<Record<string, Valor>>(() =>
    Object.fromEntries(
      requisicao.itens.map((i) => [
        i.insumoId,
        { quantidade: paraCampo(i.quantidade), observacao: i.observacao ?? "" },
      ]),
    ),
  );
  const [filtro, setFiltro] = useState<Filtro>(() =>
    requisicao.itens.length > 0
      ? "lista"
      : sugestoes.some((s) => s.sugestao.quantidade !== null)
        ? "abaixo"
        : "todos",
  );
  const [busca, setBusca] = useState("");
  const idBusca = useId();

  const emVoo = useRef(false);
  const [estado, despachar, salvando] = useActionState<EstadoCompras, FormData>(
    async (anterior, dados) => {
      try {
        return await salvarRequisicaoAcao(anterior, dados);
      } finally {
        emVoo.current = false;
      }
    },
    {},
  );

  const linhas: Linha[] = useMemo(() => {
    const vistos = new Set(sugestoes.map((s) => s.insumoId));
    const daSugestao: Linha[] = sugestoes.map((s) => ({
      insumoId: s.insumoId,
      nome: s.nome,
      categoria: s.categoria,
      unidade: s.unidade,
      disponivel: s.disponivel,
      minimo: s.minimo,
      emPedidoAberto: s.emPedidoAberto,
      sugestao: s.sugestao,
    }));
    // Insumo que saiu do cardápio mas está na lista continua visível.
    const orfaos: Linha[] = requisicao.itens
      .filter((i) => !vistos.has(i.insumoId))
      .map((i) => ({
        insumoId: i.insumoId,
        nome: i.nome,
        categoria: i.categoria,
        unidade: i.unidade,
        disponivel: null,
        minimo: null,
        emPedidoAberto: "0",
        sugestao: null,
      }));
    return [...daSugestao, ...orfaos];
  }, [sugestoes, requisicao.itens]);

  const alteracoes = useMemo(() => {
    const gravar: {
      insumoId: string;
      quantidade: string;
      observacao: string;
    }[] = [];
    const remover: string[] = [];
    for (const [insumoId, v] of Object.entries(valores)) {
      const s = salvos.get(insumoId);
      if (v.quantidade.trim() === "") {
        if (s) remover.push(s.id);
        continue;
      }
      if (
        !s ||
        !mesmoNumero(s.quantidade, v.quantidade) ||
        s.observacao.trim() !== v.observacao.trim()
      ) {
        gravar.push({
          insumoId,
          quantidade: v.quantidade.trim(),
          observacao: v.observacao.trim(),
        });
      }
    }
    return { gravar, remover };
  }, [valores, salvos]);

  const sujo = alteracoes.gravar.length + alteracoes.remover.length > 0;
  const naLista = Object.values(valores).filter(
    (v) => v.quantidade.trim() !== "",
  ).length;
  const erros = estado.erros ?? {};

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = linhas.filter((l) => {
    if (termo && !l.nome.toLocaleLowerCase("pt-BR").includes(termo))
      return false;
    const temValor = (valores[l.insumoId]?.quantidade ?? "").trim() !== "";
    if (filtro === "lista") return temValor || salvos.has(l.insumoId);
    if (filtro === "abaixo") return temValor || l.sugestao?.quantidade != null;
    return true;
  });
  const comSugestaoVazia = linhas.filter(
    (l) =>
      l.sugestao?.quantidade && !(valores[l.insumoId]?.quantidade ?? "").trim(),
  );

  function mudar(insumoId: string, parcial: Partial<Valor>) {
    setValores((atual) => ({
      ...atual,
      [insumoId]: {
        ...(atual[insumoId] ?? { quantidade: "", observacao: "" }),
        ...parcial,
      },
    }));
  }

  function usarSugestoes() {
    setValores((atual) => {
      const novo = { ...atual };
      for (const l of comSugestaoVazia) {
        novo[l.insumoId] = {
          observacao: atual[l.insumoId]?.observacao ?? "",
          quantidade: paraCampo(l.sugestao!.quantidade!),
        };
      }
      return novo;
    });
    setFiltro("lista");
  }

  function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current || !sujo) return;
    emVoo.current = true;
    const dados = new FormData();
    dados.set("requisicaoId", requisicao.id);
    dados.set("linhas", JSON.stringify(alteracoes.gravar));
    dados.set("remover", JSON.stringify(alteracoes.remover));
    startTransition(() => despachar(dados));
  }

  const FILTROS: { valor: Filtro; texto: string }[] = [
    { valor: "lista", texto: `Na lista (${naLista})` },
    { valor: "abaixo", texto: "Abaixo do mínimo" },
    { valor: "todos", texto: `Todos os insumos (${linhas.length})` },
  ];

  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-line flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3">
        <div className="min-w-[min(100%,15rem)] flex-1">
          <label htmlFor={idBusca} className="sr-only">
            Buscar insumo pelo nome
          </label>
          <input
            id={idBusca}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar insumo pelo nome"
            className="bg-surface border-line-2 text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-accent h-11 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-[42px] md:text-sm"
          />
        </div>
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Quais insumos mostrar</legend>
          {FILTROS.map((f) => (
            <label
              key={f.valor}
              className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub has-[:checked]:text-accent has-[:focus-visible]:outline-accent text-ink-2 flex min-h-11 cursor-pointer items-center rounded-full border px-3 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 md:min-h-9"
            >
              <input
                type="radio"
                name="filtro-da-requisicao"
                value={f.valor}
                checked={filtro === f.valor}
                onChange={() => setFiltro(f.valor)}
                className="sr-only"
              />
              {f.texto}
            </label>
          ))}
        </fieldset>
        {comSugestaoVazia.length > 0 && (
          <Botao
            type="button"
            peso="secundario"
            tamanho="pequeno"
            onClick={usarSugestoes}
          >
            Usar as {comSugestaoVazia.length} sugestões
          </Botao>
        )}
      </div>

      {visiveis.length === 0 ? (
        <Vazio
          icone={filtro === "lista" ? "carrinho" : "filtro"}
          titulo={
            filtro === "lista" ? "A lista está vazia" : "Nada neste recorte"
          }
          explicacao={
            filtro === "lista"
              ? "Veja os insumos abaixo do mínimo, ou todos, e escreva quanto pedir de cada um."
              : "Troque o recorte acima ou limpe a busca."
          }
        />
      ) : (
        <ul className="divide-line divide-y">
          <li
            aria-hidden
            className={`text-ink-3 hidden px-4 py-2 text-xs font-medium ${GRADE}`}
          >
            <span>Insumo</span>
            <span className="text-right">Tem agora</span>
            <span className="text-right">Mínimo</span>
            <span className="text-right">Já pedido</span>
            <span>Sugestão do sistema</span>
            <span>Pedir</span>
            <span>Observação</span>
          </li>
          {visiveis.map((l) => (
            <LinhaDoInsumo
              key={l.insumoId}
              l={l}
              valor={valores[l.insumoId] ?? { quantidade: "", observacao: "" }}
              aoMudar={(parcial) => mudar(l.insumoId, parcial)}
              erro={erros[l.insumoId]}
            />
          ))}
        </ul>
      )}

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad mx-4 mt-3 rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}
      {estado.ok && !sujo && (
        <p
          role="status"
          className="bg-ok-sub text-ok mx-4 mt-3 rounded-md px-3 py-2 text-sm"
        >
          {estado.ok}
        </p>
      )}

      <div className="border-line bg-surface sticky bottom-0 z-10 mt-3 flex flex-wrap items-start justify-between gap-3 rounded-b-lg border-t px-4 py-3">
        <p className="text-ink-2 pt-2 text-sm" aria-live="polite">
          {naLista} {naLista === 1 ? "item" : "itens"} na lista ·{" "}
          {sujo ? (
            <strong className="text-warn font-semibold">
              alterações não salvas
            </strong>
          ) : (
            "tudo salvo"
          )}
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <form onSubmit={salvar}>
            <Botao
              type="submit"
              peso={sujo ? "primario" : "secundario"}
              carregando={salvando}
              disabled={!sujo}
            >
              Salvar lista
            </Botao>
          </form>
          {!sujo && naLista > 0 ? (
            <Acao
              acao={enviarRequisicaoAcao}
              campos={{
                requisicaoId: requisicao.id,
                versao: requisicao.versao,
              }}
              rotulo="Enviar requisição"
              confirmar="Enviar a lista para o comprador? Depois de enviada ela não muda mais — só se o comprador devolver."
            />
          ) : (
            <Botao
              type="button"
              peso="secundario"
              disabled
              title="Salve a lista antes de enviar"
            >
              Enviar requisição
            </Botao>
          )}
        </div>
      </div>
    </div>
  );
}

function LinhaDoInsumo({
  l,
  valor,
  aoMudar,
  erro,
}: {
  l: Linha;
  valor: Valor;
  aoMudar: (parcial: Partial<Valor>) => void;
  erro?: string;
}) {
  const id = useId();
  const u = l.unidade;
  const sugerida = l.sugestao?.quantidade ?? null;
  const jaPedido = l.emPedidoAberto !== "0" && l.emPedidoAberto !== "0.000";

  return (
    <li className={`flex flex-col gap-2 px-4 py-3 ${GRADE}`}>
      <div className="min-w-0">
        <p className="text-ink text-sm leading-5 font-medium">{l.nome}</p>
        {l.categoria && (
          <p className="text-ink-3 text-xs leading-[18px]">{l.categoria}</p>
        )}
        {l.sugestao?.alertas.map((a) => (
          <p
            key={a}
            className="bg-warn-sub text-warn mt-1 rounded-sm px-2 py-0.5 text-xs leading-[18px]"
          >
            {a}
          </p>
        ))}
      </div>
      <Dado
        rotulo="Tem agora"
        valor={l.disponivel === null ? "não contado" : qtd(l.disponivel, u)}
      />
      <Dado
        rotulo="Mínimo"
        valor={l.minimo === null ? "sem mínimo" : qtd(l.minimo, u)}
      />
      <Dado
        rotulo="Já pedido"
        valor={jaPedido ? qtd(l.emPedidoAberto, u) : "—"}
      />
      <div className="text-xs leading-[18px]">
        <span className="text-ink-3 md:hidden">Sugestão: </span>
        {sugerida ? (
          <>
            <button
              type="button"
              onClick={() => aoMudar({ quantidade: paraCampo(sugerida) })}
              className="text-accent focus-visible:outline-accent rounded-sm font-semibold hover:underline focus-visible:outline-2"
            >
              Usar {qtd(sugerida, u)}
            </button>
            <span className="text-ink-3 block">{l.sugestao!.formula}</span>
          </>
        ) : (
          <span className="text-ink-3">{l.sugestao?.formula ?? "—"}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-ink-3 text-xs md:sr-only">
          Pedir ({sigla(u)})
        </label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            value={valor.quantidade}
            onChange={(e) => aoMudar({ quantidade: e.target.value })}
            inputMode="decimal"
            placeholder="—"
            aria-label={`Quanto pedir de ${l.nome}, em ${sigla(u)}`}
            aria-invalid={erro ? true : undefined}
            className={`bg-surface text-ink placeholder:text-ink-3 h-11 w-full min-w-0 rounded-md border px-3 text-base tabular-nums focus:outline-none md:h-10 md:text-sm ${
              erro
                ? "border-bad focus:shadow-[0_0_0_3px_var(--bad-sub)]"
                : "border-line-2 hover:border-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-sub)]"
            }`}
          />
          <span className="text-ink-2 flex-none text-sm font-medium">
            {sigla(u)}
          </span>
        </div>
        {erro && <p className="text-bad text-xs leading-[18px]">{erro}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-obs`} className="text-ink-3 text-xs md:sr-only">
          Observação
        </label>
        <input
          id={`${id}-obs`}
          value={valor.observacao}
          onChange={(e) => aoMudar({ observacao: e.target.value })}
          maxLength={300}
          placeholder="Opcional"
          aria-label={`Observação sobre ${l.nome}`}
          className="bg-surface border-line-2 text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-accent h-11 w-full min-w-0 rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-10 md:text-sm"
        />
      </div>
    </li>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex justify-between gap-2 text-sm md:block md:pt-2.5 md:text-right">
      <span className="text-ink-3 text-xs md:hidden">{rotulo}</span>
      <span className="text-ink-2 tabular-nums">{valor}</span>
    </p>
  );
}
