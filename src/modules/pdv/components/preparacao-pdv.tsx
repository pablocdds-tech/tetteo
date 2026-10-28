"use client";

import {
  LinkIntegrado as Link,
  useAmbienteProprio,
} from "@/core/shell/link-integrado";
import { useState } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";

import type { PreparacaoPdv, ProdutoPreparacao } from "../preparacao-types";
import comum from "./secoes-pdv.module.css";

type Filtro = "TODOS" | "BLOQUEIO" | "ESTOQUE" | "AVISO" | "APTOS";
type Permissao = { nome: string; concedida: boolean };
const filtros: { valor: Filtro; nome: string }[] = [
  { valor: "TODOS", nome: "Todos os produtos" },
  { valor: "BLOQUEIO", nome: "Com impedimento de cadastro" },
  { valor: "ESTOQUE", nome: "Com alerta de estoque" },
  { valor: "AVISO", nome: "Com aviso para revisão" },
  { valor: "APTOS", nome: "Sem impedimento de cadastro" },
];
const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quantidade = (valor: number) =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function PreparacaoPdv({
  dados,
  permissoes,
}: {
  dados: PreparacaoPdv;
  permissoes: Permissao[];
}) {
  const proprio = useAmbienteProprio();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const produtos = dados.produtos.filter((produto) => {
    const corresponde = `${produto.nome} ${produto.categoria} ${produto.codigo}`
      .toLocaleLowerCase("pt-BR")
      .includes(termo);
    return (
      corresponde &&
      (filtro === "TODOS" ||
        (filtro === "APTOS"
          ? produto.pronto
          : produto.pendencias.some((pendencia) => pendencia.nivel === filtro)))
    );
  });

  return (
    <div className={comum.pagina}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={proprio ? "sr-only" : comum.titulo}>
            Preparação do PDV
          </h1>
          <p className="text-ink-3 mt-1 max-w-2xl text-sm">
            Confira o cadastro e os pontos que precisam de atenção antes de
            vender em {dados.unidadeNome}.
          </p>
        </div>
        <Link href="/pdv" className={estiloDeBotao("secundario")}>
          Ir para o PDV
        </Link>
      </header>

      <section
        className="border-line bg-surface rounded border"
        aria-labelledby="preparacao-verificacoes"
      >
        <h2
          id="preparacao-verificacoes"
          className="border-line border-b px-5 py-4 font-semibold"
        >
          Verificações da operação
        </h2>
        <div className="divide-line divide-y">
          {dados.etapas.map((etapa) => (
            <div
              key={etapa.id}
              className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 px-5 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
            >
              <span
                className={`${etapa.status === "OK" ? "bg-ok-sub text-ok" : etapa.status === "PENDENTE" ? "bg-bad-sub text-bad" : "bg-warn-sub text-warn"} mt-0.5 grid size-8 shrink-0 place-items-center rounded-full`}
              >
                <Icone
                  nome={etapa.status === "OK" ? "check" : "alerta"}
                  tamanho={17}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold">{etapa.titulo}</h3>
                  <span
                    className={`text-xs font-medium ${etapa.status === "OK" ? "text-ok" : etapa.status === "PENDENTE" ? "text-bad" : "text-warn"}`}
                  >
                    {etapa.status === "OK"
                      ? "Verificado"
                      : etapa.status === "PENDENTE"
                        ? "Pendente"
                        : "Revisar"}
                  </span>
                </div>
                <p className="text-ink-3 mt-1 max-w-2xl text-sm leading-5">
                  {etapa.descricao}
                </p>
              </div>
              <Link
                href={etapa.href}
                className={`${estiloDeBotao("fantasma", "pequeno")} col-start-2 justify-self-start sm:col-start-auto`}
              >
                {etapa.acao}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section
        className="border-line bg-surface rounded border p-5"
        aria-labelledby="preparacao-local"
      >
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-xl">
            <h2 id="preparacao-local" className="font-semibold">
              Estoque usado na verificação
            </h2>
            <p className="text-ink-3 mt-1 text-sm leading-5">
              Confira o saldo no local que abastece o caixa. A verificação
              considera uma unidade da receita base; os complementos escolhidos
              podem aumentar o consumo.
            </p>
          </div>
          {dados.locais.length > 0 ? (
            <form
              action="/pdv/preparacao"
              method="get"
              className="flex min-w-0 flex-wrap items-end gap-2"
            >
              <label className="text-ink-2 flex min-w-44 flex-1 flex-col gap-1.5 text-sm font-semibold">
                Local de estoque
                <select
                  name="local"
                  defaultValue={dados.localId ?? ""}
                  className="border-line-2 bg-surface text-ink h-10 max-w-full rounded-md border px-3 font-normal"
                >
                  {dados.locais.map((local) => (
                    <option value={local.id} key={local.id}>
                      {local.nome}
                    </option>
                  ))}
                </select>
              </label>
              <Botao type="submit" peso="secundario">
                Verificar local
              </Botao>
            </form>
          ) : (
            <Link href="/estoque" className={estiloDeBotao("secundario")}>
              Configurar estoque
            </Link>
          )}
        </div>
        <p className="text-ink-3 mt-4 text-sm">
          {dados.localNome ? (
            <>
              Local selecionado:{" "}
              <strong className="text-ink">{dados.localNome}</strong>.{" "}
            </>
          ) : (
            "Nenhum local disponível para consultar os saldos. "
          )}
          O diagnóstico não reserva estoque nem garante disponibilidade de todas
          as combinações. Os saldos são conferidos novamente na venda.
        </p>
      </section>

      <section aria-labelledby="preparacao-catalogo" className="space-y-4">
        <div>
          <h2 id="preparacao-catalogo" className="text-lg font-semibold">
            Catálogo e receitas
          </h2>
          <p className="text-ink-3 mt-1 text-sm">
            Expanda um produto para ver as pendências e o consumo da receita
            base.
          </p>
        </div>
        <dl className="border-line bg-surface grid grid-cols-2 gap-x-6 gap-y-4 rounded border px-5 py-4 sm:grid-cols-4">
          <Contador
            rotulo="Produtos verificados"
            valor={dados.contadores.produtos}
          />
          <Contador
            rotulo="Com impedimento"
            valor={dados.contadores.bloqueados}
          />
          <Contador
            rotulo="Com alerta de estoque"
            valor={dados.contadores.alertasEstoque}
          />
          <Contador
            rotulo="Sem impedimento de cadastro"
            valor={dados.contadores.prontos}
          />
        </dl>
        {dados.produtos.length === 0 ? (
          <div className="border-line bg-surface rounded border px-5 py-10 text-center">
            <h3 className="font-semibold">Comece pelo cadastro dos produtos</h3>
            <p className="text-ink-3 mx-auto mt-2 max-w-lg text-sm">
              Crie uma ficha técnica do tipo prato com nome, preço de venda e
              ingredientes. Depois configure os códigos e complementos no
              catálogo do PDV.
            </p>
            <Link
              href="/cardapio/fichas"
              className={`${estiloDeBotao("secundario")} mt-5`}
            >
              Abrir fichas técnicas
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-48 flex-1">
                <Campo
                  rotulo="Buscar produto, categoria ou código"
                  type="search"
                  value={busca}
                  onChange={(evento) => setBusca(evento.target.value)}
                  placeholder="Ex.: pizza grande"
                />
              </div>
              <label className="text-ink-2 flex min-w-48 flex-col gap-1.5 text-sm font-semibold">
                Mostrar
                <select
                  value={filtro}
                  onChange={(evento) =>
                    setFiltro(evento.target.value as Filtro)
                  }
                  className="border-line-2 bg-surface text-ink h-10 rounded-md border px-3 font-normal"
                >
                  {filtros.map((opcao) => (
                    <option value={opcao.valor} key={opcao.valor}>
                      {opcao.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p role="status" className="text-ink-3 text-sm">
              {produtos.length}{" "}
              {produtos.length === 1
                ? "produto neste filtro"
                : "produtos neste filtro"}
            </p>
            <div className="border-line bg-surface divide-line divide-y overflow-hidden rounded border">
              {produtos.length > 0 ? (
                produtos.map((produto) => (
                  <ProdutoVerificado
                    key={produto.id}
                    produto={produto}
                    localNome={dados.localNome}
                  />
                ))
              ) : (
                <p className="text-ink-3 px-5 py-8 text-center text-sm">
                  Nenhum produto corresponde à busca e ao filtro. Tente outro
                  nome ou selecione todos os produtos.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section
        className="border-line bg-surface rounded border p-5"
        aria-labelledby="preparacao-permissoes"
      >
        <h2 id="preparacao-permissoes" className="font-semibold">
          Permissões do seu acesso
        </h2>
        <p className="text-ink-3 mt-1 text-sm">
          As operações disponíveis dependem do seu papel nesta unidade.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {permissoes.map((permissao) => (
            <li key={permissao.nome} className="flex items-start gap-2 text-sm">
              <span className={permissao.concedida ? "text-ok" : "text-ink-3"}>
                <Icone
                  nome={permissao.concedida ? "check" : "alerta"}
                  tamanho={17}
                />
              </span>
              <span>
                {permissao.nome}
                <span className="text-ink-3 mt-0.5 block text-xs">
                  {permissao.concedida ? "Permitido" : "Sem permissão"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Contador({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <dt className="text-ink-3 text-sm">{rotulo}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

function ProdutoVerificado({
  produto,
  localNome,
}: {
  produto: ProdutoPreparacao;
  localNome: string | null;
}) {
  const bloqueado = produto.pendencias.some(
    (pendencia) => pendencia.nivel === "BLOQUEIO",
  );
  const alerta = produto.pendencias.some(
    (pendencia) => pendencia.nivel === "ESTOQUE",
  );
  return (
    <details className="group">
      <summary className="hover:bg-surface-2 focus-visible:outline-accent grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:grid-cols-[1rem_minmax(0,1fr)_auto_auto] [&::-webkit-details-marker]:hidden">
        <Icone
          nome="seta-direita"
          tamanho={16}
          className="text-ink-3 shrink-0 transition-transform group-open:rotate-90"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{produto.nome}</h3>
          <p className="text-ink-3 mt-1 text-sm">
            {produto.categoria || "Sem categoria"}
            {produto.codigo ? ` · Código ${produto.codigo}` : ""}
            {!produto.ativo ? " · Inativo" : ""}
          </p>
        </div>
        <span
          className={`${bloqueado ? "bg-bad-sub text-bad" : alerta ? "bg-warn-sub text-warn" : "bg-ok-sub text-ok"} col-start-2 row-start-2 justify-self-start rounded-full px-2.5 py-1 text-xs font-medium sm:col-start-auto sm:row-start-auto`}
        >
          {bloqueado
            ? "Cadastro pendente"
            : alerta
              ? "Revisar estoque"
              : "Cadastro apto"}
        </span>
        <span className="col-start-3 row-start-1 min-w-24 text-right text-sm font-semibold tabular-nums sm:col-start-auto sm:row-start-auto">
          {produto.precoCentavos === null
            ? "Sem preço"
            : moeda(produto.precoCentavos)}
        </span>
      </summary>
      <div className="border-line space-y-5 border-t px-5 py-5 sm:pl-12">
        {produto.pendencias.length > 0 ? (
          <ul className="space-y-3">
            {produto.pendencias.map((pendencia, indice) => (
              <li
                key={`${pendencia.codigo}-${indice}`}
                className="flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-xs font-semibold ${pendencia.nivel === "BLOQUEIO" ? "text-bad" : pendencia.nivel === "ESTOQUE" ? "text-warn" : "text-ink-3"}`}
                  >
                    {pendencia.nivel === "BLOQUEIO"
                      ? "Impede a venda"
                      : pendencia.nivel === "ESTOQUE"
                        ? "Estoque"
                        : "Revisão do cadastro"}
                  </span>
                  <p className="text-ink-2 mt-1 text-sm leading-5">
                    {pendencia.mensagem}
                  </p>
                </div>
                <Link
                  href={pendencia.href}
                  className="text-accent rounded-sm text-sm font-medium underline underline-offset-2"
                >
                  {pendencia.acao}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ok text-sm">
            Nenhum impedimento de cadastro identificado nesta verificação.
          </p>
        )}
        {produto.estoque.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold">
              Ingredientes da receita e dos complementos vinculados
            </h4>
            <p className="text-ink-3 mt-1 text-xs">
              {localNome
                ? `Saldo consultado em ${localNome}.`
                : "Selecione um local para consultar o saldo."}{" "}
              Não inclui todas as combinações de complementos.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-80 text-left text-sm">
                <thead className="text-ink-3 border-line border-b">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Ingrediente
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right font-medium"
                    >
                      Consumo base
                    </th>
                    <th
                      scope="col"
                      className="py-2 pl-3 text-right font-medium"
                    >
                      Saldo no local
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {produto.estoque.map((item) => (
                    <tr key={item.insumoId}>
                      <th scope="row" className="py-2 pr-3 font-normal">
                        {item.nome}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.necessarioBase === 0
                          ? "Depende da escolha"
                          : `${quantidade(item.necessarioBase)} ${item.unidade}`}
                      </td>
                      <td
                        className={`py-2 pl-3 text-right tabular-nums ${item.disponivel !== null && item.disponivel < item.necessarioBase ? "text-warn" : "text-ink-2"}`}
                      >
                        {item.disponivel === null
                          ? "Não consultado"
                          : `${quantidade(item.disponivel)} ${item.unidade}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
