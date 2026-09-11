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
import { Icone } from "@/design-system/icones";
import { sigla } from "@/lib/unidades";
import {
  CASAS,
  digitado,
  dividirArredondando,
  doBanco,
  numeroBrDe,
  quantidadeBr,
} from "@/modules/compras/schemas/aritmetica";
import type { VistaDaConferencia } from "@/modules/compras/services/recebimentos";

import { conferirRecebimentoAcao, type EstadoDaConferencia } from "./acoes";

/**
 * A CONFERÊNCIA NA PORTA — o que o caminhão trouxe, contado como ele entrega.
 *
 * Caixa se conta em caixas; a granel, em kg. A tela converte na hora pelo
 * fator DO PEDIDO ("2 caixas = 21,6 kg") com as mesmas contas do servidor.
 * Chegou mais do que falta? A tela pede a decisão ali mesmo — aceitar ou
 * recusar o excesso. Avariado não entra no estoque. Veio outro produto? Só
 * entra com decisão.
 *
 * A chave desta conferência nasce quando a tela abre: dois cliques, uma
 * entrada. Depois de gravar, os campos se esvaziam — o saldo novo já vem do
 * servidor.
 */

type Linha = VistaDaConferencia["linhas"][number];
type Decisao = "" | "ACEITAR" | "RECUSAR";

type Digitado = {
  boas: string;
  avariadas: string;
  decisaoExcedente: Decisao;
  trocou: boolean;
  substitutoInsumoId: string;
  decisaoSubstituicao: Decisao;
  lote: string;
  validade: string;
  observacao: string;
  fotoIds: string[];
  aberto: boolean;
};

const vazio = (): Digitado => ({
  boas: "",
  avariadas: "",
  decisaoExcedente: "",
  trocou: false,
  substitutoInsumoId: "",
  decisaoSubstituicao: "",
  lote: "",
  validade: "",
  observacao: "",
  fotoIds: [],
  aberto: false,
});

const CAIXA =
  "bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent h-11 w-full min-w-0 rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-10 md:text-sm";

const GRADE =
  "md:grid md:grid-cols-[minmax(0,1.9fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_auto] md:items-start md:gap-4";

/** Texto digitado → milésimos; `null` vazio; `"erro"` quando não é número. */
function lerMil(texto: string): bigint | null | "erro" {
  try {
    return digitado(texto, CASAS.milesimos);
  } catch {
    return "erro";
  }
}

function paraEstoque(l: Linha, emCompra: bigint): bigint {
  return l.fracionavel
    ? emCompra
    : dividirArredondando(
        emCompra * doBanco(l.fator, CASAS.dezMilesimos),
        10_000n,
      );
}

function saldoEmCompra(l: Linha): bigint {
  const saldo = doBanco(l.saldo, CASAS.milesimos);
  return l.fracionavel
    ? saldo
    : dividirArredondando(
        saldo * 10_000n,
        doBanco(l.fator, CASAS.dezMilesimos),
      );
}

function unidadeDeContagem(l: Linha): string {
  return l.fracionavel
    ? sigla(l.unidade)
    : (l.nomeEmbalagem ?? "embalagens").toLowerCase();
}

