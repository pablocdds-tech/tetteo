"use client";

import { useEffect, useRef, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { ModalPdv } from "./modal-pdv";
import { apiClientes, ErroClienteAtendimento } from "../cliente-api";
import type {
  ClienteAtendimentoPdv,
  ConsultaClienteAtendimento,
  EnderecoClientePdv,
} from "../cliente-types";
import type { EntregaEntrada } from "../entrega-types";
import { esquemaEnderecoEntrega, UFS_ENTREGA } from "../schemas/entrega";

type EnderecoFormulario = Omit<EntregaEntrada["endereco"], "uf"> & {
  uf: string;
};
const vazio = (): EnderecoFormulario => ({
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  cep: "",
  referencia: "",
});
const campos = [
  ["logradouro", "Rua ou avenida", 150, true],
  ["numero", "Número ou S/N", 20, true],
  ["complemento", "Complemento (opcional)", 150, false],
  ["bairro", "Bairro", 80, true],
  ["cidade", "Cidade", 80, true],
  ["cep", "CEP (opcional)", 9, false],
  ["referencia", "Referência (opcional)", 300, false],
] as const;

type Tentativa = {
  caminho: string;
  method: "POST" | "PUT";
  body: Record<string, unknown>;
};
export function EnderecosCliente({
  unidadeId,
  cliente,
  podeEditar,
  sugestao,
  aoUsar,
  aoFechar,
}: {
  unidadeId: string;
  cliente: ClienteAtendimentoPdv;
  podeEditar: boolean;
  sugestao?: EntregaEntrada["endereco"];
  aoUsar?: (endereco: EnderecoClientePdv) => void;
  aoFechar: () => void;
}) {
  const [enderecos, setEnderecos] = useState<EnderecoClientePdv[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [revisao, setRevisao] = useState(0);
  const [editando, setEditando] = useState<
    EnderecoClientePdv | null | undefined
  >(undefined);
  const [rotulo, setRotulo] = useState("Casa");
  const [principal, setPrincipal] = useState(false);
  const [endereco, setEndereco] = useState(vazio);
  const [alterado, setAlterado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const tentativa = useRef<Tentativa | null>(null);
  const trava = useRef(false);
  const tituloLista = useRef<HTMLHeadingElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (editando === undefined) tituloLista.current?.focus();
    else formulario.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [editando]);
  useEffect(() => {
    const controle = new AbortController();
    apiClientes<ConsultaClienteAtendimento>(unidadeId, `/${cliente.id}`, {
      signal: controle.signal,
    })
      .then((dados) => {
        if (controle.signal.aborted) return;
        setEnderecos(dados.enderecos);
        setCarregando(false);
      })
      .catch((falha) => {
        if (!controle.signal.aborted) {
          setErro(
            falha instanceof Error
              ? falha.message
              : "Não foi possível consultar os endereços.",
          );
          setCarregando(false);
        }
      });
    return () => controle.abort();
  }, [unidadeId, cliente.id, revisao]);
  useEffect(() => {
    if (!alterado && !ocupado && !incerta) return;
    const proteger = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [alterado, ocupado, incerta]);
  function abrir(item: EnderecoClientePdv | null) {
    if (trava.current) return;
    setEditando(item);
    setRotulo(item?.rotulo ?? "Casa");
    setPrincipal(item?.principal ?? !enderecos.length);
    setEndereco(structuredClone(item?.endereco ?? sugestao ?? vazio()));
    setAlterado(false);
    setErro("");
    setAviso("");
    tentativa.current = null;
  }
  async function usar(item: EnderecoClientePdv) {
    if (trava.current) return;
    trava.current = true;
    setOcupado(true);
    setErro("");
    try {
      const atuais = await apiClientes<ConsultaClienteAtendimento>(
        unidadeId,
        `/${cliente.id}`,
      );
      setEnderecos(atuais.enderecos);
      const atual = atuais.enderecos.find((e) => e.id === item.id);
      if (!atual || atual.versao !== item.versao) {
        setErro(
          "Este endereço mudou ou foi desativado. Confira a lista atual e escolha novamente.",
        );
        return;
      }
      aoUsar?.(atual);
    } catch (falha) {
      setErro(
        falha instanceof Error
          ? falha.message
          : "Não foi possível conferir o endereço.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  async function salvar(ativo = true) {
    if (trava.current || !podeEditar || editando === undefined) return;
    if (!tentativa.current) {
      const validacao = esquemaEnderecoEntrega.safeParse(endereco);
      if (!validacao.success || rotulo.trim().length < 2) {
        setErro(
          "Confira o nome do endereço, rua, número, bairro, cidade, UF e CEP antes de salvar.",
        );
        return;
      }
      if (
        !ativo &&
        !window.confirm(
          "Desativar este endereço no cadastro? Pedidos já gravados serão preservados.",
        )
      )
        return;
      tentativa.current = {
        caminho: `/${cliente.id}/enderecos${editando ? `/${editando.id}` : ""}`,
        method: editando ? "PUT" : "POST",
        body: {
          chaveUUID: crypto.randomUUID(),
          rotulo: rotulo.trim(),
          principal: ativo && principal,
          endereco: validacao.data,
          ...(editando ? { versao: editando.versao, ativo } : {}),
        },
      };
    }
    trava.current = true;
    setOcupado(true);
    setErro("");
    try {
      const envio = tentativa.current;
      await apiClientes<{ endereco: EnderecoClientePdv }>(
        unidadeId,
        envio.caminho,
        { method: envio.method, body: envio.body },
      );
      tentativa.current = null;
      setIncerta(false);
      setAlterado(false);
      setEditando(undefined);
      setAviso(
        "Cadastro do endereço atualizado. Escolha Usar para preencher este pedido.",
      );
      setCarregando(true);
      setRevisao((n) => n + 1);
    } catch (falha) {
      if (falha instanceof ErroClienteAtendimento && falha.operacaoConfirmada) {
        tentativa.current = null;
        setIncerta(false);
        setAlterado(false);
        setEditando(undefined);
        setAviso(
          "A operação foi registrada, mas o cadastro mudou depois. Confira os endereços atuais antes de escolher.",
        );
        setCarregando(true);
        setRevisao((n) => n + 1);
        return;
      }
      if (falha instanceof ErroClienteAtendimento && !falha.incerta && !incerta)
        tentativa.current = null;
      else setIncerta(true);
      setErro(
        falha instanceof Error
          ? falha.message
          : "A resposta não foi confirmada. Repita a mesma tentativa.",
      );
    } finally {
      trava.current = false;
      setOcupado(false);
    }
  }
  const bloqueado = ocupado || incerta;
  return (
    <ModalPdv
      aberto
      titulo={"Endereços — " + cliente.nome}
      ocupado={bloqueado}
      aoFechar={aoFechar}
      podeFechar={() =>
        !bloqueado &&
        (!alterado ||
          window.confirm("Sair sem salvar as alterações no endereço?"))
      }
      rodape={
        editando !== undefined ? (
          <>
            {!incerta && (
              <Botao
                peso="secundario"
                disabled={ocupado}
                onClick={() => {
                  if (
                    !alterado ||
                    window.confirm("Descartar as alterações no endereço?")
                  ) {
                    setEditando(undefined);
                    setAlterado(false);
                    setErro("");
                  }
                }}
              >
                Voltar à lista
              </Botao>
            )}
            <Botao
              carregando={ocupado}
              type="submit"
              form="endereco-cliente-pdv"
            >
              {incerta ? "Confirmar novamente" : "Salvar endereço"}
            </Botao>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md p-3 text-sm"
          >
            {erro}
            {incerta &&
              " A confirmação não chegou. Mantenha esta tela aberta e confirme novamente para evitar duplicação."}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-ok text-sm">
            {aviso}
          </p>
        )}
        {editando === undefined ? (
          <>
            <h3 ref={tituloLista} tabIndex={-1} className="font-semibold">
              Endereços salvos
            </h3>
            {carregando ? (
              <p role="status" className="text-ink-3 text-sm">
                Consultando endereços…
              </p>
            ) : (
              <>
                {!enderecos.length && (
                  <p className="text-ink-3 text-sm">
                    Este cliente ainda não tem endereços salvos.
                  </p>
                )}
                <ul className="divide-line divide-y">
                  {enderecos.map((item) => (
                    <li key={item.id} className="space-y-2 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <strong>{item.rotulo}</strong>
                        {item.principal && (
                          <span className="text-accent text-xs font-semibold">
                            Principal
                          </span>
                        )}
                      </div>
                      <p className="text-ink-2 text-sm">
                        {item.endereco.logradouro}, {item.endereco.numero}
                        {item.endereco.complemento
                          ? ` · ${item.endereco.complemento}`
                          : ""}
                        <br />
                        {item.endereco.bairro} · {item.endereco.cidade}/
                        {item.endereco.uf}
                      </p>
                      {item.endereco.referencia && (
                        <p className="text-ink-3 text-xs">
                          Referência: {item.endereco.referencia}
                        </p>
                      )}
                      <div className="flex gap-2">
                        {aoUsar && (
                          <Botao
                            disabled={ocupado}
                            onClick={() => void usar(item)}
                          >
                            Usar endereço
                          </Botao>
                        )}
                        {podeEditar && (
                          <Botao
                            disabled={ocupado}
                            peso="secundario"
                            onClick={() => abrir(item)}
                          >
                            Editar
                          </Botao>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {podeEditar && (
                  <Botao
                    className="mr-2 mb-2"
                    peso="secundario"
                    disabled={ocupado || enderecos.length >= 20}
                    onClick={() => abrir(null)}
                  >
                    Novo endereço
                  </Botao>
                )}
                {enderecos.length >= 20 && (
                  <p className="text-ink-3 text-xs">
                    Limite de 20 endereços ativos. Edite ou desative um endereço
                    antes de adicionar outro.
                  </p>
                )}
              </>
            )}
            <Botao
              peso="secundario"
              disabled={carregando || ocupado}
              onClick={() => {
                setErro("");
                setCarregando(true);
                setRevisao((n) => n + 1);
              }}
            >
              Atualizar endereços
            </Botao>
          </>
        ) : (
          <form
            ref={formulario}
            id="endereco-cliente-pdv"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
            className="space-y-4"
          >
            <p className="text-ink-3 text-sm">
              Os dados serão salvos no cadastro do cliente. Frete e prazo são
              conferidos em cada pedido.
            </p>
            <fieldset disabled={bloqueado} className="space-y-4">
              <Campo
                rotulo="Nome do endereço"
                placeholder="Casa, trabalho…"
                value={rotulo}
                required
                minLength={2}
                maxLength={60}
                onChange={(e) => {
                  setRotulo(e.target.value);
                  setAlterado(true);
                }}
              />
              {campos.map(([chave, titulo, tamanho, obrigatorio]) => (
                <Campo
                  key={chave}
                  rotulo={titulo}
                  value={endereco[chave]}
                  required={obrigatorio}
                  maxLength={tamanho}
                  autoComplete="off"
                  onChange={(e) => {
                    setEndereco((atual) => ({
                      ...atual,
                      [chave]: e.target.value,
                    }));
                    setAlterado(true);
                  }}
                />
              ))}
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                UF
                <select
                  required
                  className="border-line-2 bg-surface h-11 rounded-md border px-3"
                  value={endereco.uf}
                  onChange={(e) => {
                    setEndereco((atual) => ({ ...atual, uf: e.target.value }));
                    setAlterado(true);
                  }}
                >
                  <option value="">Selecione</option>
                  {UFS_ENTREGA.map((uf) => (
                    <option key={uf}>{uf}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={principal}
                  onChange={(e) => {
                    setPrincipal(e.target.checked);
                    setAlterado(true);
                  }}
                />
                Endereço principal
              </label>
              {editando && (
                <Botao
                  type="button"
                  peso="destrutivo"
                  onClick={() => void salvar(false)}
                >
                  Desativar endereço
                </Botao>
              )}
            </fieldset>
          </form>
        )}
      </div>
    </ModalPdv>
  );
}
