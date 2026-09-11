"use client";

import { useState } from "react";

import { Etiqueta } from "@/design-system/etiqueta";
import { LinhaDeDetalhe, PainelLateral } from "@/design-system/painel-lateral";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";

import type { EventoNoDetalhe } from "../services/eventos";

import { quando, ROTULO_DO_EVENTO, TOM_DO_EVENTO } from "./rotulos";

/**
 * OS EVENTOS — o painel de saúde da integração.
 *
 * Mostra o que a Evolution contou e o que o Tetteo fez com isso. Não mostra
 * conversa de ninguém porque não TEM conversa de ninguém: o resumo gravado é
 * uma lista fechada de campos (estado, id da mensagem, status, uma impressão
 * do texto). O detalhe abre esse resumo inteiro — é tudo o que existe.
 */

const ROTULO_DO_CAMPO: Record<string, string> = {
  estado: "Estado informado",
  codigo: "Código",
  numeroFinal: "Final do número",
  idMensagem: "Mensagem",
  status: "Status informado",
  deMim: "Do próprio número",
  hashTexto: "Impressão do texto",
  enviadaEm: "Enviada em",
  grupo: "Conversa de grupo",
  remetente: "Remetente",
};

function valorDoCampo(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (chave === "enviadaEm") return quando(String(valor));
  if (chave === "hashTexto") return `${String(valor).slice(0, 12)}…`;
  return String(valor);
}

const COLUNAS: Coluna<EventoNoDetalhe>[] = [
  {
    chave: "tipo",
    titulo: "Evento",
    principal: true,
    celula: (e) => e.rotuloDoTipo,
  },
  {
    chave: "status",
    titulo: "Estado",
    celula: (e) => (
      <Etiqueta tom={TOM_DO_EVENTO[e.status]}>
        {ROTULO_DO_EVENTO[e.status]}
      </Etiqueta>
    ),
  },
  {
    chave: "motivo",
    titulo: "Motivo",
    celula: (e) => (
      <span className="line-clamp-2 max-w-[42ch]">{e.motivo ?? "—"}</span>
    ),
  },
  {
    chave: "repeticoes",
    titulo: "Repetições",
    numerica: true,
    celula: (e) => (e.repeticoes > 0 ? e.repeticoes : "—"),
  },
  {
    chave: "recebidoEm",
    titulo: "Recebido",
    numerica: true,
    celula: (e) => quando(e.recebidoEm),
  },
];

export function ListaDeEventos({ eventos }: { eventos: EventoNoDetalhe[] }) {
  const [aberto, setAberto] = useState<EventoNoDetalhe | null>(null);

  return (
    <>
      <Tabela
        legenda="Eventos recebidos da Evolution"
        colunas={COLUNAS}
        linhas={eventos}
        chaveDaLinha={(e) => e.id}
        aoAbrir={setAberto}
        rotuloAbrir={(e) =>
          `Ver o evento ${e.rotuloDoTipo} de ${quando(e.recebidoEm)}`
        }
        linhaAtiva={aberto?.id ?? null}
        vazio={
          <Vazio
            icone="sem-sinal"
            titulo="Nenhum evento neste período"
            explicacao="Quando a Evolution avisar o Tetteo de alguma coisa — conexão, entrega, leitura — aparece aqui."
          />
        }
      />

      <PainelLateral
        aberto={aberto !== null}
        aoFechar={() => setAberto(null)}
        titulo={aberto?.rotuloDoTipo ?? "Evento"}
        apoio="Conteúdo de mensagem, contato e QR Code nunca são guardados."
      >
        {aberto && (
          <dl>
            <LinhaDeDetalhe rotulo="Estado">
              <Etiqueta tom={TOM_DO_EVENTO[aberto.status]}>
                {ROTULO_DO_EVENTO[aberto.status]}
              </Etiqueta>
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Motivo">
              {aberto.motivo ?? "—"}
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Recebido">
              {quando(aberto.recebidoEm)}
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Processado">
              {quando(aberto.processadoEm)}
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Repetições">
              {aberto.repeticoes > 0
                ? `${aberto.repeticoes} (a última ${quando(aberto.ultimaRepeticaoEm)})`
                : "nenhuma"}
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Tentativas">
              {aberto.tentativas}
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Conexão">
              {aberto.conexaoNome}
            </LinhaDeDetalhe>
            <LinhaDeDetalhe rotulo="Identificador">
              <span className="break-all">{aberto.idExterno.slice(0, 40)}</span>
            </LinhaDeDetalhe>
            {Object.entries(aberto.resumo).map(([chave, valor]) => (
              <LinhaDeDetalhe
                key={chave}
                rotulo={ROTULO_DO_CAMPO[chave] ?? chave}
              >
                <span className="break-all">{valorDoCampo(chave, valor)}</span>
              </LinhaDeDetalhe>
            ))}
          </dl>
        )}
      </PainelLateral>
    </>
  );
}
