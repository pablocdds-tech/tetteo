"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import {
  camposEditaveis,
  type EdicaoFiscal,
  type RascunhoFiscal,
} from "../schemas/rascunho-fiscal";

const cabecalho = [
  ["razao_social", "Fornecedor", 160],
  ["cnpj_emitente", "CNPJ do fornecedor", 14],
  ["cpf_emitente", "CPF do fornecedor", 11],
  ["data_emissao", "Data de emissão", 10],
  ["numero", "Número do documento", 60],
  ["serie", "Série", 20],
  ["chave_acesso", "Chave de acesso", 44],
] as const;
const produto = [
  ["descricao", "Produto", 240],
  ["quantidade", "Quantidade", 24],
  ["unidade", "Unidade", 30],
  ["valor_unitario", "Preço unitário", 24],
  ["valor_total", "Total do item", 24],
  ["codigo_ean", "EAN", 14],
  ["codigo_fornecedor", "Código do fornecedor", 80],
] as const;
const totais = [
  ["descontos", "Descontos", 24],
  ["acrescimos", "Acréscimos", 24],
  ["total_nota", "Valor final", 24],
  ["forma_pagamento", "Pagamento impresso", 80],
] as const;
const numeros = new Set([
  "quantidade",
  "valor_unitario",
  "valor_total",
  "descontos",
  "acrescimos",
  "total_nota",
]);
type Valores = Record<string, string>;
function valoresDoRascunho(dados: EdicaoFiscal): Valores {
  return Object.fromEntries([
    ...Object.entries(dados)
      .filter(([k]) => k !== "itens")
      .map(([k, v]) => [k, v === null ? "" : String(v)]),
    ...dados.itens.flatMap((i, n) =>
      Object.entries(i).map(([k, v]) => [
        `itens.${n}.${k}`,
        v === null ? "" : String(v),
      ]),
    ),
  ]);
}

function valorDoCampo(campo: string, valor: string): string | number | null {
  const v = valor.trim();
  if (!v) return null;
  if (!numeros.has(campo)) return v;
  const normalizado = v.includes(",")
    ? v.replaceAll(".", "").replace(",", ".")
    : v;
  if (
    !/^\d+(?:\.\d+)?$/.test(normalizado) ||
    !Number.isFinite(Number(normalizado))
  )
    throw new Error(
      "Confira os campos numéricos. Use um valor positivo ou deixe vazio.",
    );
  return Number(normalizado);
}

