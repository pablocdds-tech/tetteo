"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import {
  salvarCarrinhoAcao,
  retomarCarrinhoAcao,
  descartarCarrinhoAcao,
} from "../acoes-carrinhos";
import type {
  ConteudoCarrinho,
  ResumoCarrinho,
  RetomadaCarrinho,
} from "../carrinho-types";

export function CarrinhosSalvos({
  carrinhos,
  conteudo,
  atual,
  bloqueado,
  podeVender,
  temPagamentos,
  online,
  aoSalvar,
  aoRetomar,
  aoBloquear,
}: {
  carrinhos: ResumoCarrinho[];
  conteudo: ConteudoCarrinho;
  atual: { id: string; versao: number; nome: string } | null;
  bloqueado: boolean;
  podeVender: boolean;
  temPagamentos: boolean;
  online: boolean;
  aoSalvar: () => void;
  aoRetomar: (retomada: RetomadaCarrinho) => void;
  aoBloquear: (bloqueado: boolean) => void;
}) {
  const router = useRouter();
  const [painel, setPainel] = useState<"salvar" | "lista" | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [pendente, setPendente] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [copia, setCopia] = useState(false);
  const tentativa = useRef<{
    id: string;
    versao: number;
    nome: string;
    conteudo: ConteudoCarrinho;
  } | null>(null);
  const trava = useRef(false);

  function abrirSalvar() {
    tentativa.current = null;
    setCopia(false);
    setNome(atual?.nome ?? "");
    setErro("");
    setMensagem("");
    setPainel("salvar");
  }
  async function salvar() {
    if (trava.current || !online) return;
    tentativa.current ??= {
      id: (!copia ? atual?.id : undefined) ?? crypto.randomUUID(),
      versao: (!copia ? atual?.versao : undefined) ?? 0,
      nome: nome.trim() || "Atendimento salvo",
      conteudo,
    };
    trava.current = true;
    setPendente(true);
    aoBloquear(true);
    setErro("");
    try {
      const resultado = await salvarCarrinhoAcao(tentativa.current);
      if (resultado.erro) {
        setErro(resultado.erro);
        if (!incerta) {
          tentativa.current = null;
          aoBloquear(false);
        }
        return;
      }
      setIncerta(false);
      aoBloquear(false);
      setPainel(null);
      aoSalvar();
      router.refresh();
    } catch {
      setIncerta(true);
      setErro(
        "A resposta do salvamento não chegou. Tente novamente para confirmar o mesmo atendimento, sem criar outro.",
      );
    } finally {
      trava.current = false;
      setPendente(false);
    }
  }
  async function retomar(id: string) {
    if (trava.current || bloqueado || !online) return;
    if (conteudo.itens.length) {
      setErro(
        "Salve ou limpe o carrinho atual antes de retomar outro atendimento.",
      );
      return;
    }
    trava.current = true;
    setPendente(true);
    aoBloquear(true);
    setErro("");
    try {
      const resultado = await retomarCarrinhoAcao({ id });
      if (resultado.erro || !resultado.retomada) {
        setErro(resultado.erro ?? "Não foi possível retomar este atendimento.");
        return;
      }
      aoRetomar(resultado.retomada);
      setPainel(null);
      router.refresh();
    } catch {
      setErro("Não foi possível carregar o atendimento. Tente novamente.");
    } finally {
      trava.current = false;
      setPendente(false);
      aoBloquear(false);
    }
  }
  async function descartar(c: ResumoCarrinho) {
    if (
      trava.current ||
      bloqueado ||
      !online ||
      !window.confirm(
        `Descartar o atendimento “${c.nome}”? O histórico do descarte será preservado.`,
      )
    )
      return;
    trava.current = true;
    setPendente(true);
    setErro("");
    setMensagem("");
    try {
      const resultado = await descartarCarrinhoAcao({
        id: c.id,
        versao: c.versao,
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setMensagem("Atendimento descartado.");
      router.refresh();
    } catch {
      setErro(
        "Não foi possível confirmar o descarte. Atualize a lista antes de tentar novamente.",
      );
      router.refresh();
    } finally {
      trava.current = false;
      setPendente(false);
    }
  }
  if (!podeVender) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          peso="secundario"
          disabled={
            bloqueado || !online || !conteudo.itens.length || temPagamentos
          }
          title={
            temPagamentos
              ? "Remova os pagamentos antes de salvar o atendimento."
              : undefined
          }
          onClick={abrirSalvar}
        >
          Salvar atendimento
        </Botao>
        <Botao
          peso="secundario"
          disabled={bloqueado || !online}
          onClick={() => {
            setErro("");
            setMensagem("");
            setPainel("lista");
          }}
        >
          Atendimentos salvos ({carrinhos.length})
        </Botao>
      </div>
      <PainelLateral
        aberto={painel === "salvar"}
        aoFechar={() => setPainel(null)}
        podeFechar={() => !pendente && !incerta}
        titulo="Salvar atendimento"
        apoio="Os itens ficam guardados para você retomar nesta loja. Pagamentos e estoque só são registrados ao concluir a venda."
        rodape={
          <Botao
            className="w-full"
            carregando={pendente}
            disabled={!online}
            onClick={() => void salvar()}
          >
            {incerta ? "Confirmar salvamento" : "Salvar e liberar o caixa"}
          </Botao>
        }
      >
        <div className="space-y-4">
          <Campo
            rotulo="Nome para identificar o atendimento"
            placeholder="Ex.: retirada das 19h"
            maxLength={100}
            value={nome}
            disabled={pendente || incerta}
            onChange={(e) => setNome(e.target.value)}
          />
          <p className="text-ink-3 text-sm">
            Ao retomar, o PDV confere o catálogo e aplica os preços atuais.
            Descontos, taxas e pagamentos precisam ser informados novamente. O
            salvamento não reserva ingredientes.
          </p>
          {erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-lg p-3 text-sm"
            >
              {erro}
            </p>
          )}
          {erro && atual && !incerta && !pendente && (
            <div className="border-line space-y-2 rounded-lg border p-3">
              <p className="text-ink-3 text-sm">
                Para preservar suas alterações sem substituir o atendimento de
                outra aba, você pode salvar uma cópia. O original continuará na
                lista.
              </p>
              <Botao
                peso="secundario"
                onClick={() => {
                  tentativa.current = null;
                  setCopia(true);
                  setNome(`${nome.trim() || atual.nome} (cópia)`.slice(0, 100));
                  setErro("");
                  setMensagem(
                    "Uma cópia será criada ao confirmar o salvamento.",
                  );
                }}
              >
                Preparar cópia como novo atendimento
              </Botao>
            </div>
          )}
          {mensagem && (
            <p role="status" className="text-ink-2 text-sm">
              {mensagem}
            </p>
          )}
        </div>
      </PainelLateral>
      <PainelLateral
        aberto={painel === "lista"}
        aoFechar={() => setPainel(null)}
        podeFechar={() => !pendente}
        titulo="Seus atendimentos salvos"
        apoio="Somente os atendimentos do seu usuário nesta loja."
      >
        <div className="space-y-3">
          {erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-lg p-3 text-sm"
            >
              {erro}
            </p>
          )}
          {mensagem && (
            <p
              role="status"
              className="bg-ok-sub text-ok rounded-lg p-3 text-sm"
            >
              {mensagem}
            </p>
          )}
          {!carrinhos.length && (
            <div className="border-line rounded-lg border p-5">
              <h3 className="font-semibold">Nenhum atendimento salvo</h3>
              <p className="text-ink-3 mt-2 text-sm">
                Monte um carrinho e use “Salvar atendimento” para atender outra
                pessoa e retomar depois.
              </p>
            </div>
          )}
          {carrinhos.map((c) => (
            <article key={c.id} className="border-line rounded-lg border p-4">
              <h3 className="font-semibold">{c.nome}</h3>
              <p className="text-ink-3 mt-1 text-sm">
                {c.quantidadeItens} itens ·{" "}
                {new Date(c.atualizadoEm).toLocaleString("pt-BR")}
              </p>
              {atual?.id === c.id ? (
                <p className="text-accent mt-3 text-sm">Aberto neste caixa</p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Botao
                    tamanho="pequeno"
                    disabled={
                      pendente ||
                      bloqueado ||
                      !online ||
                      conteudo.itens.length > 0
                    }
                    onClick={() => void retomar(c.id)}
                  >
                    Retomar
                  </Botao>
                  <Botao
                    tamanho="pequeno"
                    peso="fantasma"
                    disabled={pendente || bloqueado || !online}
                    onClick={() => void descartar(c)}
                  >
                    Descartar
                  </Botao>
                </div>
              )}
            </article>
          ))}
          {conteudo.itens.length > 0 && (
            <p className="text-warn text-sm">
              Há itens no carrinho atual. Salve ou limpe antes de retomar outro.
            </p>
          )}
        </div>
      </PainelLateral>
    </>
  );
}
