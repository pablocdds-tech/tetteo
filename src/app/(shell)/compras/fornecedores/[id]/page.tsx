import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { sigla, type Unidade } from "@/lib/unidades";
import {
  configurarDestinoAcao,
  removerProdutoAcao,
  salvarProdutoAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { dia, dinheiro } from "@/modules/compras/components/formato";
import { FormularioFornecedor } from "@/modules/compras/components/formulario-fornecedor";
import { Voltar } from "@/modules/compras/components/voltar";
import {
  CASAS,
  fatorDoBanco,
  numeroBrDe,
} from "@/modules/compras/schemas/aritmetica";
import { descreverEmbalagem } from "@/modules/compras/schemas/embalagem";
import { obterFornecedor } from "@/modules/compras/services/fornecedores";
import {
  insumosParaCompra,
  listarProdutosDoFornecedor,
} from "@/modules/compras/services/produtos-do-fornecedor";

/**
 * O FORNECEDOR — cadastro, para onde vai a mensagem, e o que ele vende.
 *
 * "O que ele vende" é o que faz a rodada saber a quem pedir cotação de cada
 * insumo, e em que embalagem (a caixa de 12 × 900 g vira 10,8 kg pela
 * dimensão; sem o peso da peça, o sistema diz "conferir" em vez de chutar).
 * É também aqui que se marca o FIXO: um por insumo, garantido pelo banco.
 */

type Produto = Awaited<ReturnType<typeof listarProdutosDoFornecedor>>[number];

const UNIDADES: Unidade[] = ["KG", "G", "L", "ML", "UN"];

const CAIXA =
  "bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent h-10 w-full min-w-0 rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm";
const ROTULO = "text-ink-2 text-sm font-semibold";

export default async function PaginaFornecedor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const { id } = await params;
  const { editar } = await searchParams;
  const novo = id === "novo";
  const podeEditar = pode(ctx, "compras.fornecedores");
  if (novo && !podeEditar) notFound();

  const fornecedor = novo ? null : await obterFornecedor(ctx, id);
  if (!novo && !fornecedor) notFound();

  if (!fornecedor) {
    return (
      <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
        <Voltar para="/compras/fornecedores" rotulo="Fornecedores" />
        <CabecalhoDePagina
          titulo="Novo fornecedor"
          contexto="Vale para a rede inteira"
        />
        <Cartao className="p-5">
          <FormularioFornecedor />
        </Cartao>
      </div>
    );
  }

  const produtos = await listarProdutosDoFornecedor(ctx, fornecedor.id);
  const insumos = podeEditar ? await insumosParaCompra(ctx) : [];
  const editando = produtos.find((p) => p.id === editar) ?? null;

  const colunas: Coluna<Produto>[] = [
    {
      chave: "insumo",
      titulo: "Insumo",
      principal: true,
      celula: (p) => p.insumo,
    },
    {
      chave: "embalagem",
      titulo: "Embalagem",
      celula: (p) => (
        <span>
          {p.fracionavel && p.pecas === 1 && !p.conteudo
            ? "A granel"
            : p.nomeEmbalagem}
          <span className="text-ink-3 block text-xs">
            {descreverEmbalagem(
              {
                pecas: p.pecas,
                conteudo: p.conteudo === null ? null : fatorDoBanco(p.conteudo),
                unidadeConteudo: p.unidadeConteudo as Unidade | null,
                fracionavel: p.fracionavel,
              },
              p.unidade as Unidade,
            )}
          </span>
        </span>
      ),
    },
    {
      chave: "conversao",
      titulo: "Conversão",
      celula: (p) =>
        p.fator ? (
          <span className="tabular-nums">
            1 = {numeroBrDe(fatorDoBanco(p.fator), CASAS.dezMilesimos)}{" "}
            {sigla(p.unidade)}
            {p.fatorVersao > 1 && (
              <span className="text-ink-3 block text-xs">
                versão {p.fatorVersao}
              </span>
            )}
          </span>
        ) : (
          <span className="flex flex-col items-start gap-1">
            <Etiqueta tom="aviso">Conferir</Etiqueta>
            <span className="text-ink-3 text-xs">{p.fatorOrigem}</span>
          </span>
        ),
    },
    {
      chave: "fixo",
      titulo: "Fixo",
      celula: (p) =>
        p.fixo ? (
          <Etiqueta tom="info">Fornecedor fixo</Etiqueta>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      chave: "referencia",
      titulo: "Preço de referência",
      numerica: true,
      celula: (p) =>
        p.precoReferencia ? (
          <span>
            {dinheiro(p.precoReferencia)}
            <span className="text-ink-3 block text-xs">
              {[
                p.precoReferenciaOrigem,
                p.precoReferenciaEm ? dia(p.precoReferenciaEm) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        ) : (
          "—"
        ),
    },
    ...(podeEditar
      ? [
          {
            chave: "acao",
            titulo: "O que fazer",
            celula: (p: Produto) => (
              <div className="flex flex-wrap items-start gap-2">
                <Link
                  href={`/compras/fornecedores/${fornecedor.id}?editar=${p.id}#produto`}
                  className="text-accent inline-flex min-h-8 items-center text-sm font-semibold hover:underline"
                >
                  Editar
                </Link>
                <Acao
                  acao={removerProdutoAcao}
                  campos={{ id: p.id, fornecedorId: fornecedor.id }}
                  rotulo="Tirar"
                  peso="fantasma"
                  tamanho="pequeno"
                  confirmar={`Tirar ${p.insumo} dos produtos de ${fornecedor.nome}? Ele deixa de ser convidado a cotar este item.`}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <Voltar para="/compras/fornecedores" rotulo="Fornecedores" />
      <CabecalhoDePagina
        titulo={fornecedor.nome}
        contexto={`${fornecedor.ativo ? "Ativo" : "Desativado"} · vale para a rede inteira`}
      />

      <div className="desk:grid-cols-[minmax(0,1fr)_400px] grid items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Cartao como="section" className="min-w-0 overflow-hidden">
            <TituloDeSecao apoio="Quem vende cada insumo é convidado a cotá-lo. O fixo sai da disputa.">
              O que ele vende
            </TituloDeSecao>
            <Tabela
              legenda={`Produtos de ${fornecedor.nome}`}
              colunas={colunas}
              linhas={produtos}
              chaveDaLinha={(p) => p.id}
              vazio={
                <Vazio
                  icone="caixa"
                  titulo="Nenhum produto cadastrado"
                  explicacao="Sem produtos, ele não é convidado a cotar nada — a rodada não sabe o que pedir a ele. Cadastre ao lado o que ele vende."
                />
              }
            />
          </Cartao>

          {podeEditar && (
            <Cartao como="section" className="min-w-0">
              <TituloDeSecao
                id="produto"
                apoio="Diga a embalagem em partes: quantas peças e o conteúdo de cada uma."
              >
                {editando ? `Editar ${editando.insumo}` : "Cadastrar produto"}
              </TituloDeSecao>
              <div className="p-4">
                <Acao
                  key={editando?.id ?? "novo"}
                  acao={salvarProdutoAcao}
                  campos={
                    editando
                      ? { fornecedorId: fornecedor.id, id: editando.id }
                      : { fornecedorId: fornecedor.id }
                  }
                  rotulo={editando ? "Salvar produto" : "Cadastrar produto"}
                  peso="secundario"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label htmlFor="produto-insumo" className={ROTULO}>
                        Insumo
                      </label>
                      <select
                        id="produto-insumo"
                        name="insumoId"
                        required
                        defaultValue={editando?.insumoId ?? ""}
                        className={CAIXA}
                      >
                        <option value="" disabled>
                          Escolha o insumo
                        </option>
                        {insumos.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome} ({sigla(i.unidadeMedida)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="produto-embalagem" className={ROTULO}>
                        Nome da embalagem
                      </label>
                      <input
                        id="produto-embalagem"
                        name="nomeEmbalagem"
                        defaultValue={editando?.nomeEmbalagem ?? ""}
                        placeholder="Caixa, fardo, saco…"
                        maxLength={40}
                        className={CAIXA}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="produto-pecas" className={ROTULO}>
                        Peças por embalagem
                      </label>
                      <input
                        id="produto-pecas"
                        name="pecas"
                        defaultValue={editando?.pecas ?? 1}
                        inputMode="numeric"
                        maxLength={6}
                        className={CAIXA}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="produto-conteudo" className={ROTULO}>
                        Conteúdo de cada peça
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="produto-conteudo"
                          name="conteudo"
                          defaultValue={
                            editando?.conteudo?.replace(".", ",") ?? ""
                          }
                          placeholder="900"
                          inputMode="decimal"
                          maxLength={14}
                          className={CAIXA}
                        />
                        <select
                          name="unidadeConteudo"
                          aria-label="Unidade do conteúdo"
                          defaultValue={editando?.unidadeConteudo ?? "G"}
                          className="bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent h-10 w-20 flex-none rounded-md border px-2 text-base focus:outline-none md:text-sm"
                        >
                          {UNIDADES.map((u) => (
                            <option key={u} value={u}>
                              {sigla(u)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="produto-preco" className={ROTULO}>
                        Preço de referência (R$) — opcional
                      </label>
                      <input
                        id="produto-preco"
                        name="precoReferencia"
                        defaultValue={
                          editando?.precoReferencia?.replace(".", ",") ?? ""
                        }
                        inputMode="decimal"
                        maxLength={20}
                        className={CAIXA}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label htmlFor="produto-origem" className={ROTULO}>
                        De onde vem esse preço
                      </label>
                      <input
                        id="produto-origem"
                        name="precoReferenciaOrigem"
                        defaultValue={editando?.precoReferenciaOrigem ?? ""}
                        placeholder="Ex.: tabela de 02/09, último pedido"
                        maxLength={120}
                        className={CAIXA}
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-sm leading-5">
                    <input
                      type="checkbox"
                      name="fracionavel"
                      defaultChecked={editando?.fracionavel ?? false}
                      className="mt-0.5 size-4"
                    />
                    Vende a granel (por kg, litro ou unidade) — sem embalagem
                    fechada
                  </label>
                  <label className="flex items-start gap-2 text-sm leading-5">
                    <input
                      type="checkbox"
                      name="fixo"
                      defaultChecked={editando?.fixo ?? false}
                      className="mt-0.5 size-4"
                    />
                    <span>
                      É o fornecedor fixo deste insumo
                      <span className="text-ink-3 block text-xs">
                        O item vai direto para ele na rodada, sem disputa. Tirar
                        da disputa depois exige motivo.
                      </span>
                    </span>
                  </label>
                </Acao>
                {editando && (
                  <Link
                    href={`/compras/fornecedores/${fornecedor.id}`}
                    className="text-ink-3 hover:text-ink mt-2 inline-block text-sm"
                  >
                    Cancelar edição
                  </Link>
                )}
              </div>
            </Cartao>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Cartao como="section" className="flex flex-col gap-3 p-4">
            <h2 className="text-[15px] leading-6 font-semibold">
              Para onde vai o pedido
            </h2>
            <p className="text-ink-3 text-sm leading-5">
              A fila só manda mensagem para o telefone de pedidos AUTORIZADO.
              Sem ele, o comprador copia e manda pelo próprio WhatsApp. Mudar o
              número fica registrado com o antes e o depois.
            </p>
            <p className="text-sm">
              {fornecedor.telefonePedidos && fornecedor.autorizadoMensagens ? (
                <Etiqueta tom="ok">
                  Autorizado
                  {fornecedor.autorizadoEm
                    ? ` em ${dia(fornecedor.autorizadoEm)}`
                    : ""}
                </Etiqueta>
              ) : (
                <Etiqueta tom="aviso">Não recebe pela fila</Etiqueta>
              )}
            </p>
            {podeEditar ? (
              <Acao
                acao={configurarDestinoAcao}
                campos={{ fornecedorId: fornecedor.id }}
                rotulo="Salvar destino"
                peso="secundario"
              >
                <label htmlFor="destino-telefone" className={ROTULO}>
                  Telefone de pedidos (WhatsApp)
                </label>
                <input
                  id="destino-telefone"
                  name="telefonePedidos"
                  type="tel"
                  defaultValue={fornecedor.telefonePedidos ?? ""}
                  placeholder="(84) 99999-0000"
                  className={CAIXA}
                />
                <label className="flex items-start gap-2 text-sm leading-5">
                  <input
                    type="checkbox"
                    name="autorizado"
                    defaultChecked={fornecedor.autorizadoMensagens}
                    className="mt-0.5 size-4"
                  />
                  O fornecedor concordou em receber pedidos neste número
                </label>
              </Acao>
            ) : (
              <p className="text-ink-2 text-sm tabular-nums">
                {fornecedor.telefonePedidos ?? "Sem telefone de pedidos"}
              </p>
            )}
          </Cartao>

          <Cartao como="section" className="p-4">
            <h2 className="mb-3 text-[15px] leading-6 font-semibold">
              Cadastro
            </h2>
            {podeEditar ? (
              <FormularioFornecedor
                fornecedor={{
                  id: fornecedor.id,
                  nome: fornecedor.nome,
                  documento: fornecedor.documento,
                  telefone: fornecedor.telefone,
                  email: fornecedor.email,
                  contato: fornecedor.contato,
                  prazoEntregaDias: fornecedor.prazoEntregaDias,
                  condicaoPagamento: fornecedor.condicaoPagamento,
                  observacao: fornecedor.observacao,
                }}
              />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-3">Contato</dt>
                <dd>{fornecedor.contato ?? "—"}</dd>
                <dt className="text-ink-3">Telefone</dt>
                <dd className="tabular-nums">{fornecedor.telefone ?? "—"}</dd>
                <dt className="text-ink-3">Pagamento</dt>
                <dd>{fornecedor.condicaoPagamento ?? "—"}</dd>
                <dt className="text-ink-3">Entrega</dt>
                <dd>
                  {fornecedor.prazoEntregaDias !== null
                    ? `${fornecedor.prazoEntregaDias} dias`
                    : "—"}
                </dd>
              </dl>
            )}
          </Cartao>
        </div>
      </div>
    </div>
  );
}
