"use client";

import { useEffect, useRef, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";
import { apiClientes, ErroClienteAtendimento } from "../cliente-api";
import type { ConsultaClienteAtendimento } from "../cliente-types";

import type {
  ClienteAtendimentoPdv as ClienteAtendimentoDTO,
  EnderecoClientePdv as EnderecoAtendimentoDTO,
  ListaClientesAtendimento as Busca,
} from "../cliente-types";
type Tentativa = {
  storeId: string;
  chaveUUID: string;
  nome: string;
  telefone: string;
};

export function ClienteAtendimento({
  unidadeId,
  clienteId,
  podeEditar,
  bloqueado,
  mostrarEnderecos,
  aoSelecionar,
  aoCarregar,
  aoEscolherEndereco,
}: {
  unidadeId: string;
  clienteId: string;
  podeEditar: boolean;
  bloqueado: boolean;
  mostrarEnderecos: boolean;
  aoSelecionar: (cliente: ClienteAtendimentoDTO | null) => void;
  aoCarregar: (cliente: ClienteAtendimentoDTO | null) => void;
  aoEscolherEndereco: (
    cliente: ClienteAtendimentoDTO,
    endereco: EnderecoAtendimentoDTO,
  ) => void;
}) {
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [resultadoBruto, setResultado] = useState<{
    chave: string;
    dados: Busca;
  } | null>(null);
  const [consultaConcluida, setConsultaConcluida] = useState("");
  const buscaChave = `${unidadeId}:${busca.trim()}:${pagina}`;
  const resultado =
    resultadoBruto?.chave === buscaChave ? resultadoBruto.dados : null;
  const buscando =
    !clienteId &&
    !bloqueado &&
    busca.trim().length >= 2 &&
    consultaConcluida !== buscaChave;
  const [cliente, setCliente] = useState<ClienteAtendimentoDTO | null>(null);
  const [enderecos, setEnderecos] = useState<EnderecoAtendimentoDTO[]>([]);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [erroCadastro, setErroCadastro] = useState("");
  const [duplicado, setDuplicado] = useState<ClienteAtendimentoDTO | null>(
    null,
  );
  const tentativa = useRef<Tentativa | null>(null);
  const consultaEndereco = useRef<AbortController | null>(null);
  const [conferindoEndereco, setConferindoEndereco] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      consultaEndereco.current?.abort();
    };
  }, []);
  useEffect(() => () => consultaEndereco.current?.abort(), [clienteId]);
  const trava = useRef(false);
  const callbacks = useRef({ aoCarregar });
  useEffect(() => {
    callbacks.current = { aoCarregar };
  }, [aoCarregar]);
  useEffect(() => {
    const controller = new AbortController();
    if (!clienteId) return;
    apiClientes<ConsultaClienteAtendimento>(
      unidadeId,
      `/${encodeURIComponent(clienteId)}`,
      { signal: controller.signal },
    )
      .then((dados) => {
        if (controller.signal.aborted) return;
        setErro("");
        setCliente(dados.cliente);
        setEnderecos(dados.enderecos);
        callbacks.current.aoCarregar(dados.cliente);
      })
      .catch((falha) => {
        if (!controller.signal.aborted)
          setErro(
            falha instanceof Error
              ? falha.message
              : "Falha ao consultar o cliente.",
          );
      });
    return () => controller.abort();
  }, [clienteId, unidadeId]);
  useEffect(() => {
    const controller = new AbortController();
    if (clienteId || busca.trim().length < 2 || bloqueado) return;
    const espera = setTimeout(() => {
      const params = new URLSearchParams({
        busca: busca.trim(),
        pagina: String(pagina),
      });
      apiClientes<Busca>(unidadeId, `?${params}`, { signal: controller.signal })
        .then((dados) => {
          if (!controller.signal.aborted) {
            setResultado({ chave: buscaChave, dados });
            setErro("");
          }
        })
        .catch((falha) => {
          if (!controller.signal.aborted)
            setErro(
              falha instanceof Error
                ? falha.message
                : "Falha ao buscar clientes.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setConsultaConcluida(buscaChave);
        });
    }, 300);
    return () => {
      clearTimeout(espera);
      controller.abort();
    };
  }, [busca, pagina, clienteId, unidadeId, bloqueado, buscaChave]);
  useEffect(() => {
    if (!incerta && !salvando) return;
    const proteger = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [incerta, salvando]);
  function escolher(escolhido: ClienteAtendimentoDTO | null) {
    if (bloqueado || salvando || incerta) return;
    setErro("");
    aoSelecionar(escolhido);
    setBusca("");
    setPagina(1);
    setResultado(null);
  }
  async function salvar() {
    if (trava.current || bloqueado) return;
    if (!incerta && (!nome.trim() || !telefone.trim())) {
      setErroCadastro("Informe nome e telefone do cliente.");
      return;
    }
    tentativa.current ??= {
      storeId: unidadeId,
      chaveUUID: crypto.randomUUID(),
      nome: nome.trim(),
      telefone: telefone.trim(),
    };
    trava.current = true;
    setSalvando(true);
    setErroCadastro("");
    setDuplicado(null);
    try {
      const dados = await apiClientes<{ cliente: ClienteAtendimentoDTO }>(
        unidadeId,
        "",
        { method: "POST", body: tentativa.current },
      );
      if (!dados.cliente) throw new Error("Resposta incompleta");
      aoSelecionar(dados.cliente);
      setCriando(false);
      setBusca("");
      setNome("");
      setTelefone("");
      setIncerta(false);
      tentativa.current = null;
    } catch (falha) {
      if (falha instanceof ErroClienteAtendimento && falha.operacaoConfirmada) {
        setIncerta(false);
        tentativa.current = null;
        setCriando(false);
        setNome("");
        setTelefone("");
        setBusca("");
        setResultado(null);
        setErro("Cadastro registrado, mas mudou; consulte novamente.");
      } else if (falha instanceof ErroClienteAtendimento && !falha.incerta) {
        setErroCadastro(falha.message);
        if (falha.codigo === "TELEFONE_DUPLICADO" && falha.clienteExistente)
          setDuplicado(falha.clienteExistente);
        if (!incerta) tentativa.current = null;
      } else {
        setIncerta(true);
        setErroCadastro(
          "Não foi possível confirmar o cadastro. Mantenha esta tela aberta e confirme novamente; a mesma identificação evita duplicação.",
        );
      }
    } finally {
      trava.current = false;
      setSalvando(false);
    }
  }
  function fecharCadastro() {
    if (!salvando && !incerta && !bloqueado) {
      setCriando(false);
      setErroCadastro("");
      setDuplicado(null);
      tentativa.current = null;
    }
  }
  async function conferirEndereco(
    escolhido: ClienteAtendimentoDTO,
    endereco: EnderecoAtendimentoDTO,
  ) {
    if (bloqueado || conferindoEndereco) return;
    consultaEndereco.current?.abort();
    const controller = new AbortController();
    consultaEndereco.current = controller;
    setConferindoEndereco(true);
    setErro("");
    try {
      const atual = await apiClientes<ConsultaClienteAtendimento>(
        unidadeId,
        `/${encodeURIComponent(escolhido.id)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setCliente(atual.cliente);
      setEnderecos(atual.enderecos);
      callbacks.current.aoCarregar(atual.cliente);
      const vigente = atual.enderecos.find((item) => item.id === endereco.id);
      if (!vigente || vigente.versao !== endereco.versao) {
        setErro(
          "O endereço mudou no cadastro. Confira a lista atualizada e escolha novamente.",
        );
        return;
      }
      aoEscolherEndereco(atual.cliente, vigente);
    } catch (falha) {
      if (!controller.signal.aborted)
        setErro(
          falha instanceof Error
            ? falha.message
            : "Não foi possível conferir o endereço.",
        );
    } finally {
      if (montado.current) setConferindoEndereco(false);
    }
  }
  const clienteAtual = cliente?.id === clienteId ? cliente : null;
  return (
    <div className="min-w-0 space-y-2">
      {clienteId ? (
        <>
          <div className="border-line flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2">
            <Icone nome="pessoa" tamanho={18} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {clienteAtual?.nome ?? "Cliente vinculado ao atendimento"}
              </p>
              {clienteAtual?.telefone && (
                <p className="text-ink-3 text-xs">{clienteAtual.telefone}</p>
              )}
            </div>
            <button
              type="button"
              disabled={bloqueado}
              className="text-accent min-h-10 text-xs underline"
              onClick={() => escolher(null)}
            >
              Trocar
            </button>
          </div>
          {mostrarEnderecos && clienteAtual && enderecos.length > 0 && (
            <details>
              <summary className="text-accent cursor-pointer text-xs font-semibold">
                Escolher endereço do cliente ({enderecos.length})
              </summary>
              <ul className="divide-line mt-2 divide-y">
                {enderecos.map((endereco) => (
                  <li key={endereco.id}>
                    <button
                      type="button"
                      disabled={bloqueado || conferindoEndereco}
                      className="hover:bg-surface-2 w-full rounded-md px-2 py-3 text-left text-xs"
                      onClick={() =>
                        void conferirEndereco(clienteAtual, endereco)
                      }
                    >
                      <strong>
                        {endereco.rotulo || "Endereço"}
                        {endereco.principal ? " · Principal" : ""}
                      </strong>
                      <span className="text-ink-3 mt-1 block">
                        {endereco.endereco.logradouro},{" "}
                        {endereco.endereco.numero} · {endereco.endereco.bairro}{" "}
                        · {endereco.endereco.cidade}/{endereco.endereco.uf}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <>
          <Campo
            rotulo="Buscar cliente"
            inputMode="search"
            value={busca}
            placeholder="Nome ou telefone"
            disabled={bloqueado}
            onChange={(evento) => {
              setBusca(evento.target.value);
              setErro("");
              setPagina(1);
            }}
          />
          {buscando && (
            <p role="status" className="text-ink-3 text-xs">
              Buscando clientes…
            </p>
          )}
          {resultado && busca.trim().length >= 2 && !buscando && (
            <>
              <ul className="divide-line border-line max-h-52 overflow-y-auto rounded-md border">
                {resultado.clientes.map((pessoa) => (
                  <li key={pessoa.id}>
                    <button
                      type="button"
                      disabled={bloqueado || conferindoEndereco}
                      className="hover:bg-surface-2 w-full px-3 py-3 text-left text-sm"
                      onClick={() => escolher(pessoa)}
                    >
                      <strong className="block">{pessoa.nome}</strong>
                      <span className="text-ink-3 text-xs">
                        {pessoa.telefone}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!resultado.clientes.length && (
                <p className="text-ink-3 text-xs">Nenhum cliente encontrado.</p>
              )}
              {resultado.totalPaginas > 1 && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Botao
                    peso="fantasma"
                    disabled={pagina <= 1 || bloqueado}
                    onClick={() => setPagina((p) => p - 1)}
                  >
                    Anterior
                  </Botao>
                  <span>
                    {resultado.pagina} de {resultado.totalPaginas}
                  </span>
                  <Botao
                    peso="fantasma"
                    disabled={pagina >= resultado.totalPaginas || bloqueado}
                    onClick={() => setPagina((p) => p + 1)}
                  >
                    Próxima
                  </Botao>
                </div>
              )}
            </>
          )}
          {podeEditar && (
            <button
              type="button"
              className="text-accent min-h-10 text-xs font-semibold underline"
              disabled={bloqueado}
              onClick={() => {
                setNome(busca.trim());
                setTelefone("");
                setErroCadastro("");
                setCriando(true);
              }}
            >
              + Novo cliente
            </button>
          )}
        </>
      )}
      {erro && (
        <p role="alert" className="text-bad text-xs">
          {erro}
        </p>
      )}
      {criando && (
        <PainelLateral
          aberto
          aoFechar={fecharCadastro}
          podeFechar={() => !salvando && !incerta && !bloqueado}
          titulo="Cadastrar cliente"
          apoio="Informe os dados para identificar o cliente neste atendimento."
          rodape={
            <div className="flex gap-2">
              <Botao
                peso="secundario"
                disabled={salvando || incerta || bloqueado}
                onClick={fecharCadastro}
              >
                Cancelar
              </Botao>
              <Botao
                className="flex-1"
                carregando={salvando}
                disabled={bloqueado}
                onClick={() => void salvar()}
              >
                {incerta ? "Confirmar novamente" : "Salvar cliente"}
              </Botao>
            </div>
          }
        >
          <div className="space-y-4">
            <Campo
              rotulo="Nome"
              autoComplete="name"
              maxLength={160}
              value={nome}
              disabled={salvando || incerta || bloqueado}
              onChange={(evento) => {
                setNome(evento.target.value);
                setDuplicado(null);
                setErroCadastro("");
              }}
            />
            <Campo
              rotulo="Telefone"
              autoComplete="tel"
              inputMode="tel"
              maxLength={30}
              value={telefone}
              disabled={salvando || incerta || bloqueado}
              onChange={(evento) => {
                setTelefone(evento.target.value);
                setDuplicado(null);
                setErroCadastro("");
              }}
            />
            {erroCadastro && (
              <p
                role="alert"
                className="bg-bad-sub text-bad rounded-md p-3 text-sm"
              >
                {erroCadastro}
              </p>
            )}
            {duplicado && !incerta && (
              <div className="border-line space-y-2 rounded-md border p-3 text-sm">
                <p>
                  Telefone já cadastrado para <strong>{duplicado.nome}</strong>.
                </p>
                <Botao
                  peso="secundario"
                  disabled={salvando || bloqueado}
                  onClick={() => {
                    escolher(duplicado);
                    fecharCadastro();
                  }}
                >
                  Usar este cliente
                </Botao>
              </div>
            )}
          </div>
        </PainelLateral>
      )}
    </div>
  );
}