export function ConferenciaDoRecebimento({
  pedidoId,
  chave,
  linhas,
  locais,
  notas,
  insumos,
}: {
  pedidoId: string;
  chave: string;
  linhas: Linha[];
  locais: VistaDaConferencia["locais"];
  notas: VistaDaConferencia["notas"];
  insumos: VistaDaConferencia["insumos"];
}) {
  const inicial = () =>
    Object.fromEntries(linhas.map((l) => [l.itemDePedidoId, vazio()]));
  const [digitados, setDigitados] = useState<Record<string, Digitado>>(inicial);
  const [fotos, setFotos] = useState<
    Record<string, { enviando: boolean; erro: string | null }>
  >({});
  const [modoNota, setModoNota] = useState<"nova" | "existente">("nova");
  const [aviso, setAviso] = useState<string | null>(null);
  const base = useId();

  const emVoo = useRef(false);
  const [estado, despachar, enviando] = useActionState<
    EstadoDaConferencia,
    FormData
  >(async (anterior, dados) => {
    try {
      const r = await conferirRecebimentoAcao(anterior, dados);
      // Gravou: os campos esvaziam. Um segundo clique não manda a mesma
      // conferência de novo — e o saldo novo já vem do servidor.
      if (r.ok && r.recebimentoId) setDigitados(inicial());
      return r;
    } finally {
      emVoo.current = false;
    }
  }, {});
  const erros = estado.erros ?? {};

  function mudar(id: string, parcial: Partial<Digitado>) {
    setDigitados((atual) => ({ ...atual, [id]: { ...atual[id], ...parcial } }));
  }

  function chegouTudo() {
    setDigitados((atual) => {
      const novo = { ...atual };
      for (const l of linhas) {
        const falta = saldoEmCompra(l);
        if (falta > 0n && !atual[l.itemDePedidoId].boas.trim()) {
          novo[l.itemDePedidoId] = {
            ...atual[l.itemDePedidoId],
            boas: numeroBrDe(falta, CASAS.milesimos),
          };
        }
      }
      return novo;
    });
  }

  async function enviarFotos(id: string, arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    const ja = digitados[id].fotoIds.length;
    setFotos((f) => ({ ...f, [id]: { enviando: true, erro: null } }));
    const novas: string[] = [];
    let erro: string | null = null;
    for (const arquivo of Array.from(arquivos).slice(0, Math.max(0, 6 - ja))) {
      const corpo = new FormData();
      corpo.set("finalidade", "foto-recebimento");
      corpo.set("arquivo", arquivo);
      try {
        const r = await fetch("/api/arquivos", { method: "POST", body: corpo });
        const json = (await r.json().catch(() => ({}))) as {
          id?: string;
          erro?: string;
        };
        if (r.ok && json.id) novas.push(json.id);
        else erro = json.erro ?? "Não deu para enviar a foto.";
      } catch {
        erro = "Sem conexão para enviar a foto. Tente de novo.";
      }
    }
    setDigitados((atual) => ({
      ...atual,
      [id]: {
        ...atual[id],
        fotoIds: [...atual[id].fotoIds, ...novas].slice(0, 6),
      },
    }));
    setFotos((f) => ({ ...f, [id]: { enviando: false, erro } }));
  }

  const informadas = linhas.filter((l) => {
    const d = digitados[l.itemDePedidoId];
    return d.boas.trim() !== "" || d.avariadas.trim() !== "";
  });

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current) return;
    setAviso(null);
    if (informadas.length === 0) {
      setAviso("Informe o que chegou em pelo menos um item.");
      return;
    }
    if (
      !window.confirm(
        `Lançar no estoque ${informadas.length} ${informadas.length === 1 ? "item" : "itens"}? Confira as quantidades — depois disso, correção só por devolução.`,
      )
    ) {
      return;
    }
    emVoo.current = true;
    const dados = new FormData(evento.currentTarget);
    dados.set(
      "linhas",
      JSON.stringify(
        linhas.map((l) => {
          const d = digitados[l.itemDePedidoId];
          return {
            itemDePedidoId: l.itemDePedidoId,
            boas: d.boas.trim(),
            avariadas: d.avariadas.trim(),
            fracionavel: l.fracionavel,
            decisaoExcedente: d.decisaoExcedente,
            substitutoInsumoId: d.trocou ? d.substitutoInsumoId : "",
            decisaoSubstituicao: d.trocou ? d.decisaoSubstituicao : "",
            lote: d.lote,
            validade: d.validade,
            observacao: d.observacao,
            fotoIds: d.fotoIds,
          };
        }),
      ),
    );
    if (modoNota === "nova") dados.delete("notaExistenteId");
    startTransition(() => despachar(dados));
  }

  return (
    <form onSubmit={enviar} noValidate className="flex min-w-0 flex-col">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="chave" value={chave} />

      <div className="border-line grid gap-4 border-b p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${base}-local`}
            className="text-ink-2 text-sm font-semibold"
          >
            Onde guardar
          </label>
          {locais.length > 0 ? (
            <select
              id={`${base}-local`}
              name="localDestinoId"
              required
              className={CAIXA}
            >
              {locais.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-bad text-sm">
              Esta loja não tem local de estoque. Cadastre um em Estoque antes
              de conferir.
            </p>
          )}
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-ink-2 mb-1.5 text-sm font-semibold">
            Nota fiscal
          </legend>
          <div className="flex flex-wrap gap-2">
            <label className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9">
              <input
                type="radio"
                name="modoNota"
                checked={modoNota === "nova"}
                onChange={() => setModoNota("nova")}
                className="size-4"
              />
              Lançar a entrada agora
            </label>
            {notas.length > 0 && (
              <label className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9">
                <input
                  type="radio"
                  name="modoNota"
                  checked={modoNota === "existente"}
                  onChange={() => setModoNota("existente")}
                  className="size-4"
                />
                Ligar a uma nota já lançada no Estoque
              </label>
            )}
          </div>
          {modoNota === "nova" ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,2fr)]">
              <input
                name="numeroNota"
                placeholder="Número da nota"
                maxLength={20}
                aria-label="Número da nota (opcional)"
                className={CAIXA}
              />
              <input
                name="serieNota"
                placeholder="Série"
                maxLength={5}
                aria-label="Série da nota (opcional)"
                className={CAIXA}
              />
              <input
                name="chaveAcesso"
                placeholder="Chave de acesso (44 dígitos)"
                inputMode="numeric"
                maxLength={60}
                aria-label="Chave de acesso da nota (opcional)"
                className={CAIXA}
              />
            </div>
          ) : (
            <select
              name="notaExistenteId"
              aria-label="Nota já lançada"
              className={CAIXA}
            >
              {notas.map((n) => (
                <option key={n.id} value={n.id}>
                  NF {n.numero ?? "sem número"}
                  {n.serie ? `/${n.serie}` : ""} ·{" "}
                  {new Date(n.recebidaEm).toLocaleDateString("pt-BR")} · R${" "}
                  {n.valorTotal.replace(".", ",")}
                </option>
              ))}
            </select>
          )}
          <p className="text-ink-3 text-xs leading-[18px]">
            {modoNota === "nova"
              ? "A entrada no estoque acontece com ou sem o número — anote se a nota veio com o caminhão."
              : "A nota já deu entrada no estoque: a conferência se liga a ela, sem entrar duas vezes."}
          </p>
        </fieldset>
      </div>

      <div className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="text-ink-3 text-xs leading-[18px]">
          Conte como o caminhão entrega. Avariado fica fora do estoque e vira
          divergência.
        </p>
        <Botao
          type="button"
          peso="secundario"
          tamanho="pequeno"
          onClick={chegouTudo}
        >
          Chegou tudo o que falta
        </Botao>
      </div>

      <ul className="divide-line divide-y">
        <li
          aria-hidden
          className={`text-ink-3 hidden px-4 py-2 text-xs font-medium ${GRADE}`}
        >
          <span>Item</span>
          <span>Pedido</span>
          <span className="text-right">Já entrou</span>
          <span className="text-right">Falta</span>
          <span>Chegou bom</span>
          <span>Avariado</span>
          <span className="sr-only">Mais</span>
        </li>
        {linhas.map((l) => {
          const d = digitados[l.itemDePedidoId];
          const boas = lerMil(d.boas);
          const avariadas = lerMil(d.avariadas);
          const falta = doBanco(l.saldo, CASAS.milesimos);
          const boasEstoque =
            typeof boas === "bigint" ? paraEstoque(l, boas) : null;
          const excedente =
            boasEstoque !== null && !d.trocou
              ? boasEstoque - (falta > 0n ? falta : 0n)
              : 0n;
          const contagem = unidadeDeContagem(l);
          const id = `${base}-${l.itemDePedidoId}`;
          const erro = erros[l.itemDePedidoId];
          const foto = fotos[l.itemDePedidoId];

          return (
            <li key={l.itemDePedidoId} className="px-4 py-3">
              <div className={`flex flex-col gap-2 ${GRADE}`}>
                <div className="min-w-0">
                  <p className="text-ink text-sm leading-5 font-medium">
                    {l.nome}
                  </p>
                  <p className="text-ink-3 text-xs leading-[18px]">
                    {l.fracionavel
                      ? `a granel (${sigla(l.unidade)})`
                      : `${l.nomeEmbalagem ?? "Embalagem"}: ${l.embalagem}`}
                  </p>
                </div>
                <p className="flex justify-between gap-2 text-sm md:block">
                  <span className="text-ink-3 text-xs md:hidden">Pedido</span>
                  <span className="text-ink-2 tabular-nums">
                    {l.fracionavel
                      ? quantidadeBr(
                          doBanco(l.pedido, CASAS.milesimos),
                          l.unidade,
                        )
                      : `${l.embalagensPedidas.replace(".", ",")} ${contagem}`}
                    {!l.fracionavel && (
                      <span className="text-ink-3 block text-xs">
                        ={" "}
                        {quantidadeBr(
                          doBanco(l.pedido, CASAS.milesimos),
                          l.unidade,
                        )}
                      </span>
                    )}
                  </span>
                </p>
                <p className="flex justify-between gap-2 text-sm md:block md:text-right">
                  <span className="text-ink-3 text-xs md:hidden">
                    Já entrou
                  </span>
                  <span className="text-ink-2 tabular-nums">
                    {quantidadeBr(
                      doBanco(l.recebido, CASAS.milesimos),
                      l.unidade,
                    )}
                  </span>
                </p>
                <p className="flex justify-between gap-2 text-sm md:block md:text-right">
                  <span className="text-ink-3 text-xs md:hidden">Falta</span>
                  <span
                    className={`tabular-nums ${falta > 0n ? "text-warn font-semibold" : "text-ok"}`}
                  >
                    {falta > 0n ? quantidadeBr(falta, l.unidade) : "nada"}
                  </span>
                </p>
                <div className="flex min-w-0 flex-col gap-1">
                  <label
                    htmlFor={`${id}-boas`}
                    className="text-ink-3 text-xs md:sr-only"
                  >
                    Chegou bom ({contagem})
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${id}-boas`}
                      value={d.boas}
                      onChange={(e) =>
                        mudar(l.itemDePedidoId, { boas: e.target.value })
                      }
                      inputMode="decimal"
                      placeholder="0"
                      aria-invalid={boas === "erro" || erro ? true : undefined}
                      aria-label={`Quantas ${contagem} de ${l.nome} chegaram boas`}
                      className={`${CAIXA} tabular-nums`}
                    />
                    <span className="text-ink-2 max-w-[5.5rem] flex-none truncate text-xs font-medium">
                      {contagem}
                    </span>
                  </div>
                  {boas === "erro" ? (
                    <p className="text-bad text-xs">Não é um número.</p>
                  ) : (
                    boasEstoque !== null &&
                    boasEstoque > 0n &&
                    !l.fracionavel && (
                      <p className="text-ink-3 text-xs tabular-nums">
                        = {quantidadeBr(boasEstoque, l.unidade)} no estoque
                      </p>
                    )
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label
                    htmlFor={`${id}-avariadas`}
                    className="text-ink-3 text-xs md:sr-only"
                  >
                    Avariado ({contagem})
                  </label>
                  <input
                    id={`${id}-avariadas`}
                    value={d.avariadas}
                    onChange={(e) =>
                      mudar(l.itemDePedidoId, { avariadas: e.target.value })
                    }
                    inputMode="decimal"
                    placeholder="0"
                    aria-invalid={avariadas === "erro" ? true : undefined}
                    aria-label={`Quantas ${contagem} de ${l.nome} chegaram avariadas`}
                    className={`${CAIXA} tabular-nums`}
                  />
                  {typeof avariadas === "bigint" && avariadas > 0n && (
                    <p className="text-warn text-xs">Não entra no estoque.</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-expanded={d.aberto}
                  aria-controls={`${id}-mais`}
                  onClick={() => mudar(l.itemDePedidoId, { aberto: !d.aberto })}
                  className="text-accent hover:bg-accent-sub focus-visible:outline-accent inline-flex min-h-11 items-center gap-1 self-start rounded-md px-2 text-sm font-semibold focus-visible:outline-2 md:min-h-10"
                >
                  {d.fotoIds.length > 0
                    ? `${d.fotoIds.length} foto${d.fotoIds.length > 1 ? "s" : ""}`
                    : "Lote, fotos…"}
                  <Icone
                    nome="seta-baixo"
                    tamanho={14}
                    className={d.aberto ? "rotate-180" : ""}
                  />
                </button>
              </div>

              {excedente > 0n && (
                <fieldset className="border-warn/30 bg-warn-sub mt-3 flex flex-col gap-2 rounded-md border p-3">
                  <legend className="text-warn px-1 text-sm font-semibold">
                    Chegou {quantidadeBr(excedente, l.unidade)} a mais do que
                    falta
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        [
                          "ACEITAR",
                          "Aceitar tudo (vira divergência a conciliar)",
                        ],
                        ["RECUSAR", "Recusar o excesso na porta"],
                      ] as const
                    ).map(([valor, texto]) => (
                      <label
                        key={valor}
                        className="bg-surface border-line-2 has-[:checked]:border-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9"
                      >
                        <input
                          type="radio"
                          name={`excedente-${l.itemDePedidoId}`}
                          checked={d.decisaoExcedente === valor}
                          onChange={() =>
                            mudar(l.itemDePedidoId, { decisaoExcedente: valor })
                          }
                          className="size-4"
                        />
                        {texto}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {d.aberto && (
                <div
                  id={`${id}-mais`}
                  className="bg-surface-2 mt-3 grid gap-3 rounded-md p-3 md:grid-cols-4"
                >
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${id}-lote`}
                      className="text-ink-2 text-xs font-semibold"
                    >
                      Lote
                    </label>
                    <input
                      id={`${id}-lote`}
                      value={d.lote}
                      onChange={(e) =>
                        mudar(l.itemDePedidoId, { lote: e.target.value })
                      }
                      maxLength={40}
                      className={CAIXA}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${id}-validade`}
                      className="text-ink-2 text-xs font-semibold"
                    >
                      Validade
                    </label>
                    <input
                      id={`${id}-validade`}
                      type="date"
                      value={d.validade}
                      onChange={(e) =>
                        mudar(l.itemDePedidoId, { validade: e.target.value })
                      }
                      className={CAIXA}
                    />
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label
                      htmlFor={`${id}-obs`}
                      className="text-ink-2 text-xs font-semibold"
                    >
                      Observação
                    </label>
                    <input
                      id={`${id}-obs`}
                      value={d.observacao}
                      onChange={(e) =>
                        mudar(l.itemDePedidoId, { observacao: e.target.value })
                      }
                      maxLength={300}
                      placeholder="Ex.: caixa amassada, temperatura"
                      className={CAIXA}
                    />
                  </div>
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label
                      htmlFor={`${id}-fotos`}
                      className="text-ink-2 text-xs font-semibold"
                    >
                      Fotos (até 6)
                    </label>
                    <input
                      id={`${id}-fotos`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      disabled={foto?.enviando || d.fotoIds.length >= 6}
                      onChange={(e) => {
                        void enviarFotos(
                          l.itemDePedidoId,
                          e.currentTarget.files,
                        );
                        e.currentTarget.value = "";
                      }}
                      className="text-ink-2 file:bg-surface file:border-line-2 file:text-ink text-sm file:mr-3 file:h-10 file:rounded-md file:border file:px-3 file:text-sm file:font-semibold"
                    />
                    {foto?.enviando && (
                      <p role="status" className="text-ink-3 text-xs">
                        Enviando…
                      </p>
                    )}
                    {foto?.erro && (
                      <p role="alert" className="text-bad text-xs">
                        {foto.erro}
                      </p>
                    )}
                    {d.fotoIds.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {d.fotoIds.map((fid, i) => (
                          <li
                            key={fid}
                            className="bg-surface border-line flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                          >
                            <a
                              href={`/api/arquivos/${fid}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                            >
                              Foto {i + 1}
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                mudar(l.itemDePedidoId, {
                                  fotoIds: d.fotoIds.filter((x) => x !== fid),
                                })
                              }
                              aria-label={`Tirar a foto ${i + 1}`}
                              className="text-ink-3 hover:text-ink grid size-6 place-items-center rounded-sm"
                            >
                              <Icone nome="fechar" tamanho={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 md:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={d.trocou}
                        onChange={(e) =>
                          mudar(l.itemDePedidoId, {
                            trocou: e.target.checked,
                            substitutoInsumoId: "",
                            decisaoSubstituicao: "",
                          })
                        }
                        className="size-4"
                      />
                      Veio outro produto no lugar
                    </label>
                    {d.trocou && (
                      <>
                        <select
                          aria-label="Qual produto veio"
                          value={d.substitutoInsumoId}
                          onChange={(e) =>
                            mudar(l.itemDePedidoId, {
                              substitutoInsumoId: e.target.value,
                            })
                          }
                          className={CAIXA}
                        >
                          <option value="">Qual produto veio?</option>
                          {insumos
                            .filter((i) => i.id !== l.insumoId)
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.nome}
                              </option>
                            ))}
                        </select>
                        <div className="flex flex-wrap gap-2">
                          {(
                            [
                              ["ACEITAR", "Aceitar no lugar"],
                              ["RECUSAR", "Recusar e devolver"],
                            ] as const
                          ).map(([valor, texto]) => (
                            <label
                              key={valor}
                              className="bg-surface border-line-2 has-[:checked]:border-accent flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9"
                            >
                              <input
                                type="radio"
                                name={`troca-${l.itemDePedidoId}`}
                                checked={d.decisaoSubstituicao === valor}
                                onChange={() =>
                                  mudar(l.itemDePedidoId, {
                                    decisaoSubstituicao: valor,
                                  })
                                }
                                className="size-4"
                              />
                              {texto}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {erro && (
                <p role="alert" className="text-bad mt-2 text-sm">
                  {erro}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-line flex flex-col gap-3 border-t p-4">
        <label className="flex items-start gap-2 text-sm leading-5">
          <input
            type="checkbox"
            name="gerarContaAPagar"
            defaultChecked
            className="mt-0.5 size-4"
          />
          <span>
            Criar a conta a pagar no Financeiro
            <span className="text-ink-3 block text-xs">
              Uma por nota — se a nota já tiver conta, nada se duplica. Sem
              permissão do Financeiro, fica para quem cuida dele.
            </span>
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${base}-observacao`}
            className="text-ink-2 text-sm font-semibold"
          >
            Observação da entrega — opcional
          </label>
          <input
            id={`${base}-observacao`}
            name="observacao"
            maxLength={300}
            className={CAIXA}
          />
        </div>
      </div>

      {(aviso || estado.erro) && (
        <p
          role="alert"
          className="bg-bad-sub text-bad mx-4 rounded-md px-3 py-2 text-sm leading-5"
        >
          {aviso ?? estado.erro}
          {!aviso && erros.geral ? ` ${erros.geral}` : ""}
        </p>
      )}
      {estado.ok && !aviso && (
        <p
          role="status"
          className="bg-ok-sub text-ok mx-4 rounded-md px-3 py-2 text-sm leading-5"
        >
          {estado.ok}
        </p>
      )}

      <div className="bg-surface border-line sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t px-4 py-3">
        <p className="text-ink-2 text-sm" aria-live="polite">
          {informadas.length === 0
            ? "Nada informado ainda"
            : `${informadas.length} ${informadas.length === 1 ? "item informado" : "itens informados"}`}
        </p>
        <Botao
          type="submit"
          carregando={enviando}
          disabled={locais.length === 0}
        >
          Conferir recebimento
        </Botao>
      </div>
    </form>
  );
}
