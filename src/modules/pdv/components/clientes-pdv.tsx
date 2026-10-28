"use client";

import { useEffect, useRef, useState } from "react";
import { LinkIntegrado, useAmbienteProprio } from "@/core/shell/link-integrado";
import { Icone } from "@/design-system/icones";
import { Campo } from "@/design-system/campo";
import { apiClientes, ErroClienteAtendimento } from "../cliente-api";
import type {
  ClienteAtendimentoPdv,
  ListaClientesAtendimento,
} from "../cliente-types";
import { EnderecosCliente } from "./enderecos-cliente";
import { ModalPdv } from "./modal-pdv";
import styles from "./secoes-pdv.module.css";

export function ClientesPdv({
  unidadeId,
  inicial,
  podeEditar,
}: {
  unidadeId: string;
  inicial: ListaClientesAtendimento;
  podeEditar: boolean;
}) {
  const proprio = useAmbienteProprio();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [revisao, setRevisao] = useState(0);
  const chave = [unidadeId, busca.trim(), pagina, revisao].join(":");
  const [consulta, setConsulta] = useState<{
    chave: string;
    dados?: ListaClientesAtendimento;
    erro?: string;
  }>({ chave: unidadeId + "::1:0", dados: inicial });
  const [selecionado, setSelecionado] = useState<ClienteAtendimentoPdv | null>(
    null,
  );
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState("");
  const dados = consulta.chave === chave ? consulta.dados : undefined;
  const carregando = consulta.chave !== chave;
  useEffect(() => {
    const controle = new AbortController();
    const espera = setTimeout(() => {
      const params = new URLSearchParams({
        busca: busca.trim(),
        pagina: String(pagina),
      });
      apiClientes<ListaClientesAtendimento>(unidadeId, "?" + params, {
        signal: controle.signal,
      })
        .then((dados) => {
          if (!controle.signal.aborted) setConsulta({ chave, dados });
        })
        .catch((erro) => {
          if (!controle.signal.aborted)
            setConsulta({
              chave,
              erro:
                erro instanceof Error
                  ? erro.message
                  : "Não foi possível consultar os clientes.",
            });
        });
    }, 250);
    return () => {
      clearTimeout(espera);
      controle.abort();
    };
  }, [unidadeId, busca, pagina, chave]);
  return (
    <div className={styles.pagina}>
      <h1 className={proprio ? "sr-only" : styles.titulo}>Clientes</h1>
      <div className={styles.barra}>
        <label className={styles.busca}>
          <Icone nome="lupa" tamanho={18} />
          <input
            aria-label="Pesquisar cliente por nome ou telefone"
            type="search"
            maxLength={100}
            placeholder="Pesquise por nome ou telefone"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
              setRevisao((n) => n + 1);
            }}
          />
        </label>
        <div className={styles.acoes}>
          <button
            className={styles.botao}
            disabled={carregando}
            onClick={() => setRevisao((n) => n + 1)}
          >
            Atualizar
          </button>
          {podeEditar && (
            <button
              className={styles.primario}
              onClick={() => setCriando(true)}
            >
              <Icone nome="mais" tamanho={16} />
              Novo cliente
            </button>
          )}
        </div>
      </div>
      {aviso && (
        <p role="status" className="bg-ok-sub text-ok rounded p-3 text-sm">
          {aviso}
        </p>
      )}
      {consulta.chave === chave && consulta.erro && (
        <p role="alert" className="text-bad text-sm">
          {consulta.erro}
        </p>
      )}
      <section
        className={styles.superficie}
        aria-label="Clientes cadastrados"
        aria-busy={carregando}
      >
        <div className={styles.rolagemTabela}>
          <table className={styles.tabela} style={{ minWidth: 550 }}>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Telefone</th>
                <th scope="col">Endereços</th>
              </tr>
            </thead>
            <tbody>
              {dados?.clientes.map((cliente) => (
                <tr key={cliente.id}>
                  <td>
                    <button
                      className={styles.link}
                      onClick={() => setSelecionado(cliente)}
                    >
                      {cliente.nome}
                    </button>
                  </td>
                  <td>{cliente.telefone || "Não informado"}</td>
                  <td>
                    <button
                      className={styles.botao}
                      aria-label={"Endereços de " + cliente.nome}
                      onClick={() => setSelecionado(cliente)}
                    >
                      Ver endereços
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {carregando ? (
            <div className={styles.vazio} role="status">
              Consultando clientes…
            </div>
          ) : dados && !dados.clientes.length ? (
            <div className={styles.vazio}>
              <h2>Nenhum cliente encontrado</h2>
              <p>
                {busca
                  ? "Tente outro nome ou telefone."
                  : "Cadastre seu primeiro cliente para agilizar os próximos pedidos."}
              </p>
            </div>
          ) : null}
        </div>
        <nav className={styles.paginacao} aria-label="Paginação de clientes">
          <span role="status">
            {dados
              ? dados.total +
                (dados.total === 1
                  ? " cliente · Página "
                  : " clientes · Página ") +
                dados.pagina +
                " de " +
                dados.totalPaginas
              : "—"}
          </span>
          <button
            disabled={!dados || dados.pagina <= 1}
            onClick={() => setPagina((dados?.pagina ?? 1) - 1)}
          >
            Anterior
          </button>
          <button
            disabled={!dados || dados.pagina >= dados.totalPaginas}
            onClick={() => setPagina((dados?.pagina ?? 1) + 1)}
          >
            Próxima
          </button>
        </nav>
      </section>
      <p className={styles.legenda}>
        O mesmo cadastro usado no atendimento. Para editar os dados do cliente,
        consultar compras e segmentação,{" "}
        <LinkIntegrado href="/crm" className={styles.link}>
          abrir CRM do Tetteo
        </LinkIntegrado>
        .
      </p>
      {selecionado && (
        <EnderecosCliente
          key={selecionado.id}
          unidadeId={unidadeId}
          cliente={selecionado}
          podeEditar={podeEditar}
          aoFechar={() => setSelecionado(null)}
        />
      )}
      {criando && (
        <CadastrarCliente
          unidadeId={unidadeId}
          aoFechar={() => setCriando(false)}
          aoSalvar={(cliente) => {
            setCriando(false);
            setSelecionado(cliente);
            setAviso("Cliente disponível no CRM e no atendimento.");
            setRevisao((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function CadastrarCliente({
  unidadeId,
  aoFechar,
  aoSalvar,
}: {
  unidadeId: string;
  aoFechar: () => void;
  aoSalvar: (c: ClienteAtendimentoPdv) => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [erro, setErro] = useState("");
  const [existente, setExistente] = useState<ClienteAtendimentoPdv | null>(
    null,
  );
  const tentativa = useRef<Record<string, unknown> | null>(null);
  const trava = useRef(false);
  useEffect(() => {
    if (!ocupado && !incerta) return;
    const proteger = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [ocupado, incerta]);
  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trava.current) return;
    tentativa.current ??= {
      chaveUUID: crypto.randomUUID(),
      nome: nome.trim(),
      telefone: telefone.trim(),
    };
    trava.current = true;
    setOcupado(true);
    setErro("");
    setExistente(null);
    try {
      const resposta = await apiClientes<{ cliente: ClienteAtendimentoPdv }>(
        unidadeId,
        "",
        { method: "POST", body: tentativa.current },
      );
      if (!resposta.cliente) throw new Error("Sem confirmação");
      aoSalvar(resposta.cliente);
    } catch (falha) {
      if (falha instanceof ErroClienteAtendimento && falha.operacaoConfirmada) {
        setIncerta(false);
        tentativa.current = null;
        setErro(
          "O cliente foi registrado e alterado depois. Feche esta janela e atualize a lista.",
        );
      } else if (falha instanceof ErroClienteAtendimento && !falha.incerta) {
        setErro(falha.message);
        if (!incerta) tentativa.current = null;
        if (falha.codigo === "TELEFONE_DUPLICADO" && falha.clienteExistente)
          setExistente(falha.clienteExistente);
      } else {
        setIncerta(true);
        setErro(
          "A confirmação não chegou. Confirme novamente com os mesmos dados para evitar duplicação.",
        );
      }
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  return (
    <ModalPdv
      aberto
      titulo="Cadastrar cliente"
      ocupado={ocupado || incerta}
      aoFechar={aoFechar}
      rodape={
        <>
          <button
            className={styles.botao}
            disabled={ocupado || incerta}
            onClick={aoFechar}
          >
            Cancelar
          </button>
          <button
            className={styles.primario}
            form="cadastrar-cliente-pdv"
            disabled={ocupado}
          >
            {ocupado ? "Salvando…" : incerta ? "Confirmar novamente" : "Salvar"}
          </button>
        </>
      }
    >
      <form id="cadastrar-cliente-pdv" onSubmit={salvar} className="space-y-5">
        <fieldset disabled={ocupado || incerta} className="space-y-5">
          <Campo
            data-foco-inicial
            rotulo="Nome do cliente"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            maxLength={150}
          />
          <Campo
            rotulo="Telefone"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            required
            inputMode="tel"
            maxLength={30}
            ajuda="Informe DDD e número."
          />
        </fieldset>
        {erro && (
          <p role="alert" className="text-bad text-sm">
            {erro}
          </p>
        )}
        {existente && !incerta && (
          <button
            type="button"
            className={styles.botao}
            disabled={ocupado}
            onClick={() => aoSalvar(existente)}
          >
            Abrir cadastro existente: {existente.nome}
          </button>
        )}
      </form>
    </ModalPdv>
  );
}
