"use client";

import { useEffect, useState } from "react";

import type { Unidade } from "@/lib/unidades";
import {
  FormularioDeProposta,
  type ItemParaCotar,
} from "@/modules/compras/components/formulario-de-proposta";
import type { VistaDoFornecedor } from "@/modules/compras/services/propostas";

import { enviarPropostaAcao, lerCotacaoAcao } from "./acoes";

/**
 * O navegador lê o código depois do "#" e pede ao servidor o que mostrar.
 * Link inválido, vencido ou revogado vira uma frase — sem dizer por que por
 * dentro, sem revelar se o link já existiu.
 */

type Estado =
  | { tipo: "abrindo" }
  | { tipo: "fechado"; mensagem: string }
  | { tipo: "aberto"; vista: VistaDoFornecedor; codigo: string };

const INCOMPLETO =
  "Este endereço está incompleto. Abra o link exatamente como ele chegou na mensagem.";

export function CotacaoDoFornecedor() {
  const [estado, setEstado] = useState<Estado>({ tipo: "abrindo" });

  useEffect(() => {
    let vivo = true;
    const codigo = window.location.hash.replace(/^#/, "").trim();
    const abrir: Promise<Estado> = codigo
      ? lerCotacaoAcao(codigo).then((r): Estado =>
          r.ok
            ? { tipo: "aberto", vista: r.vista, codigo }
            : { tipo: "fechado", mensagem: r.mensagem },
        )
      : Promise.resolve<Estado>({ tipo: "fechado", mensagem: INCOMPLETO });
    abrir
      .catch((): Estado => ({
        tipo: "fechado",
        mensagem:
          "Não conseguimos abrir a cotação. Confira a internet e recarregue a página.",
      }))
      .then((e) => {
        if (vivo) setEstado(e);
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.tipo === "abrindo") {
    return (
      <p role="status" className="text-ink-3 py-16 text-center text-sm">
        Abrindo a cotação…
      </p>
    );
  }

  if (estado.tipo === "fechado") {
    return (
      <section className="bg-surface border-line flex flex-col gap-2 rounded-lg border p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Pedido de cotação
        </h1>
        <p className="text-ink-2 text-sm leading-6">{estado.mensagem}</p>
      </section>
    );
  }

  const { vista, codigo } = estado;
  const itens: ItemParaCotar[] = vista.itens.map((i) => ({
    itemDaSolicitacaoId: i.itemDaSolicitacaoId,
    nome: i.nome,
    unidade: i.unidade as Unidade,
    quantidade: i.quantidade,
    porLoja: i.porLoja,
    direcionado: i.direcionado,
  }));
  const u = vista.ultimaVersao;

  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-ink-3 text-sm">
          {vista.organizacao} pede sua cotação
        </p>
        <h1 className="text-[26px] leading-8 font-semibold tracking-tight">
          {vista.fornecedor}
        </h1>
        <p className="text-ink-2 text-sm">{vista.rodada}</p>
      </header>

      <dl className="bg-surface border-line grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-3">Responder até</dt>
        <dd className="font-medium tabular-nums">{vista.prazo ?? "—"}</dd>
        <dt className="text-ink-3">Entrega</dt>
        <dd className="font-medium">{vista.entrega ?? "a combinar"}</dd>
        <dt className="text-ink-3">Entregar em</dt>
        <dd>
          <ul className="flex flex-col gap-0.5">
            {vista.lojas.map((l) => (
              <li key={l.nome}>
                <strong className="font-medium">{l.nome}</strong>
                {l.endereco ? ` — ${l.endereco}` : ""}
              </li>
            ))}
          </ul>
        </dd>
      </dl>

      {vista.aviso && (
        <p
          role="status"
          className="bg-warn-sub text-warn rounded-lg px-4 py-3 text-sm leading-5"
        >
          {vista.aviso}
        </p>
      )}
      {u && (
        <p className="text-ink-2 text-sm leading-5">
          Você já respondeu — versão {u.numero}, em {u.recebidaEm}. O formulário
          traz o que você mandou: mude o que precisar e envie de novo.
        </p>
      )}

      <FormularioDeProposta
        itens={itens}
        anterior={
          u
            ? {
                frete: u.frete,
                pedidoMinimo: u.pedidoMinimo,
                prazoEntregaDias: u.prazoEntregaDias,
                validaAte: null,
                observacao: u.observacao,
                ofertas: u.ofertas,
              }
            : null
        }
        acao={enviarPropostaAcao}
        campos={{ codigo }}
        modo="fornecedor"
        podeEnviar={vista.podeEnviar}
        rotuloEnviar="Enviar proposta"
      />

      <p className="text-ink-3 text-xs leading-5">
        Seus preços são vistos só por quem pediu a cotação. Nenhum outro
        fornecedor vê esta página nem as respostas dele.
      </p>
    </>
  );
}
