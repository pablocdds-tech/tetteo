"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Botao, estiloDeBotao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { finalizarVendaAcao } from "../acoes";
import { CarrinhosSalvos } from "./carrinhos-salvos";
import { DadosEntrega } from "./dados-entrega";
import { horarioSaoPaulo, DadosAgendamento } from "./dados-agendamento";
import type { AgendamentoEntrada } from "../agendamento-types";
import {
  converterDataLocalSaoPaulo,
  converterAgendamento,
} from "../schemas/agendamento";
import { ClienteAtendimento } from "./cliente-atendimento";
import type {
  ClienteAtendimentoPdv,
  EnderecoClientePdv,
  SeedEntregaCliente,
} from "../cliente-types";
import type { EntregaEntrada } from "../entrega-types";
import { conferirAreaEntrega, esquemaEntregaEntrada } from "../schemas/entrega";
import type { ResumoCarrinho, RetomadaCarrinho } from "../carrinho-types";
import { calcularPrecoItem } from "../schemas/venda";
import styles from "./novo-pedido.module.css";
import type {
  DadosPdv,
  FinalizarEntrada,
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
  unidadeId,
  podeVerClientes,
  podeEditarClientes,
  podeVender,
  podeDesconto,
  podeConfigurar,
  carrinhos,
}: {
  dados: DadosPdv;
  unidade: string;
  unidadeId: string;
  podeVerClientes: boolean;
  podeEditarClientes: boolean;
  podeVender: boolean;
  podeDesconto: boolean;
  podeConfigurar: boolean;
  carrinhos: ResumoCarrinho[];
}) {
  const router = useRouter();
  const buscaRef = useRef<HTMLInputElement>(null);
  const checkoutRef = useRef<HTMLDialogElement>(null);
  const trava = useRef(false);
  const chaveVenda = useRef<string | null>(null);
  const tentativaVenda = useRef<FinalizarEntrada | null>(null);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [itens, setItens] = useState<Linha[]>([]);
  const [produto, setProduto] = useState<ProdutoPdv | null>(null);
  const [cliente, setCliente] = useState("");
  const [clienteSelecionado, setClienteSelecionado] =
    useState<ClienteAtendimentoPdv | null>(null);
  const [seedEntrega, setSeedEntrega] = useState<SeedEntregaCliente | null>(
    null,
  );
  const [modalidade, setModalidade] = useState<
    "RETIRADA" | "BALCAO" | "ENTREGA"
  >("RETIRADA");
  const [entrega, setEntrega] = useState<EntregaEntrada | null>(null);
  const [entregaConferida, setEntregaConferida] = useState(false);
  const [editarEntrega, setEditarEntrega] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [agendamento, setAgendamento] = useState<AgendamentoEntrada | null>(
    null,
  );
  const [editarAgendamento, setEditarAgendamento] = useState(false);
  const [pagamento, setPagamento] = useState(false);
  const [confirmarPendente, setConfirmarPendente] = useState(false);
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
  const [valorCongelado, setValorCongelado] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [rascunho, setRascunho] = useState<{
    id: string;
    versao: number;
    nome: string;
  } | null>(null);
  const [catalogoRetomado, setCatalogoRetomado] = useState<ProdutoPdv[] | null>(
    null,
  );
  const catalogo = catalogoRetomado ?? dados.produtos;
  const categorias = [...new Set(catalogo.map((p) => p.categoria))];
  const filtro = busca.toLocaleLowerCase("pt-BR");
  const produtos = catalogo.filter(
    (p) =>
      (!categoria || p.categoria === categoria) &&
      `${p.nome} ${p.codigo}`.toLocaleLowerCase("pt-BR").includes(filtro),
  );
  const produtosPorId = new Map(catalogo.map((p) => [p.id, p]));
  const cotacoes = new Map<string, { preco: number; erro: string }>(
    itens.map((item) => {
      const p = produtosPorId.get(item.produtoId);
      try {
        if (!p) throw new Error("Produto indisponível no catálogo atual.");
        return [
          item.chave,
          { preco: calcularPrecoItem(p, item.opcoes), erro: "" },
        ] as const;
      } catch {
        return [
          item.chave,
          {
            preco: 0,
            erro: "Este produto ou suas opções mudaram. Remova o item e escolha novamente.",
          },
        ] as const;
      }
    }),
  );
  const temItensInvalidos = [...cotacoes.values()].some((c) => c.erro);
  const subtotal = itens.reduce(
    (soma, item) =>
      soma + (cotacoes.get(item.chave)?.preco ?? 0) * item.quantidade,
    0,
  );
  const descontoCentavos = centavos(desconto);
  const taxaCentavos = centavos(taxa);
  const areasEntrega = dados.areasEntrega ?? [];
  let erroEntrega = "";
  if (modalidade === "ENTREGA") {
    const validacao = esquemaEntregaEntrada.safeParse(entrega);
    if (!entregaConferida || !validacao.success)
      erroEntrega =
        "Confirme o destinatário, o endereço, o frete e o prazo antes de pagar.";
    else if (validacao.data.areaId) {
      const area = areasEntrega.find(
        (item) => item.id === validacao.data.areaId,
      );
      if (!area)
        erroEntrega =
          "A área de entrega não está disponível. Atualize as áreas e confira o frete.";
      else
        try {
          conferirAreaEntrega(area, validacao.data);
        } catch (falha) {
          erroEntrega =
            falha instanceof Error
              ? falha.message
              : "Confira a área de entrega.";
        }
    }
  }
  const freteCentavos =
    modalidade === "ENTREGA" ? (entrega?.freteCentavos ?? 0) : 0;
  const totalAtual = subtotal - descontoCentavos + taxaCentavos + freteCentavos;
  const total =
    incerta && valorCongelado !== null ? valorCongelado : totalAtual;
  const pago = pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0);
  const troco = Math.max(0, pago - total);
  let erroAgendamento = "";
  if (agendamento)
    try {
      converterAgendamento(agendamento);
    } catch {
      erroAgendamento =
        "O horário agendado precisa ser ajustado. Escolha uma nova data ou Para agora.";
    }
  const podeAbrirPagamento =
    itens.length > 0 &&
    !!dados.caixa &&
    podeVender &&
    online &&
    !ocupado &&
    !incerta &&
    !temItensInvalidos &&
    !erroEntrega &&
    !erroAgendamento;

  useEffect(() => {
    const dialogo = checkoutRef.current;
    if (!dialogo) return;
    if (!dialogo.open) dialogo.showModal();
    buscaRef.current?.focus();
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
      if (dialogo.open) dialogo.close();
    };
  }, []);

  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine);
    const atalhos = (e: KeyboardEvent) => {
      if (
        !e.ctrlKey ||
        [...document.querySelectorAll("dialog[open]")].some(
          (dialogo) => dialogo !== checkoutRef.current,
        )
      )
        return;
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
      if (itens.length || entrega || agendamento) e.preventDefault();
    };
    const protegerLink = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey ||
        !(e.target instanceof Element)
      )
        return;
      const link = e.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const destino = new URL(link.href, window.location.href);
      if (
        destino.pathname === location.pathname &&
        destino.search === location.search
      )
        return;
      if (
        ocupado ||
        incerta ||
        ((itens.length > 0 || entrega || agendamento) &&
          !window.confirm(
            "Há itens, dados de entrega ou horário neste atendimento. Salve para retomar depois. Sair sem guardar as alterações?",
          ))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", protegerLink, true);
    window.addEventListener("beforeunload", proteger);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
      window.removeEventListener("keydown", atalhos);
      window.removeEventListener("beforeunload", proteger);
      document.removeEventListener("click", protegerLink, true);
    };
  }, [
    podeAbrirPagamento,
    itens.length,
    ocupado,
    incerta,
    entrega,
    agendamento,
  ]);

  function limparAtendimento() {
    setConfirmarPendente(false);
    setItens([]);
    setPagamentos([]);
    setCliente("");
    setClienteSelecionado(null);
    setSeedEntrega(null);
    setObservacao("");
    setAgendamento(null);
    setEditarAgendamento(false);
    setDesconto("0");
    setTaxa("0");
    setValor("");
    setModalidade("RETIRADA");
    setEntrega(null);
    setEntregaConferida(false);
    setEditarEntrega(false);
    setRascunho(null);
    setCatalogoRetomado(null);
    setCategoria(null);
    setBusca("");
    setErro("");
    chaveVenda.current = null;
    tentativaVenda.current = null;
    setValorCongelado(null);
  }
  function retomarAtendimento(retomada: RetomadaCarrinho) {
    const { carrinho: salvo } = retomada;
    limparAtendimento();
    setCatalogoRetomado(retomada.produtos);
    setRascunho({ id: salvo.id, versao: salvo.versao, nome: salvo.nome });
    setItens(
      salvo.conteudo.itens.map((item) => ({
        ...item,
        chave: crypto.randomUUID(),
      })),
    );
    setCliente(salvo.conteudo.clienteId ?? "");
    setModalidade(salvo.conteudo.modalidade);
    if (salvo.conteudo.entrega) {
      const salva = salvo.conteudo.entrega;
      const area = areasEntrega.find(
        (item) => item.id === salva.areaId && item.ativa,
      );
      setEntrega({
        ...salva,
        ...(area
          ? {
              areaId: area.id,
              versaoArea: area.versao,
              freteCentavos: area.freteCentavos,
              prazoMinutos: area.prazoMinutos,
            }
          : { freteCentavos: 0, prazoMinutos: 30 }),
        motivoFreteManual: "",
      });
      setEntregaConferida(false);
    }
    setObservacao(salvo.conteudo.observacao);
    setAgendamento(salvo.conteudo.agendamento ?? null);
    setAviso(
      [
        `Atendimento “${salvo.nome}” retomado com os preços atuais.`,
        ...retomada.avisos,
      ].join(" "),
    );
  }

  function abrirEntrega() {
    if (ocupado || incerta) return;
    if (!entrega && clienteSelecionado)
      setSeedEntrega({
        destinatario: clienteSelecionado.nome,
        telefone: clienteSelecionado.telefone ?? "",
      });
    setEditarEntrega(true);
  }
  function selecionarCliente(escolhido: ClienteAtendimentoPdv | null) {
    if (ocupado || incerta) return;
    setCliente(escolhido?.id ?? "");
    setClienteSelecionado(escolhido);
    setSeedEntrega(null);
    if (entrega) {
      const substituir = window.confirm(
        "Substituir os dados da entrega pelos dados do cliente escolhido? Confirme para revisar destinatário e endereço. Cancelar mantém explicitamente a entrega atual.",
      );
      if (substituir) {
        setSeedEntrega({
          destinatario: escolhido?.nome ?? "",
          telefone: escolhido?.telefone ?? "",
        });
        if (modalidade === "ENTREGA") setEditarEntrega(true);
      }
    }
  }
  function escolherEnderecoCliente(
    escolhido: ClienteAtendimentoPdv,
    endereco: EnderecoClientePdv,
  ) {
    if (ocupado || incerta) return;
    if (
      entrega &&
      !window.confirm(
        "Usar este endereço no pedido? A entrega atual só será substituída após confirmar os dados e o frete.",
      )
    )
      return;
    setSeedEntrega({
      destinatario: escolhido.nome,
      telefone: escolhido.telefone ?? "",
      endereco: structuredClone(endereco.endereco),
    });
    setEditarEntrega(true);
  }

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
  async function finalizar(pagamentoPendente = false) {
    if (
      !incerta &&
      pagamentoPendente &&
      (pagamentos.length > 0 || valor.trim())
    ) {
      setErro(
        "Remova os pagamentos e limpe o valor digitado antes de cobrar depois.",
      );
      return;
    }
    if (
      trava.current ||
      (!dados.caixa && !tentativaVenda.current) ||
      (!incerta && (temItensInvalidos || !!erroEntrega || !!erroAgendamento))
    )
      return;
    if (!navigator.onLine) {
      setErro(
        "Sem conexão. O carrinho continua nesta tela; tente novamente quando a internet voltar.",
      );
      return;
    }
    if (
      !incerta &&
      (!Number.isSafeInteger(total) || total < 0 || descontoCentavos > subtotal)
    ) {
      setErro("Revise o desconto e a taxa adicional.");
      return;
    }
    trava.current = true;
    setOcupado(true);
    setErro("");
    chaveVenda.current ??= crypto.randomUUID();
    try {
      tentativaVenda.current ??= {
        chave: chaveVenda.current,
        caixaId: dados.caixa!.id,
        ...(rascunho
          ? { carrinhoId: rascunho.id, versaoCarrinho: rascunho.versao }
          : {}),
        clienteId: cliente || undefined,
        modalidade,
        ...(modalidade === "ENTREGA" && entrega ? { entrega } : {}),
        observacao,
        ...(agendamento ? { agendamento } : {}),
        itens: itens.map(({ produtoId, quantidade, opcoes, observacao }) => ({
          produtoId,
          quantidade,
          opcoes,
          observacao,
        })),
        descontoCentavos,
        taxaCentavos,
        pagamentos: pagamentoPendente ? [] : pagamentos,
        pagamentoPendente,
      };
      setValorCongelado(total);
      const resultado = await finalizarVendaAcao(tentativaVenda.current);
      if (resultado.erro) {
        setErro(resultado.erro);
        // Rejeição após resposta incerta não prova que a primeira venda falhou.
        if (!incerta) {
          chaveVenda.current = null;
          tentativaVenda.current = null;
          setValorCongelado(null);
        }
        return;
      }
      setAviso(
        `${resultado.ok ?? "Venda concluída."}${resultado.vendaId ? ` Identificação: ${resultado.vendaId.slice(-8).toUpperCase()}.` : ""}`,
      );
      setItens([]);
      setRascunho(null);
      setCatalogoRetomado(null);
      setPagamentos([]);
      setCliente("");
      setClienteSelecionado(null);
      setSeedEntrega(null);
      setObservacao("");
      setAgendamento(null);
      setEditarAgendamento(false);
      setEntrega(null);
      setEntregaConferida(false);
      setEditarEntrega(false);
      setDesconto("0");
      setTaxa("0");
      setPagamento(false);
      setConfirmarPendente(false);
      setIncerta(false);
      chaveVenda.current = null;
      tentativaVenda.current = null;
      setValorCongelado(null);
      router.push(
        agendamento
          ? "/pdv/agendamentos"
          : resultado.vendaId
            ? `/pdv?novaVenda=${encodeURIComponent(resultado.vendaId)}`
            : "/pdv",
      );
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
    <dialog
      ref={checkoutRef}
      aria-labelledby="novo-pedido-titulo"
      className={styles.checkout}
      onCancel={(evento) => {
        if (evento.target !== evento.currentTarget) return;
        evento.preventDefault();
        if (ocupado || incerta) return;
        if (
          (!itens.length && !entrega && !agendamento) ||
          window.confirm(
            "Há itens, dados de entrega ou horário neste atendimento. Salve para retomar depois. Sair sem guardar as alterações?",
          )
        )
          router.push("/pdv");
      }}
    >
      <header className={styles.topo}>
        <div>
          <h1
            id="novo-pedido-titulo"
            className="text-lg font-semibold tracking-tight"
          >
            Novo pedido
          </h1>
          <p className="text-ink-3 text-xs">
            {unidade} ·{" "}
            {dados.caixa
              ? `Caixa aberto por ${dados.caixa.operador}`
              : "Caixa fechado"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {podeConfigurar && (
            <Link href="/pdv/preparacao" className={estiloDeBotao("fantasma")}>
              Preparar operação
            </Link>
          )}
          <Link href="/pdv/caixa" className={estiloDeBotao("secundario")}>
            Gerenciar caixa
          </Link>
          <Link href="/pdv" className={styles.voltar}>
            <span>Voltar à gestão</span>
            <Icone nome="fechar" tamanho={18} />
          </Link>
        </div>
      </header>
      <div className={styles.atendimentos}>
        <CarrinhosSalvos
          carrinhos={carrinhos}
          conteudo={{
            clienteId: cliente || undefined,
            modalidade,
            ...(modalidade === "ENTREGA" && entrega
              ? {
                  entrega: {
                    destinatario: entrega.destinatario,
                    telefone: entrega.telefone,
                    endereco: entrega.endereco,
                    ...(entrega.areaId ? { areaId: entrega.areaId } : {}),
                  },
                }
              : {}),
            observacao,
            ...(agendamento ? { agendamento } : {}),
            itens: itens.map(
              ({ produtoId, quantidade, opcoes, observacao }) => ({
                produtoId,
                quantidade,
                opcoes,
                observacao,
              }),
            ),
          }}
          atual={rascunho}
          bloqueado={ocupado || incerta}
          podeVender={podeVender}
          temPagamentos={pagamentos.length > 0}
          online={online}
          aoSalvar={() => {
            limparAtendimento();
            setAviso("Atendimento salvo. Você já pode iniciar outra venda.");
          }}
          aoRetomar={retomarAtendimento}
          aoBloquear={setOcupado}
        />
      </div>
      {rascunho && (
        <p className="text-ink-2 text-sm">
          Atendimento em edição: <strong>{rascunho.nome}</strong>. Salve
          novamente antes de sair para guardar as alterações.
        </p>
      )}
      {temItensInvalidos && (
        <p
          role="alert"
          className="bg-warn-sub text-warn rounded-lg p-3 text-sm"
        >
          O catálogo mudou. Os itens foram preservados; revise os marcados antes
          de pagar.
        </p>
      )}
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
      <div className={styles.workspace}>
        <nav aria-label="Categorias de produtos" className={styles.categorias}>
          <h2 className={styles.tituloCategorias}>Categorias</h2>
          {[null, ...categorias].map((c) => (
            <button
              key={c ?? "todas"}
              type="button"
              aria-pressed={categoria === c}
              onClick={() => setCategoria(c)}
              className={`${styles.categoria} ${categoria === c ? styles.categoriaAtiva : ""}`}
            >
              {c ?? "Todos os produtos"}
              <span className="ml-2 text-xs" aria-hidden="true">
                {" "}
                {c
                  ? catalogo.filter((p) => p.categoria === c).length
                  : catalogo.length}
              </span>
            </button>
          ))}
        </nav>
        <section className={styles.catalogo} aria-label="Produtos disponíveis">
          <div className={styles.busca}>
            <Icone nome="lupa" tamanho={20} />
            <label htmlFor="pdv-busca" className="sr-only">
              Buscar produto{" "}
              <span className="text-ink-3 font-normal">Ctrl + B</span>
            </label>
            <input
              id="pdv-busca"
              ref={buscaRef}
              className={styles.campoBusca}
              placeholder="Encontre produtos por nome ou código PDV (Ctrl + B)"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const exato = catalogo.find(
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
            <div className={styles.produtos}>
              {produtos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={incerta || ocupado}
                  onClick={() => abrirProduto(p)}
                  className={styles.produto}
                >
                  <span className={styles.miniatura}>
                    <Icone nome="prato" tamanho={30} />
                  </span>
                  <span className={styles.produtoTexto}>
                    <span className={styles.produtoNome}>{p.nome}</span>
                    <span className="text-ink-2 text-sm">
                      {p.grupos.length ? "A partir de " : ""}
                      {moeda(precoMinimo(p))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-ink-3 m-auto max-w-sm px-6 py-16 text-center">
              <Icone nome="prato" tamanho={36} className="mx-auto mb-4" />
              <h2 className="text-ink font-semibold">
                {catalogo.length
                  ? "Nenhum produto encontrado"
                  : "Prepare seu catálogo"}
              </h2>
              <p className="mt-2 text-sm">
                {catalogo.length
                  ? "Busque por outro nome ou código."
                  : "Cadastre produtos como pratos nas fichas técnicas, com preço de venda e receita para a baixa de estoque."}
              </p>
              {!catalogo.length && (
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
        <aside className={styles.pedido}>
          <div
            className={`${styles.dadosPedido} ${modalidade === "ENTREGA" ? "min-[900px]:max-h-[35dvh] min-[900px]:overflow-y-auto" : ""}`}
          >
            <h2 className="sr-only">Dados do pedido</h2>
            {podeVerClientes && (
              <ClienteAtendimento
                unidadeId={unidadeId}
                clienteId={cliente}
                podeEditar={podeEditarClientes}
                bloqueado={incerta || ocupado}
                mostrarEnderecos={modalidade === "ENTREGA"}
                aoCarregar={setClienteSelecionado}
                aoSelecionar={selecionarCliente}
                aoEscolherEndereco={escolherEnderecoCliente}
              />
            )}
            <label className={styles.seletor}>
              <span className="sr-only">Atendimento</span>
              <Icone
                nome={modalidade === "ENTREGA" ? "entrega" : "pessoas"}
                tamanho={18}
              />
              <select
                aria-label="Atendimento"
                className={styles.campoSeletor}
                value={modalidade}
                disabled={incerta || ocupado}
                onChange={(e) => {
                  const escolhida = e.target.value as typeof modalidade;
                  setModalidade(escolhida);
                  setPagamentos([]);
                  if (escolhida === "ENTREGA" && !entregaConferida)
                    abrirEntrega();
                }}
              >
                <option value="RETIRADA">Retirada</option>
                <option value="BALCAO">Balcão</option>
                <option value="ENTREGA">Entrega</option>
              </select>
            </label>
            {modalidade === "ENTREGA" && (
              <>
                <button
                  type="button"
                  className={`${styles.seletor} py-2 text-left`}
                  disabled={ocupado || incerta}
                  onClick={abrirEntrega}
                >
                  <Icone nome="entrega" tamanho={18} />
                  <span className="min-w-0 flex-1">
                    Endereço e entrega
                    <small className="text-ink-3 mt-1 block text-xs">
                      {entrega
                        ? `${entrega.endereco.logradouro}, ${entrega.endereco.numero} · ${entrega.endereco.bairro}`
                        : "Informar destinatário e endereço"}
                    </small>
                  </span>
                  <Icone nome="seta-direita" tamanho={16} />
                </button>
                {erroEntrega && (
                  <p className="text-warn text-xs">{erroEntrega}</p>
                )}
              </>
            )}
            <button
              type="button"
              className={`${styles.agora} text-left`}
              disabled={ocupado || incerta}
              onClick={() => setEditarAgendamento(true)}
            >
              <Icone nome="relogio" tamanho={18} />
              <span>
                {agendamento
                  ? `Agendado · ${horarioSaoPaulo(converterDataLocalSaoPaulo(agendamento.paraLocal))} (São Paulo)`
                  : "Pedido para agora"}
              </span>
              <Icone nome="seta-direita" tamanho={16} />
            </button>
            {erroAgendamento && (
              <p role="alert" className="text-warn text-xs">
                {erroAgendamento}
              </p>
            )}
            <details className={styles.observacao}>
              <summary>
                <Icone nome="lista-conferida" tamanho={18} />
                <span>Observação do pedido</span>
                <Icone nome="seta-baixo" tamanho={16} />
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
          <div className={styles.tituloCarrinho}>
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
                    setRascunho(null);
                  }
                }}
              >
                Limpar
              </button>
            )}
          </div>
          <div className={styles.itens}>
            {!itens.length && (
              <div className={styles.carrinhoVazio}>
                <Icone nome="caixa" tamanho={72} />
                <p>Carrinho vazio</p>
              </div>
            )}
            {itens.map((item) => {
              const p = produtosPorId.get(item.produtoId);
              const cotacao = cotacoes.get(item.chave)!;
              const preco = cotacao.preco;
              const nome = p?.nome ?? "Produto indisponível";
              return (
                <article className={styles.item} key={item.chave}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold">{nome}</h4>
                    <button
                      type="button"
                      aria-label={`Remover ${nome}`}
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
                  {p?.grupos.flatMap((g) =>
                    g.opcoes
                      .filter((o) => item.opcoes.includes(o.id))
                      .map((o) => (
                        <p key={o.id} className="text-ink-3 mt-1 text-xs">
                          {g.nome}: {o.nome}
                        </p>
                      )),
                  )}
                  {cotacao.erro && (
                    <p className="text-warn mt-2 text-xs">{cotacao.erro}</p>
                  )}
                  {item.observacao && (
                    <p className="text-ink-3 mt-1 text-xs">{item.observacao}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="border-line-2 bg-surface flex items-center rounded border">
                      <button
                        type="button"
                        aria-label={`Diminuir ${nome}`}
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
                        aria-label={`Aumentar ${nome}`}
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
                      {cotacao.erro
                        ? "Revisar item"
                        : moeda(preco * item.quantidade)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          <footer className={styles.rodape}>
            <div className="flex justify-between text-sm">
              <span className="text-ink-3">Subtotal</span>
              <strong className="tabular-nums">{moeda(subtotal)}</strong>
            </div>
            {modalidade === "ENTREGA" && (
              <div className="flex justify-between text-sm">
                <span className="text-ink-3">Frete de entrega</span>
                <strong className="tabular-nums">
                  {entregaConferida ? moeda(freteCentavos) : "Conferir"}
                </strong>
              </div>
            )}
            <Botao
              className={styles.pagar}
              disabled={!podeAbrirPagamento}
              onClick={() => {
                setErro("");
                setPagamento(true);
              }}
            >
              <span>
                Pagar <span className="ml-1 text-xs font-normal">Ctrl + P</span>
              </span>
              <span>
                {Number.isFinite(total) ? moeda(total) : "Revisar valores"}
              </span>
            </Botao>
          </footer>
        </aside>
      </div>
      {editarAgendamento && (
        <DadosAgendamento
          agendamento={agendamento}
          bloqueado={ocupado || incerta}
          aoFechar={() => setEditarAgendamento(false)}
          aoConfirmar={(valor) => {
            setAgendamento(valor);
            setEditarAgendamento(false);
          }}
        />
      )}
      {editarEntrega && (
        <DadosEntrega
          entrega={entrega}
          seedEntrega={seedEntrega ?? undefined}
          unidadeId={unidadeId}
          cliente={podeVerClientes ? clienteSelecionado : null}
          podeEditarClientes={podeEditarClientes}
          areas={areasEntrega}
          bloqueado={ocupado || incerta}
          aoFechar={() => {
            setEditarEntrega(false);
            setSeedEntrega(null);
          }}
          aoConfirmar={(confirmada) => {
            setEntrega(confirmada);
            setSeedEntrega(null);
            setEntregaConferida(true);
            setPagamentos([]);
            setEditarEntrega(false);
            setErro("");
          }}
        />
      )}
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
          if (!ocupado && !incerta) {
            setPagamento(false);
            setConfirmarPendente(false);
          }
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
              (!incerta &&
                (temItensInvalidos ||
                  !!erroEntrega ||
                  !!erroAgendamento ||
                  (!confirmarPendente &&
                    (pago < total || !pagamentos.length)) ||
                  (confirmarPendente &&
                    (pagamentos.length > 0 || !!valor.trim())) ||
                  !Number.isSafeInteger(total) ||
                  total < 0 ||
                  descontoCentavos > subtotal))
            }
            onClick={() => void finalizar(confirmarPendente)}
          >
            {incerta
              ? "Confirmar novamente"
              : confirmarPendente
                ? "Confirmar envio sem pagamento"
                : "Concluir venda"}{" "}
            · {Number.isFinite(total) ? moeda(total) : "Revise os valores"}
          </Botao>
        }
      >
        <div className="space-y-5">
          <dl className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{moeda(subtotal)}</dd>
          </dl>
          {modalidade === "ENTREGA" && (
            <dl className="flex justify-between text-sm">
              <dt>Frete de entrega</dt>
              <dd className="tabular-nums">{moeda(freteCentavos)}</dd>
            </dl>
          )}
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
              ajuda={
                modalidade === "ENTREGA"
                  ? "O frete já está na linha de entrega acima."
                  : undefined
              }
              disabled={ocupado || incerta || pagamentos.length > 0}
              onChange={(e) => setTaxa(e.target.value)}
            />
          </div>
          <div className="border-line flex justify-between border-y py-4 text-lg font-semibold">
            <span>Total</span>
            <span>{Number.isFinite(total) ? moeda(total) : "—"}</span>
          </div>
          <fieldset disabled={ocupado || incerta || confirmarPendente}>
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
          <section className="border-line space-y-3 border-t pt-4">
            {confirmarPendente ? (
              <>
                <p
                  role="status"
                  className="bg-warn-sub text-ink rounded-md p-3 text-sm"
                >
                  Estoque será baixado agora; nenhum pagamento será registrado.
                  O pedido ficará aguardando pagamento.
                </p>
                <Botao
                  peso="secundario"
                  disabled={ocupado || incerta}
                  onClick={() => setConfirmarPendente(false)}
                >
                  Voltar ao pagamento
                </Botao>
              </>
            ) : (
              <>
                <Botao
                  peso="secundario"
                  className="w-full"
                  disabled={
                    ocupado ||
                    incerta ||
                    pagamentos.length > 0 ||
                    !!valor.trim()
                  }
                  onClick={() => {
                    setConfirmarPendente(true);
                    setErro("");
                  }}
                >
                  Enviar à cozinha e cobrar depois
                </Botao>
                {(pagamentos.length > 0 || !!valor.trim()) && (
                  <p className="text-ink-3 text-xs">
                    Para cobrar depois, remova os pagamentos adicionados e limpe
                    o valor digitado.
                  </p>
                )}
              </>
            )}
          </section>
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
    </dialog>
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