export function FormularioRascunhoFiscal({
  unidadeId,
  unidade,
}: {
  unidadeId: string;
  unidade: string;
}) {
  const [rascunho, setRascunho] = useState<RascunhoFiscal | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [linhas, setLinhas] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [alterado, setAlterado] = useState(false);
  const [recentes, setRecentes] = useState<
    { id: string; fornecedor: string }[]
  >([]);
  const [recarregar, setRecarregar] = useState(0);
  const operacao = useRef<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const api = "/api/notas/rascunhos";

  useEffect(() => {
    let atual = true;
    fetch(api, { headers: { "x-unidade-id": unidadeId }, cache: "no-store" })
      .then(async (r) => {
        if (r.ok && atual) setRecentes(await r.json());
      })
      .catch(() => {
        /* O envio continua disponível; nenhum dado é armazenado no navegador. */
      });
    return () => {
      atual = false;
    };
  }, [unidadeId, recarregar]);

  function receber(d: RascunhoFiscal) {
    setRascunho(d);
    setValores(valoresDoRascunho(camposEditaveis(d.dados)));
    setLinhas(d.dados.itens.length);
    setAlterado(false);
  }

  async function executar(fazer: () => Promise<Response>, sucesso: string) {
    setOcupado(true);
    setErro("");
    setMensagem("");
    try {
      const r = await fazer();
      const dados = await r.json();
      if (!r.ok) {
        setErro(dados.erro ?? "Não foi possível concluir. Tente novamente.");
        return;
      }
      receber(dados);
      setMensagem(sucesso);
      setRecarregar((n) => n + 1);
    } catch {
      setErro(
        "A conexão foi interrompida. Seus campos continuam nesta tela. Tente novamente ou abra o rascunho salvo.",
      );
    } finally {
      setOcupado(false);
    }
  }

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = arquivo.current?.files?.[0];
    if (!f || f.size > 20 * 1024 * 1024 || !f.size) {
      setErro("Escolha um documento de até 20 MB.");
      return;
    }
    if (
      alterado &&
      !window.confirm("Há alterações não salvas. Deseja abrir outro documento?")
    )
      return;
    operacao.current ??= crypto.randomUUID();
    const form = new FormData();
    form.set("arquivo", f);
    form.set("operacaoId", operacao.current);
    void executar(
      () =>
        fetch(api, {
          method: "POST",
          headers: { "x-unidade-id": unidadeId },
          body: form,
        }),
      "Leitura disponível para conferência. Você pode salvar mesmo com campos pendentes.",
    );
  }

  function salvar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rascunho) return;
    let dados;
    try {
      dados = Object.fromEntries([
        ...[...cabecalho, ...totais].map(([k]) => [
          k,
          valorDoCampo(k, valores[k] ?? ""),
        ]),
        [
          "itens",
          Array.from({ length: linhas }, (_, n) =>
            Object.fromEntries(
              produto.map(([k]) => [
                k,
                valorDoCampo(k, valores[`itens.${n}.${k}`] ?? ""),
              ]),
            ),
          ),
        ],
      ]);
    } catch (e) {
      setErro((e as Error).message);
      return;
    }
    void executar(
      () =>
        fetch(api, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-unidade-id": unidadeId,
          },
          body: JSON.stringify({
            id: rascunho.id,
            revisao: rascunho.revisao,
            unidadeId,
            dados,
          }),
        }),
      "Rascunho salvo. Nenhuma compra ou lançamento foi registrado.",
    );
  }

  const iniciais = rascunho
    ? valoresDoRascunho(camposEditaveis(rascunho.dados))
    : {};
  function campo(k: string, rotulo: string, max: number) {
    const p = rascunho?.pendencias.find((p) => p.campo === k);
    const pendente = p && (valores[k] ?? "") === (iniciais[k] ?? "");
    return (
      <Campo
        key={k}
        rotulo={rotulo}
        name={k}
        value={valores[k] ?? ""}
        maxLength={max}
        inputMode={numeros.has(k.split(".").at(-1)!) ? "decimal" : undefined}
        type={k === "data_emissao" ? "date" : "text"}
        erro={pendente ? p.mensagem : undefined}
        placeholder="Não identificado"
        onChange={(e) => {
          setValores((v) => ({ ...v, [k]: e.target.value }));
          setAlterado(true);
          setMensagem("");
        }}
        className="min-h-11"
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <Link
          href="/assistente/equipe/notas"
          className="text-accent inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Voltar às notas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Conferir documento fiscal
        </h1>
        <p className="text-ink-3 mt-2">
          {unidade}. Envie o documento, confira os dados e salve o rascunho.
        </p>
        <p className="text-ink-2 mt-2 text-sm">
          Esta etapa não registra compras, não movimenta estoque e não cria
          lançamentos financeiros.
        </p>
      </header>
      <form
        onSubmit={enviar}
        className="border-line bg-surface rounded-xl border p-5"
      >
        <label htmlFor="documento-fiscal" className="block font-semibold">
          Foto, PDF ou XML
        </label>
        <p id="ajuda-arquivo-fiscal" className="text-ink-3 mt-1 text-sm">
          Um documento por arquivo, até 20 MB. Nas fotos, enquadre o cupom
          inteiro.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={arquivo}
            id="documento-fiscal"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,.xml"
            aria-describedby="ajuda-arquivo-fiscal"
            disabled={ocupado}
            className="min-h-11 max-w-full min-w-0 flex-1 text-sm"
            onChange={() => {
              operacao.current = null;
            }}
          />
          <Botao
            type="submit"
            peso={rascunho ? "secundario" : "primario"}
            carregando={ocupado}
            className="min-h-11"
          >
            Ler documento
          </Botao>
        </div>
        {ocupado && (
          <p role="status" className="text-ink-3 mt-3 text-sm">
            Aguarde a conclusão. Os dados serão apresentados para você conferir.
          </p>
        )}
      </form>
      {erro && (
        <p role="alert" className="text-bad bg-bad-sub rounded-md p-3">
          {erro}
        </p>
      )}
      {mensagem && (
        <p
          role="status"
          className="text-ink-2 border-line rounded-md border p-3"
        >
          {mensagem}
        </p>
      )}
      {rascunho && (
        <form onSubmit={salvar} className="space-y-6">
          <fieldset
            disabled={ocupado}
            className="space-y-6 disabled:opacity-60"
          >
            <section aria-labelledby="dados-documento">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="dados-documento" className="text-lg font-semibold">
                  Dados do documento
                </h2>
                {rascunho.arquivoId && (
                  <a
                    href={`/api/arquivos/${rascunho.arquivoId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent inline-flex min-h-11 items-center text-sm underline"
                  >
                    Abrir original
                  </a>
                )}
              </div>
              <p className="text-ink-3 mb-4 text-sm">
                Campos destacados precisam de conferência. Deixe vazio o que não
                conseguir identificar.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {cabecalho.map(([k, r, m]) => campo(k, r, m))}
              </div>
            </section>
            <section
              aria-labelledby="produtos-documento"
              className="border-line space-y-4 border-t pt-5"
            >
              <h2 id="produtos-documento" className="text-lg font-semibold">
                Produtos ({linhas})
              </h2>
              {!linhas && (
                <p className="text-bad">
                  Nenhum produto identificado. Adicione os itens que conseguir
                  conferir no documento.
                </p>
              )}
              {Array.from({ length: linhas }, (_, n) => (
                <fieldset
                  key={n}
                  className="border-line bg-surface rounded-lg border p-4"
                >
                  <legend className="px-1 font-semibold">Item {n + 1}</legend>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {produto.map(([k, r, m]) => campo(`itens.${n}.${k}`, r, m))}
                  </div>
                </fieldset>
              ))}
              <div className="flex flex-wrap gap-3">
                <Botao
                  type="button"
                  peso="secundario"
                  disabled={linhas >= 100}
                  className="min-h-11"
                  onClick={() => {
                    setLinhas((n) => n + 1);
                    setAlterado(true);
                  }}
                >
                  Adicionar produto
                </Botao>
                {!!linhas && (
                  <Botao
                    type="button"
                    peso="fantasma"
                    className="min-h-11"
                    onClick={() => {
                      setValores((v) =>
                        Object.fromEntries(
                          Object.entries(v).filter(
                            ([k]) => !k.startsWith(`itens.${linhas - 1}.`),
                          ),
                        ),
                      );
                      setLinhas((n) => n - 1);
                      setAlterado(true);
                    }}
                  >
                    Remover último produto
                  </Botao>
                )}
              </div>
            </section>
            <section
              aria-labelledby="totais-documento"
              className="border-line border-t pt-5"
            >
              <h2 id="totais-documento" className="mb-4 text-lg font-semibold">
                Valores e ajustes
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {totais.map(([k, r, m]) => campo(k, r, m))}
              </div>
            </section>
            {!!rascunho.avisos.length && (
              <section
                aria-labelledby="avisos-documento"
                className="bg-warn-sub rounded-lg p-4"
              >
                <h2 id="avisos-documento" className="font-semibold">
                  Observações da leitura
                </h2>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                  {rascunho.avisos.map((a, n) => (
                    <li key={n}>{a}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="border-line flex flex-wrap items-center gap-3 border-t pt-5">
              <Botao type="submit" className="min-h-11">
                Salvar rascunho
              </Botao>
              <p className="text-ink-3 text-sm">
                {alterado
                  ? "Há alterações não salvas."
                  : "Você pode continuar editando, mesmo com pendências."}
              </p>
            </div>
          </fieldset>
        </form>
      )}
      {!!recentes.length && (
        <section
          aria-labelledby="rascunhos-recentes"
          className="border-line border-t pt-5"
        >
          <h2 id="rascunhos-recentes" className="text-lg font-semibold">
            Seus rascunhos recentes
          </h2>
          <ul className="divide-line mt-2 divide-y">
            {recentes.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={ocupado}
                  className="text-accent min-h-11 w-full py-3 text-left underline underline-offset-4 disabled:opacity-50"
                  onClick={() => {
                    if (
                      alterado &&
                      !window.confirm(
                        "Há alterações não salvas. Deseja abrir outro rascunho?",
                      )
                    )
                      return;
                    void executar(
                      () =>
                        fetch(`${api}?id=${encodeURIComponent(r.id)}`, {
                          headers: { "x-unidade-id": unidadeId },
                          cache: "no-store",
                        }),
                      "Rascunho aberto para edição.",
                    );
                  }}
                >
                  {r.fornecedor}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
