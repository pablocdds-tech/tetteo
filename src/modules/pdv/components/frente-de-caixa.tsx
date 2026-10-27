"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { finalizarVendaAcao } from "../acoes";
import { calcularPrecoItem } from "../schemas/venda";
import type {
  DadosPdv,
  ItemCarrinho,
  PagamentoPdv,
  ProdutoPdv,
} from "../types";

const moeda = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const formas = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CREDITO: "Crédito",
  DEBITO: "Débito",
} as const;
type Linha = ItemCarrinho & { chave: string };

function precoMinimo(produto: ProdutoPdv) {
  return (
    produto.precoCentavos +
    produto.grupos.reduce((soma, grupo) => {
      if (!grupo.minimo) return soma;
      const precos = grupo.opcoes
        .map((o) => o.precoCentavos)
        .sort((a, b) => a - b);
      const selecionados = precos.slice(0, grupo.minimo);
      const acrescimo = selecionados.reduce((total, preco) => total + preco, 0);
      return (
        soma +
        (grupo.calculo === "MEDIA"
          ? Math.round(acrescimo / selecionados.length)
          : acrescimo)
      );
    }, 0)
  );
}

function centavos(texto: string) {
  const normalizado = texto.trim().replace(/\s/g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalizado)) return NaN;
  return Math.round(Number(normalizado.replace(",", ".")) * 100);
}

