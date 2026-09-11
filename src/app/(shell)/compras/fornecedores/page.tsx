import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import { alternarFornecedorAcao } from "@/modules/compras/acoes";
import { listarFornecedores } from "@/modules/compras/services/fornecedores";

/**
 * Fornecedor é da REDE, não da loja — por isso esta tela funciona também com o
 * seletor em "Rede Completa". A distribuidora atende as duas casas, e
 * cadastrá-la duas vezes tornaria impossível comparar preço entre elas.
 *
 * A coluna que mais importa agora é a do DESTINO: só fornecedor com telefone
 * de pedidos autorizado recebe mensagem da fila. Os outros recebem pelo
 * WhatsApp de quem compra, copiando.
 */

type Fornecedor = Awaited<ReturnType<typeof listarFornecedores>>[number];

export default async function PaginaFornecedores() {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  if (!pode(ctx, "compras.ver")) notFound();

  const fornecedores = await listarFornecedores(ctx, true);
  const podeEditar = pode(ctx, "compras.fornecedores");

  const colunas: Coluna<Fornecedor>[] = [
    {
      chave: "nome",
      titulo: "Fornecedor",
      principal: true,
      larguraMin: "12rem",
      celula: (f) => (
        <Link
          href={`/compras/fornecedores/${f.id}`}
          className="hover:text-accent font-medium"
        >
          {f.nome}
          {!f.ativo && (
            <Etiqueta tom="neutro" className="ml-2">
              Desativado
            </Etiqueta>
          )}
          <span className="text-ink-3 block text-xs font-normal">
            {f.contato ?? "sem contato"}
          </span>
        </Link>
      ),
    },
    {
      chave: "destino",
      titulo: "Mensagens de pedido",
      celula: (f) =>
        f.telefonePedidos && f.autorizadoMensagens ? (
          <span className="flex flex-col items-start gap-1">
            <Etiqueta tom="ok">Autorizado</Etiqueta>
            <span className="text-ink-3 text-xs tabular-nums">
              {f.telefonePedidos}
            </span>
          </span>
        ) : f.telefonePedidos ? (
          <span className="flex flex-col items-start gap-1">
            <Etiqueta tom="aviso">Sem autorização</Etiqueta>
            <span className="text-ink-3 text-xs tabular-nums">
              {f.telefonePedidos}
            </span>
          </span>
        ) : (
          <Etiqueta tom="neutro">Sem telefone de pedidos</Etiqueta>
        ),
    },
    {
      chave: "condicoes",
      titulo: "Condições",
      celula: (f) =>
        [
          f.condicaoPagamento,
          f.prazoEntregaDias !== null
            ? `entrega em ${f.prazoEntregaDias} dias`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    {
      chave: "historico",
      titulo: "Histórico",
      celula: (f) => (
        <span className="text-xs tabular-nums">
          {f.cotacoes} {f.cotacoes === 1 ? "cotação" : "cotações"} · {f.pedidos}{" "}
          {f.pedidos === 1 ? "pedido" : "pedidos"} · {f.notas}{" "}
          {f.notas === 1 ? "nota" : "notas"}
        </span>
      ),
    },
    ...(podeEditar
      ? [
          {
            chave: "acao",
            titulo: "O que fazer",
            celula: (f: Fornecedor) => (
              <form action={alternarFornecedorAcao}>
                <input type="hidden" name="id" value={f.id} />
                <Botao peso="fantasma" tamanho="pequeno" type="submit">
                  {f.ativo ? "Desativar" : "Reativar"}
                </Botao>
              </form>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Fornecedores"
        contexto="De quem se compra, o que cada um vende e para onde vai o pedido · rede inteira"
        acao={
          podeEditar ? (
            <Link
              href="/compras/fornecedores/novo"
              className={estiloDeBotao("primario", "medio")}
            >
              Novo fornecedor
            </Link>
          ) : undefined
        }
      />
      <Cartao className="min-w-0 overflow-hidden">
        <TituloDeSecao
          apoio={`${fornecedores.filter((f) => f.ativo).length} ativos`}
        >
          Fornecedores
        </TituloDeSecao>
        <Tabela
          legenda="Fornecedores"
          colunas={colunas}
          linhas={fornecedores}
          chaveDaLinha={(f) => f.id}
          vazio={
            <Vazio
              icone="entrega"
              titulo="Nenhum fornecedor cadastrado"
              explicacao="Cadastre os que você já usa — inclusive o da feira. Um fornecedor fora do sistema é um preço que nunca entra na comparação."
              acao={
                podeEditar ? (
                  <Link
                    href="/compras/fornecedores/novo"
                    className={estiloDeBotao("primario", "pequeno")}
                  >
                    Novo fornecedor
                  </Link>
                ) : undefined
              }
            />
          }
        />
      </Cartao>
    </div>
  );
}
