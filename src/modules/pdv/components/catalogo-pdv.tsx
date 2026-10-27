"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { lerNumeroBr } from "@/lib/numero";

import { salvarComplementosAcao } from "../acoes";
import type { GrupoComplemento, ProdutoPdv } from "../types";

const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
type GrupoEdicao = Omit<GrupoComplemento, "opcoes"> & {
  opcoes: { id: string; nome: string; preco: string; fichaId?: string }[];
};

export function CatalogoPdv({
  produtos,
  podeConfigurar,
}: {
  produtos: ProdutoPdv[];
  podeConfigurar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<ProdutoPdv | null>(null);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtrados = produtos.filter((produto) =>
    `${produto.nome} ${produto.categoria} ${produto.codigo}`
      .toLocaleLowerCase("pt-BR")
      .includes(termo),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Catálogo do PDV
          </h1>
          <p className="text-ink-3 mt-1 max-w-2xl text-sm">
            Produtos das fichas técnicas, com os mesmos nomes e preços.
            Configure aqui os códigos e as escolhas que o operador oferece na
            venda.
          </p>
        </div>
        <Link href="/cardapio/fichas" className={estiloDeBotao("secundario")}>
          Gerenciar produtos
        </Link>
      </header>
      <div className="max-w-lg">
        <Campo
          rotulo="Buscar produto, categoria ou código"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Ex.: Pizza grande"
          type="search"
        />
      </div>
      <section className="border-line bg-surface overflow-hidden rounded-xl border">
        <div className="border-line flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">Produtos disponíveis</h2>
          <span className="text-ink-3 text-sm">
            {filtrados.length} {filtrados.length === 1 ? "produto" : "produtos"}
          </span>
        </div>
        {filtrados.length ? (
          <div className="divide-line divide-y">
            {filtrados.map((produto) => (
              <div
                key={produto.id}
                className="flex flex-wrap items-center gap-3 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{produto.nome}</p>
                  <p className="text-ink-3 mt-1 text-sm">
                    {produto.categoria}
                    {produto.codigo
                      ? ` · Código ${produto.codigo}`
                      : " · Sem código"}
                  </p>
                  <p className="text-ink-3 mt-1 text-sm">
                    {produto.grupos.length
                      ? `${produto.grupos.length} ${produto.grupos.length === 1 ? "grupo de complementos" : "grupos de complementos"}`
                      : "Produto simples"}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">
                  {moeda(produto.precoCentavos)}
                </span>
                {podeConfigurar && (
                  <Botao
                    peso="secundario"
                    tamanho="pequeno"
                    onClick={() => setSelecionado(produto)}
                  >
                    Configurar
                  </Botao>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center">
            <h3 className="font-semibold">
              {busca
                ? "Nenhum produto encontrado"
                : "Seu catálogo começa nas fichas técnicas"}
            </h3>
            <p className="text-ink-3 mx-auto mt-2 max-w-md text-sm">
              {busca
                ? "Tente outro nome, categoria ou código."
                : "Cadastre uma ficha do tipo prato, ative-a e informe o preço de venda para disponibilizá-la no PDV."}
            </p>
          </div>
        )}
      </section>
      {selecionado && (
        <EditorProduto
          key={selecionado.id}
          produto={selecionado}
          produtos={produtos}
          aoFechar={() => setSelecionado(null)}
        />
      )}
    </div>
  );
}

function EditorProduto({
  produto,
  produtos,
  aoFechar,
}: {
  produto: ProdutoPdv;
  produtos: ProdutoPdv[];
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState(produto.codigo);
  const [grupos, setGrupos] = useState<GrupoEdicao[]>(() =>
    produto.grupos.map((grupo) => ({
      ...grupo,
      opcoes: grupo.opcoes.map((opcao) => ({
        id: opcao.id,
        nome: opcao.nome,
        fichaId: opcao.fichaId,
        preco: (opcao.precoCentavos / 100).toFixed(2).replace(".", ","),
      })),
    })),
  );
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();

  function alterar(id: string, dados: Partial<GrupoEdicao>) {
    setGrupos((atuais) =>
      atuais.map((grupo) => (grupo.id === id ? { ...grupo, ...dados } : grupo)),
    );
  }

  function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (pendente) return;
    const preparados: GrupoComplemento[] = [];
    for (const grupo of grupos) {
      if (
        !grupo.nome.trim() ||
        !Number.isInteger(grupo.minimo) ||
        !Number.isInteger(grupo.maximo) ||
        grupo.minimo < 0 ||
        grupo.maximo < 1 ||
        grupo.maximo < grupo.minimo ||
        grupo.maximo > grupo.opcoes.length
      ) {
        setErro(
          "Revise o nome e os limites de cada grupo. O máximo não pode superar a quantidade de opções.",
        );
        return;
      }
      const opcoes = [];
      for (const opcao of grupo.opcoes) {
        const valor = lerNumeroBr(opcao.preco);
        const centavos =
          typeof valor === "number" ? Math.round(valor * 100) : NaN;
        if (
          !opcao.nome.trim() ||
          typeof valor !== "number" ||
          !Number.isSafeInteger(centavos) ||
          centavos < 0 ||
          Math.abs(valor * 100 - centavos) > 0.00001
        ) {
          setErro(
            "Informe o nome e um preço válido com até duas casas decimais em todas as opções.",
          );
          return;
        }
        opcoes.push({
          id: opcao.id,
          nome: opcao.nome.trim(),
          precoCentavos: centavos,
          ...(opcao.fichaId ? { fichaId: opcao.fichaId } : {}),
        });
      }
      preparados.push({ ...grupo, nome: grupo.nome.trim(), opcoes });
    }
    setErro("");
    iniciar(async () => {
      try {
        const resultado = await salvarComplementosAcao({
          produtoId: produto.id,
          codigo: codigo.trim(),
          grupos: preparados,
        });
        if (resultado.erro) setErro(resultado.erro);
        else {
          router.refresh();
          aoFechar();
        }
      } catch {
        setErro("Não foi possível salvar a configuração. Tente novamente.");
      }
    });
  }

  return (
    <PainelLateral
      aberto
      aoFechar={aoFechar}
      podeFechar={() => !pendente}
      titulo={produto.nome}
      apoio="Código e complementos do produto no PDV"
      rodape={
        <>
          <Botao peso="secundario" onClick={aoFechar} disabled={pendente}>
            Voltar
          </Botao>
          <Botao
            type="submit"
            form="configurar-produto-pdv"
            carregando={pendente}
          >
            Salvar configuração
          </Botao>
        </>
      }
    >
      <form id="configurar-produto-pdv" onSubmit={salvar} className="space-y-6">
        <div className="border-line flex items-center justify-between gap-3 border-b pb-4">
          <span className="text-ink-3 text-sm">
            Preço base:{" "}
            <strong className="text-ink">{moeda(produto.precoCentavos)}</strong>
          </span>
          <Link
            href={`/cardapio/fichas/${produto.id}`}
            className="text-accent text-sm underline"
          >
            Editar ficha e preço
          </Link>
        </div>
        <Campo
          rotulo="Código de busca ou código de barras"
          value={codigo}
          onChange={(evento) => setCodigo(evento.target.value)}
          maxLength={80}
          ajuda="Use um código único para localizar o produto rapidamente no caixa."
          disabled={pendente}
        />
        <div>
          <h3 className="font-semibold">Grupos de complementos</h3>
          <p className="text-ink-3 mt-1 text-sm">
            Ex.: bordas, sabores, adicionais ou itens de um combo.
          </p>
        </div>
        {grupos.map((grupo, indice) => (
          <fieldset
            key={grupo.id}
            className="border-line bg-surface-2 space-y-4 rounded-lg border p-4"
            disabled={pendente}
          >
            <legend className="px-1 text-sm font-semibold">
              Grupo {indice + 1}
            </legend>
            <Campo
              rotulo="Nome do grupo"
              value={grupo.nome}
              onChange={(evento) =>
                alterar(grupo.id, { nome: evento.target.value })
              }
              required
              maxLength={100}
              placeholder="Ex.: Escolha os sabores"
            />
            <div className="grid grid-cols-2 gap-3">
              <Campo
                rotulo="Mínimo de escolhas"
                type="number"
                min={0}
                max={100}
                step={1}
                required
                value={Number.isNaN(grupo.minimo) ? "" : grupo.minimo}
                onChange={(evento) =>
                  alterar(grupo.id, {
                    minimo:
                      evento.target.value === ""
                        ? NaN
                        : Number(evento.target.value),
                  })
                }
              />
              <Campo
                rotulo="Máximo de escolhas"
                type="number"
                min={1}
                max={100}
                step={1}
                required
                value={Number.isNaN(grupo.maximo) ? "" : grupo.maximo}
                onChange={(evento) =>
                  alterar(grupo.id, {
                    maximo:
                      evento.target.value === ""
                        ? NaN
                        : Number(evento.target.value),
                  })
                }
              />
            </div>
            <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
              Como calcular o preço
              <select
                value={grupo.calculo}
                onChange={(evento) =>
                  alterar(grupo.id, {
                    calculo: evento.target.value as GrupoComplemento["calculo"],
                  })
                }
                className="border-line-2 bg-surface text-ink h-10 rounded-md border px-3 font-normal"
              >
                <option value="SOMA">Somar os preços das opções</option>
                <option value="MEDIA">Usar a média das opções</option>
              </select>
              <span className="text-ink-3 font-normal">
                {grupo.calculo === "MEDIA"
                  ? "A média dos sabores é adicionada ao preço base. Para uma pizza precificada pelos sabores, use preço base zero."
                  : "Cada opção escolhida é adicionada ao preço base do produto."}
              </span>
            </label>
            <div className="space-y-4">
              {grupo.opcoes.map((opcao, numero) => (
                <div
                  key={opcao.id}
                  className="border-line space-y-2 border-t pt-3"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                    <Campo
                      rotulo={`Opção ${numero + 1}`}
                      value={opcao.nome}
                      onChange={(evento) =>
                        alterar(grupo.id, {
                          opcoes: grupo.opcoes.map((item) =>
                            item.id === opcao.id
                              ? { ...item, nome: evento.target.value }
                              : item,
                          ),
                        })
                      }
                      required
                      maxLength={120}
                    />
                    <Campo
                      rotulo="Preço (R$)"
                      value={opcao.preco}
                      onChange={(evento) =>
                        alterar(grupo.id, {
                          opcoes: grupo.opcoes.map((item) =>
                            item.id === opcao.id
                              ? { ...item, preco: evento.target.value }
                              : item,
                          ),
                        })
                      }
                      required
                      inputMode="decimal"
                    />
                  </div>
                  <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
                    Receita para baixar estoque
                    <select
                      value={opcao.fichaId ?? ""}
                      onChange={(evento) =>
                        alterar(grupo.id, {
                          opcoes: grupo.opcoes.map((item) =>
                            item.id === opcao.id
                              ? {
                                  ...item,
                                  fichaId: evento.target.value || undefined,
                                }
                              : item,
                          ),
                        })
                      }
                      className="bg-surface border-line-2 text-ink h-10 rounded-md border px-3 font-normal"
                    >
                      <option value="">Sem receita vinculada</option>
                      {produtos
                        .filter((item) => item.id !== produto.id)
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.nome}
                          </option>
                        ))}
                    </select>
                    <span className="text-ink-3 font-normal">
                      Sem vínculo, a opção só altera o preço. Na média de
                      sabores, o consumo da receita vinculada é dividido entre
                      as escolhas.
                    </span>
                  </label>
                  <Botao
                    type="button"
                    peso="fantasma"
                    tamanho="pequeno"
                    onClick={() =>
                      alterar(grupo.id, {
                        opcoes: grupo.opcoes.filter(
                          (item) => item.id !== opcao.id,
                        ),
                      })
                    }
                  >
                    Remover opção {numero + 1}
                  </Botao>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Botao
                type="button"
                peso="secundario"
                tamanho="pequeno"
                onClick={() =>
                  alterar(grupo.id, {
                    opcoes: [
                      ...grupo.opcoes,
                      { id: crypto.randomUUID(), nome: "", preco: "0,00" },
                    ],
                  })
                }
              >
                Adicionar opção
              </Botao>
              <Botao
                type="button"
                peso="fantasma"
                tamanho="pequeno"
                onClick={() =>
                  setGrupos((atuais) =>
                    atuais.filter((item) => item.id !== grupo.id),
                  )
                }
              >
                Remover grupo
              </Botao>
            </div>
          </fieldset>
        ))}
        <Botao
          type="button"
          peso="secundario"
          disabled={pendente}
          onClick={() =>
            setGrupos((atuais) => [
              ...atuais,
              {
                id: crypto.randomUUID(),
                nome: "",
                minimo: 0,
                maximo: 1,
                calculo: "SOMA",
                opcoes: [{ id: crypto.randomUUID(), nome: "", preco: "0,00" }],
              },
            ])
          }
        >
          Adicionar grupo de complementos
        </Botao>
        {erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-lg px-3 py-2 text-sm"
          >
            {erro}
          </p>
        )}
      </form>
    </PainelLateral>
  );
}