export function FrenteDeCaixa({
  dados,
  unidade,
  podeVender,
  podeDesconto,
}: {
  dados: DadosPdv;
  unidade: string;
  podeVender: boolean;
  podeDesconto: boolean;
}) {
  const router = useRouter();
  const buscaRef = useRef<HTMLInputElement>(null);
  const trava = useRef(false);
  const chaveVenda = useRef<string | null>(null);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [itens, setItens] = useState<Linha[]>([]);
  const [produto, setProduto] = useState<ProdutoPdv | null>(null);
  const [cliente, setCliente] = useState("");
  const [modalidade, setModalidade] = useState<"RETIRADA" | "BALCAO">(
    "RETIRADA",
  );
  const [observacao, setObservacao] = useState("");
  const [pagamento, setPagamento] = useState(false);
  const [desconto, setDesconto] = useState("0");
  const [taxa, setTaxa] = useState("0");
  const [forma, setForma] = useState<PagamentoPdv["forma"]>("DINHEIRO");
  const [valor, setValor] = useState("");
  const [pagamentos, setPagamentos] = useState<PagamentoPdv[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // Uma falha de rede pode ocorrer após o servidor gravar. A retentativa usa o mesmo payload/chave.
  const [incerta, setIncerta] = useState(false);
  const [online, setOnline] = useState(true);
  const categorias = [...new Set(dados.produtos.map((p) => p.categoria))];
  const filtro = busca.toLocaleLowerCase("pt-BR");
  const produtos = dados.produtos.filter(
    (p) =>
      (!categoria || p.categoria === categoria) &&
      `${p.nome} ${p.codigo}`.toLocaleLowerCase("pt-BR").includes(filtro),
  );
  const produtosPorId = new Map(dados.produtos.map((p) => [p.id, p]));
  const subtotal = itens.reduce((soma, item) => {
    const p = produtosPorId.get(item.produtoId);
    return soma + (p ? calcularPrecoItem(p, item.opcoes) * item.quantidade : 0);
  }, 0);
  const descontoCentavos = centavos(desconto);
  const taxaCentavos = centavos(taxa);
  const total = subtotal - descontoCentavos + taxaCentavos;
  const pago = pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0);
  const troco = Math.max(0, pago - total);
  const podeAbrirPagamento =
    itens.length > 0 && !!dados.caixa && podeVender && online;

  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine);
    const atalhos = (e: KeyboardEvent) => {
      if (!e.ctrlKey || document.querySelector("dialog[open]")) return;
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        buscaRef.current?.focus();
      }
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (podeAbrirPagamento) setPagamento(true);
      }
    };
    atualizar();
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    window.addEventListener("keydown", atalhos);
    const proteger = (e: BeforeUnloadEvent) => {
      if (itens.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", proteger);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
      window.removeEventListener("keydown", atalhos);
      window.removeEventListener("beforeunload", proteger);
    };
  }, [podeAbrirPagamento, itens.length]);

  function abrirProduto(p: ProdutoPdv) {
    if (incerta || ocupado) return;
    if (p.grupos.length) {
      setProduto(p);
      return;
    }
    adicionar(p, [], "", 1);
  }
  function adicionar(
    p: ProdutoPdv,
    opcoes: string[],
    nota: string,
    quantidade: number,
  ) {
    setItens((anteriores) => {
      const igual = anteriores.find(
        (i) =>
          i.produtoId === p.id &&
          !opcoes.length &&
          !i.opcoes.length &&
          !nota &&
          !i.observacao,
      );
      if (igual)
        return anteriores.map((i) =>
          i.chave === igual.chave
            ? { ...i, quantidade: Math.min(999, i.quantidade + quantidade) }
            : i,
        );
      return [
        ...anteriores,
        {
          chave: crypto.randomUUID(),
          produtoId: p.id,
          quantidade,
          opcoes,
          observacao: nota,
        },
      ];
    });
    setProduto(null);
    setAviso("");
    setErro("");
  }
  function registrarPagamento() {
    const recebido = centavos(
      valor || (Math.max(0, total - pago) / 100).toFixed(2),
    );
    if (!Number.isSafeInteger(recebido) || recebido <= 0) {
      setErro("Informe um valor de pagamento maior que zero.");
      return;
    }
    if (!Number.isSafeInteger(total) || total < 0) {
      setErro("Revise o desconto e a taxa adicional.");
      return;
    }
    if (forma !== "DINHEIRO" && recebido > total - pago) {
      setErro("Somente dinheiro pode gerar troco. Informe o valor restante.");
      return;
    }
    setPagamentos((p) => [...p, { forma, valorCentavos: recebido }]);
    setValor("");
    setErro("");
  }
  async function finalizar() {
    if (trava.current || !dados.caixa) return;
    if (!navigator.onLine) {
      setErro(
        "Sem conexão. O carrinho continua nesta tela; tente novamente quando a internet voltar.",
      );
      return;
    }
    if (
      !Number.isSafeInteger(total) ||
      total < 0 ||
      descontoCentavos > subtotal
    ) {
      setErro("Revise o desconto e a taxa adicional.");
      return;
    }
    trava.current = true;
    setOcupado(true);
    setErro("");
    chaveVenda.current ??= crypto.randomUUID();
    try {
      const resultado = await finalizarVendaAcao({
        chave: chaveVenda.current,
        caixaId: dados.caixa.id,
        clienteId: cliente || undefined,
        modalidade,
        observacao,
        itens: itens.map(({ produtoId, quantidade, opcoes, observacao }) => ({
          produtoId,
          quantidade,
          opcoes,
          observacao,
        })),
        descontoCentavos,
        taxaCentavos,
        pagamentos,
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        setIncerta(false);
        chaveVenda.current = null;
        return;
      }
      setAviso(
        `${resultado.ok ?? "Venda concluída."}${resultado.vendaId ? ` Identificação: ${resultado.vendaId.slice(-8).toUpperCase()}.` : ""}`,
      );
      setItens([]);
      setPagamentos([]);
      setCliente("");
      setObservacao("");
      setDesconto("0");
      setTaxa("0");
      setPagamento(false);
      setIncerta(false);
      chaveVenda.current = null;
      router.refresh();
    } catch {
      setIncerta(true);
      setErro(
        "Não foi possível confirmar a resposta. Tente confirmar novamente sem alterar a venda; a mesma identificação evita duplicação.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Frente de caixa
          </h1>
          <p className="text-ink-3 mt-1 text-sm">
            {unidade} ·{" "}
            {dados.caixa
              ? `Caixa aberto por ${dados.caixa.operador}`
              : "Caixa fechado"}
          </p>
        </div>
        <Link href="/pdv/caixa" className={estiloDeBotao("secundario")}>
          Gerenciar caixa
        </Link>
      </header>
      {!dados.caixa && (
        <div className="bg-warn-sub text-warn rounded-lg p-3 text-sm">
          Abra o caixa e selecione o local de estoque antes de concluir uma
          venda. Você já pode montar o carrinho.
        </div>
      )}
      {!podeVender && (
        <p className="bg-warn-sub text-warn rounded-lg p-3">
          Seu perfil pode consultar o PDV, mas não concluir vendas.
        </p>
      )}
      {!online && (
        <p role="status" className="bg-warn-sub text-warn rounded-lg p-3">
          Sem conexão. Mantenha esta tela aberta para preservar o carrinho. A
          conclusão exige internet.
        </p>
      )}
      {aviso && (
        <div
          role="status"
          className="bg-ok-sub text-ok flex flex-wrap items-center justify-between gap-2 rounded-lg p-3"
        >
          <p>{aviso}</p>
          <Link className="underline" href="/pdv/vendas">
            Ver vendas
          </Link>
        </div>
      )}
      {erro && !pagamento && (
        <p role="alert" className="bg-bad-sub text-bad rounded-lg p-3">
          {erro}
        </p>
      )}
      <div className="border-line bg-surface grid min-h-[540px] overflow-hidden rounded-xl border xl:h-[calc(100dvh-184px)] xl:min-h-[500px] xl:grid-cols-[180px_minmax(0,1fr)_340px] 2xl:grid-cols-[200px_minmax(0,1fr)_380px]">
        <nav
          aria-label="Categorias de produtos"
          className="border-line bg-surface flex overflow-x-auto border-b xl:flex-col xl:border-r xl:border-b-0"
        >
          <h2 className="text-ink-3 hidden px-4 py-5 text-sm font-semibold xl:block">
            Categorias
          </h2>
          {[null, ...categorias].map((c) => (
            <button
              key={c ?? "todas"}
              type="button"
              aria-pressed={categoria === c}
              onClick={() => setCategoria(c)}
              className={`focus-visible:outline-accent shrink-0 px-4 py-4 text-left text-sm transition-colors ${categoria === c ? "bg-accent-sub text-accent font-semibold" : "hover:bg-surface-2 text-ink-2"}`}
            >
              {c ?? "Todos os produtos"}
              <span className="ml-2 text-xs" aria-hidden="true">
                {" "}
                {c
                  ? dados.produtos.filter((p) => p.categoria === c).length
                  : dados.produtos.length}
              </span>
            </button>
          ))}
        </nav>
        <section className="bg-paper flex min-h-0 min-w-0 flex-col overflow-y-auto">
          <div className="border-line bg-surface border-b p-4">
            <label
              htmlFor="pdv-busca"
              className="text-ink-2 mb-2 block text-sm font-semibold"
            >
              Buscar produto{" "}
              <span className="text-ink-3 font-normal">Ctrl + B</span>
            </label>
            <input
              id="pdv-busca"
              ref={buscaRef}
              className="border-line-2 bg-surface focus:outline-accent h-11 w-full rounded-md border px-3"
              placeholder="Nome ou código de barras / PDV"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const exato = dados.produtos.find(
                    (p) => p.codigo && p.codigo === busca.trim(),
                  );
                  if (exato) {
                    abrirProduto(exato);
                    setBusca("");
                  }
                }
              }}
            />
          </div>
          {produtos.length ? (
            <div className="grid content-start gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
              {produtos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={incerta || ocupado}
                  onClick={() => abrirProduto(p)}
                  className="border-line bg-surface hover:border-accent focus-visible:outline-accent flex min-h-28 items-start gap-3 rounded-lg border p-4 text-left transition-colors disabled:opacity-50"
                >
                  <span className="bg-accent-sub text-accent mt-1 grid size-10 shrink-0 place-items-center rounded-lg">
                    <Icone nome="prato" tamanho={22} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-sm leading-5 font-semibold">
                      {p.nome}
                    </span>
                    <span className="text-ink-2 text-sm">
                      {p.grupos.length ? "A partir de " : ""}
                      {moeda(precoMinimo(p))}
                    </span>
                    {p.grupos.length > 0 && (
                      <span className="text-ink-3 text-xs">
                        Escolher opções
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-ink-3 m-auto max-w-sm px-6 py-16 text-center">
              <Icone nome="prato" tamanho={36} className="mx-auto mb-4" />
              <h2 className="text-ink font-semibold">
                {dados.produtos.length
                  ? "Nenhum produto encontrado"
                  : "Prepare seu catálogo"}
              </h2>
              <p className="mt-2 text-sm">
                {dados.produtos.length
                  ? "Busque por outro nome ou código."
                  : "Cadastre produtos como pratos nas fichas técnicas, com preço de venda e receita para a baixa de estoque."}
              </p>
              {!dados.produtos.length && (
                <Link
                  href="/cardapio/fichas"
                  className="text-accent mt-4 inline-block text-sm font-semibold underline"
                >
                  Abrir fichas técnicas
                </Link>
              )}
            </div>
          )}
        </section>
        <aside className="border-line bg-surface flex min-h-0 flex-col border-t xl:border-t-0 xl:border-l">
          <div className="border-line space-y-3 border-b p-4">
            <h2 className="font-semibold">Novo pedido</h2>
            <label className="text-ink-2 block text-sm">
              Cliente (opcional)
              <select
                aria-label="Cliente"
                className="border-line-2 bg-surface mt-1 h-11 w-full rounded-md border px-2"
                value={cliente}
                disabled={incerta || ocupado}
                onChange={(e) => setCliente(e.target.value)}
              >
                <option value="">Consumidor não identificado</option>
                {dados.clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-ink-2 block text-sm">
              Atendimento
              <select
                aria-label="Atendimento"
                className="border-line-2 bg-surface mt-1 h-11 w-full rounded-md border px-2"
                value={modalidade}
                disabled={incerta || ocupado}
                onChange={(e) =>
                  setModalidade(e.target.value as typeof modalidade)
                }
              >
                <option value="RETIRADA">Retirada</option>
                <option value="BALCAO">Balcão</option>
              </select>
            </label>
            <details className="text-ink-2 text-sm">
              <summary className="cursor-pointer py-1">
                Observação do pedido
              </summary>
              <label className="sr-only" htmlFor="pdv-observacao">
                Observação do pedido
              </label>
              <textarea
                id="pdv-observacao"
                aria-label="Observação do pedido"
                maxLength={500}
                className="border-line-2 bg-surface mt-1 w-full rounded-md border px-3 py-2"
                rows={2}
                value={observacao}
                disabled={incerta || ocupado}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </details>
          </div>
          <div className="flex items-center justify-between px-4 pt-4">
            <h3 className="text-sm font-semibold">
              Carrinho{" "}
              <span className="text-ink-3">
                ({itens.reduce((s, i) => s + i.quantidade, 0)})
              </span>
            </h3>
            {itens.length > 0 && (
              <button
                type="button"
                disabled={incerta || ocupado}
                className="text-ink-3 text-sm underline disabled:opacity-40"
                onClick={() => {
                  if (window.confirm("Limpar todos os itens deste carrinho?")) {
                    setItens([]);
                    setPagamentos([]);
                  }
                }}
              >
                Limpar
              </button>
            )}
          </div>
          <div className="max-h-[480px] min-h-24 flex-1 space-y-2 overflow-y-auto p-4 xl:max-h-none xl:min-h-0">
            {!itens.length && (
              <div className="text-ink-3 flex h-full min-h-24 flex-col items-center justify-center gap-3">
                <Icone nome="carrinho" tamanho={40} />
                <p className="text-sm">Escolha um produto para começar</p>
              </div>
            )}
            {itens.map((item) => {
              const p = produtosPorId.get(item.produtoId);
              if (!p) return null;
              const preco = calcularPrecoItem(p, item.opcoes);
              return (
                <article
                  className="bg-surface-2 rounded-lg p-3"
                  key={item.chave}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold">{p.nome}</h4>
                    <button
                      type="button"
                      aria-label={`Remover ${p.nome}`}
                      disabled={incerta || ocupado}
                      className="text-ink-3 hover:text-bad px-2"
                      onClick={() => {
                        setItens((a) =>
                          a.filter((i) => i.chave !== item.chave),
                        );
                        setPagamentos([]);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {p.grupos.flatMap((g) =>
                    g.opcoes
                      .filter((o) => item.opcoes.includes(o.id))
                      .map((o) => (
                        <p key={o.id} className="text-ink-3 mt-1 text-xs">
                          {g.nome}: {o.nome}
                        </p>
                      )),
                  )}
                  {item.observacao && (
                    <p className="text-ink-3 mt-1 text-xs">{item.observacao}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="border-line-2 bg-surface flex items-center rounded border">
                      <button
                        type="button"
                        aria-label={`Diminuir ${p.nome}`}
                        disabled={incerta || ocupado || item.quantidade === 1}
                        className="size-8 disabled:opacity-30"
                        onClick={() => {
                          setItens((a) =>
                            a.map((i) =>
                              i.chave === item.chave
                                ? { ...i, quantidade: i.quantidade - 1 }
                                : i,
                            ),
                          );
                          setPagamentos([]);
                        }}
                      >
                        −
                      </button>
                      <span className="px-2 text-sm tabular-nums">
                        {item.quantidade}
                      </span>
                      <button
                        type="button"
                        aria-label={`Aumentar ${p.nome}`}
                        disabled={incerta || ocupado || item.quantidade >= 999}
                        className="size-8"
                        onClick={() => {
                          setItens((a) =>
                            a.map((i) =>
                              i.chave === item.chave
                                ? { ...i, quantidade: i.quantidade + 1 }
                                : i,
                            ),
                          );
                          setPagamentos([]);
                        }}
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">
                      {moeda(preco * item.quantidade)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          <footer className="border-line space-y-3 border-t p-4">
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Subtotal</span>
              <strong className="tabular-nums">{moeda(subtotal)}</strong>
            </div>
            <Botao
              className="w-full justify-between"
              disabled={!podeAbrirPagamento}
              onClick={() => {
                setErro("");
                setPagamento(true);
              }}
            >
              <span>
                Pagar <span className="ml-1 text-xs font-normal">Ctrl + P</span>
              </span>
              <span>{moeda(subtotal)}</span>
            </Botao>
          </footer>
        </aside>
      </div>
      {produto && (
        <PersonalizarProduto
          produto={produto}
          aoFechar={() => setProduto(null)}
          aoAdicionar={adicionar}
        />
      )}
      <PainelLateral
        aberto={pagamento}
        aoFechar={() => {
          if (!ocupado && !incerta) setPagamento(false);
        }}
        podeFechar={() => !ocupado && !incerta}
        titulo="Pagamento do pedido"
        apoio="Registre os valores recebidos. Pix e cartões são conferidos manualmente."
        rodape={
          <Botao
            className="w-full"
            carregando={ocupado}
            disabled={
              !online ||
              pago < total ||
              !pagamentos.length ||
              !Number.isSafeInteger(total) ||
              total < 0 ||
              descontoCentavos > subtotal
            }
            onClick={() => void finalizar()}
          >
            {incerta ? "Confirmar novamente" : "Concluir venda"} ·{" "}
            {Number.isFinite(total) ? moeda(total) : "Revise os valores"}
          </Botao>
        }
      >
        <div className="space-y-5">
          <dl className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{moeda(subtotal)}</dd>
          </dl>
          <div className="grid grid-cols-2 gap-3">
            <Campo
              rotulo="Desconto (R$)"
              inputMode="decimal"
              value={desconto}
              disabled={
                !podeDesconto || ocupado || incerta || pagamentos.length > 0
              }
              ajuda={
                !podeDesconto
                  ? "Seu perfil não permite conceder descontos."
                  : undefined
              }
              onChange={(e) => setDesconto(e.target.value)}
            />
            <Campo
              rotulo="Taxa adicional (R$)"
              inputMode="decimal"
              value={taxa}
              disabled={ocupado || incerta || pagamentos.length > 0}
              onChange={(e) => setTaxa(e.target.value)}
            />
          </div>
          <div className="border-line flex justify-between border-y py-4 text-lg font-semibold">
            <span>Total</span>
            <span>{Number.isFinite(total) ? moeda(total) : "—"}</span>
          </div>
          <fieldset disabled={ocupado || incerta}>
            <legend className="mb-2 text-sm font-semibold">
              Forma de pagamento
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(formas).map(([id, nome]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={forma === id}
                  className={`border-line-2 min-h-11 rounded-md border px-3 text-sm ${forma === id ? "bg-accent-sub text-accent" : "hover:bg-surface-2"}`}
                  onClick={() => setForma(id as PagamentoPdv["forma"])}
                >
                  {nome}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <Campo
                rotulo={
                  forma === "DINHEIRO"
                    ? "Valor recebido (R$)"
                    : "Valor pago (R$)"
                }
                inputMode="decimal"
                placeholder={
                  Number.isFinite(total)
                    ? (Math.max(0, total - pago) / 100)
                        .toFixed(2)
                        .replace(".", ",")
                    : "0,00"
                }
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <Botao
              className="mt-3 w-full"
              peso="secundario"
              disabled={pago >= total}
              onClick={registrarPagamento}
            >
              Adicionar pagamento
            </Botao>
          </fieldset>
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Pagamentos registrados
            </h3>
            {!pagamentos.length && (
              <p className="text-ink-3 text-sm">
                Adicione uma ou mais formas de pagamento.
              </p>
            )}
            {pagamentos.map((p, i) => (
              <div
                key={i}
                className="border-line flex items-center gap-2 border-b py-3 text-sm"
              >
                <span className="flex-1">{formas[p.forma]}</span>
                <strong>{moeda(p.valorCentavos)}</strong>
                <button
                  aria-label={`Remover pagamento ${i + 1}`}
                  type="button"
                  disabled={ocupado || incerta}
                  className="text-ink-3 px-2"
                  onClick={() =>
                    setPagamentos((a) => a.filter((_, n) => n !== i))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </section>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Total pago</dt>
              <dd>{moeda(pago)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Falta pagar</dt>
              <dd>
                {Number.isFinite(total)
                  ? moeda(Math.max(0, total - pago))
                  : "—"}
              </dd>
            </div>
            {troco > 0 && (
              <div className="text-accent flex justify-between text-lg font-semibold">
                <dt>Troco</dt>
                <dd>{moeda(troco)}</dd>
              </div>
            )}
          </dl>
          {erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-lg p-3 text-sm"
            >
              {erro}
            </p>
          )}
          {incerta && (
            <Link
              href="/pdv/vendas"
              target="_blank"
              className="text-accent text-sm underline"
            >
              Consultar vendas em outra aba
            </Link>
          )}
        </div>
      </PainelLateral>
    </div>
  );
}

function PersonalizarProduto({
  produto,
  aoFechar,
  aoAdicionar,
}: {
  produto: ProdutoPdv;
  aoFechar: () => void;
  aoAdicionar: (
    produto: ProdutoPdv,
    opcoes: string[],
    nota: string,
    quantidade: number,
  ) => void;
}) {
  const [opcoes, setOpcoes] = useState<string[]>([]);
  const [observacao, setObservacao] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  let preco = produto.precoCentavos;
  let valida = true;
  try {
    preco = calcularPrecoItem(produto, opcoes);
  } catch {
    valida = false;
  }
  const quantidadeValida =
    /^\d+$/.test(quantidade) &&
    Number(quantidade) >= 1 &&
    Number(quantidade) <= 999;
  return (
    <PainelLateral
      aberto
      aoFechar={aoFechar}
      titulo={produto.nome}
      apoio="Escolha os complementos antes de adicionar."
      rodape={
        <Botao
          className="w-full"
          disabled={!valida || !quantidadeValida}
          onClick={() =>
            aoAdicionar(produto, opcoes, observacao, Number(quantidade))
          }
        >
          Adicionar ·{" "}
          {moeda(preco * (quantidadeValida ? Number(quantidade) : 1))}
        </Botao>
      }
    >
      <div className="space-y-6">
        {produto.grupos.map((g) => {
          const selecionadas = g.opcoes.filter((o) =>
            opcoes.includes(o.id),
          ).length;
          return (
            <fieldset key={g.id}>
              <legend className="font-semibold">{g.nome}</legend>
              <p className="text-ink-3 mt-1 text-xs">
                {g.minimo > 0
                  ? `Obrigatório · escolha de ${g.minimo} a ${g.maximo}`
                  : `Opcional · até ${g.maximo}`}{" "}
                · {selecionadas} selecionado(s)
                {g.calculo === "MEDIA" ? " · Preço pela média das opções" : ""}
              </p>
              <div className="divide-line mt-3 divide-y">
                {g.opcoes.map((o) => (
                  <label
                    key={o.id}
                    className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="accent-accent size-4"
                      checked={opcoes.includes(o.id)}
                      disabled={
                        !opcoes.includes(o.id) &&
                        selecionadas >= g.maximo &&
                        g.maximo !== 1
                      }
                      onChange={(e) =>
                        setOpcoes((a) =>
                          e.target.checked
                            ? [
                                ...(g.maximo === 1
                                  ? a.filter(
                                      (id) =>
                                        !g.opcoes.some((op) => op.id === id),
                                    )
                                  : a),
                                o.id,
                              ]
                            : a.filter((id) => id !== o.id),
                        )
                      }
                    />
                    <span className="flex-1">{o.nome}</span>
                    <span className="text-ink-3">{moeda(o.precoCentavos)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        <Campo
          rotulo="Quantidade"
          inputMode="numeric"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
        />
        <label className="text-ink-2 block text-sm font-semibold">
          Observação do item
          <textarea
            className="border-line-2 bg-surface mt-2 w-full rounded-md border p-3 font-normal"
            maxLength={140}
            rows={3}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </label>
        {!valida && (
          <p className="text-warn text-sm">
            Complete as escolhas obrigatórias para adicionar.
          </p>
        )}
      </div>
    </PainelLateral>
  );
}
