"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useId,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Botao } from "@/design-system/botao";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";

import {
  alternarAgendamentosAcao,
  alternarEnvioAcao,
  definirLojaAcao,
  type EstadoFormulario,
} from "../acoes";
import type { EstadoNaTela } from "../schemas/conexao";

import { QrCode } from "./qr-code";
import { quando, TOM_DO_ESTADO } from "./rotulos";

/**
 * A TELA "WHATSAPP" — o número, o que ele está fazendo, e as chaves.
 *
 * O que é perigoso tem dois toques: liberar os agendamentos e trocar o
 * webhook da instância pedem confirmação na própria linha. Reconectar não
 * pede — ele nunca derruba o número; no máximo mostra um QR Code.
 *
 * As ações que falam com a Evolution chegam como propriedade, vindas da
 * camada `app/`: este módulo não alcança o conector, e não deve.
 */

export type ConexaoParaPainel = {
  id: string;
  nome: string;
  provedor: "EVOLUTION_BAILEYS" | "SIMULADO";
  unidadeId: string | null;
  unidadeNome: string | null;
  estado: EstadoNaTela;
  rotulo: string;
  motivo: string | null;
  numero: string;
  atualizadoEm: Date | null;
  envioLigado: boolean;
  agendamentosPausados: boolean;
  eventos: {
    ativo: boolean;
    url: string | null;
    eventos: string[];
    comSenha: boolean;
    esperados: string[];
    confere: boolean;
  } | null;
  eventosConfiguradosEm: Date | null;
  webhookPendente: string[];
  podeConectar: boolean;
};

export type RespostaReconectar =
  | { ok: true; conectado: true }
  | { ok: true; conectado: false; qr: { imagem: string; expiraEmMs: number } }
  | { ok: false; erro: string };

export type EstadoConsultado = {
  estado: EstadoNaTela;
  rotulo: string;
  motivo: string | null;
  atualizadoEm: Date | null;
  numero: string;
};

type AcaoDeFormulario = (
  anterior: EstadoFormulario,
  dados: FormData,
) => Promise<EstadoFormulario>;

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none sm:w-auto sm:min-w-60";

/** Uma linha de chave: o estado em palavras, o porquê, e o botão. */
function LinhaDeChave({
  titulo,
  estado,
  tom,
  explicacao,
  children,
}: {
  titulo: string;
  estado: string;
  tom: "ok" | "aviso" | "neutro";
  explicacao: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{titulo}</span>
          <Etiqueta tom={tom}>{estado}</Etiqueta>
        </div>
        <p className="text-ink-3 mt-1 text-sm leading-5">{explicacao}</p>
      </div>
      {children && <div className="flex-none">{children}</div>}
    </li>
  );
}

/** O botão que pergunta antes. O segundo toque é o que envia o formulário. */
function ComConfirmacao({
  rotulo,
  pergunta,
  confirmar,
  desabilitado,
  carregando,
}: {
  rotulo: string;
  pergunta: string;
  confirmar: string;
  desabilitado?: boolean;
  carregando?: boolean;
}) {
  const [perguntando, setPerguntando] = useState(false);

  if (!perguntando) {
    return (
      <Botao
        type="button"
        peso="secundario"
        tamanho="pequeno"
        disabled={desabilitado}
        carregando={carregando}
        onClick={() => setPerguntando(true)}
      >
        {rotulo}
      </Botao>
    );
  }

  return (
    <div
      role="group"
      aria-label={pergunta}
      className="bg-warn-sub border-warn/25 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
    >
      <span className="text-sm leading-5">{pergunta}</span>
      <Botao type="submit" tamanho="pequeno">
        {confirmar}
      </Botao>
      <Botao
        type="button"
        peso="fantasma"
        tamanho="pequeno"
        onClick={() => setPerguntando(false)}
      >
        Voltar
      </Botao>
    </div>
  );
}

function FormularioDeLoja({
  conexao,
  lojas,
}: {
  conexao: ConexaoParaPainel;
  lojas: { id: string; nome: string }[];
}) {
  const id = useId();
  const [estado, salvar, salvando] = useActionState(definirLojaAcao, {});

  return (
    <form action={salvar} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={conexao.id} />
      <label htmlFor={id} className="text-ink-2 text-sm font-semibold">
        Este número avisa sobre
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          id={id}
          name="unidadeId"
          defaultValue={conexao.unidadeId ?? ""}
          className={ESTILO_SELECT}
        >
          <option value="">A rede inteira</option>
          {lojas.map((loja) => (
            <option key={loja.id} value={loja.id}>
              {loja.nome}
            </option>
          ))}
        </select>
        <Botao type="submit" peso="secundario" carregando={salvando}>
          Salvar
        </Botao>
      </div>
      {estado.erro && (
        <p role="alert" className="text-bad text-sm">
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="text-ok text-sm">
          Loja salva.
        </p>
      )}
    </form>
  );
}

function CartaoDeEventos({
  conexao,
  aplicarEventos,
}: {
  conexao: ConexaoParaPainel;
  aplicarEventos: AcaoDeFormulario;
}) {
  const [estado, aplicar, aplicando] = useActionState(aplicarEventos, {});
  const eventos = conexao.eventos;

  const situacao = !eventos
    ? { tom: "neutro" as const, texto: "Não foi possível ler agora" }
    : eventos.confere
      ? { tom: "ok" as const, texto: "Como o Tetteo precisa" }
      : !eventos.ativo
        ? { tom: "aviso" as const, texto: "Não configurados" }
        : { tom: "aviso" as const, texto: "Diferentes do esperado" };

  return (
    <Cartao como="section">
      <TituloDeSecao apoio="O que a Evolution avisa ao Tetteo: conexão, status das mensagens e mensagens enviadas.">
        Eventos do provedor
      </TituloDeSecao>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div>
          <Etiqueta tom={situacao.tom}>{situacao.texto}</Etiqueta>
        </div>

        {eventos && (
          <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1.5 text-sm leading-5">
            <dt className="text-ink-3">Endereço atual</dt>
            <dd className="break-all">{eventos.url ?? "nenhum"}</dd>
            <dt className="text-ink-3">Eventos</dt>
            <dd>
              {eventos.eventos.length ? eventos.eventos.join(", ") : "nenhum"}
            </dd>
            <dt className="text-ink-3">Senha do passe</dt>
            <dd>{eventos.comSenha ? "configurada" : "sem senha"}</dd>
            <dt className="text-ink-3">Aplicado pelo Tetteo</dt>
            <dd className="tabular-nums">
              {quando(conexao.eventosConfiguradosEm)}
            </dd>
          </dl>
        )}

        {conexao.webhookPendente.length > 0 && (
          <p className="text-warn text-sm leading-5">
            Falta configurar no servidor: {conexao.webhookPendente.join(", ")}.
          </p>
        )}

        <form action={aplicar} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={conexao.id} />
          <div>
            <ComConfirmacao
              rotulo="Aplicar configuração"
              pergunta="Isto substitui o webhook atual desta instância na Evolution."
              confirmar="Sim, aplicar"
              desabilitado={conexao.webhookPendente.length > 0}
              carregando={aplicando}
            />
          </div>
          {estado.erro && (
            <p role="alert" className="text-bad text-sm">
              {estado.erro}
            </p>
          )}
          {estado.ok && (
            <p role="status" className="text-ok text-sm">
              Configuração aplicada.
            </p>
          )}
        </form>
      </div>
    </Cartao>
  );
}

export function PainelWhatsapp({
  conexao,
  lojas,
  reconectar,
  consultarEstado,
  aplicarEventos,
}: {
  conexao: ConexaoParaPainel;
  lojas: { id: string; nome: string }[];
  reconectar: (conexaoId: string) => Promise<RespostaReconectar>;
  consultarEstado: (conexaoId: string) => Promise<EstadoConsultado | null>;
  aplicarEventos: AcaoDeFormulario;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<{
    imagem: string;
    expiraEmMs: number;
    chave: number;
  } | null>(null);
  const [aoVivo, setAoVivo] = useState<EstadoConsultado | null>(null);
  const [aviso, setAviso] = useState<{
    tom: "ok" | "ruim";
    texto: string;
  } | null>(null);
  const [ocupado, iniciar] = useTransition();

  const estado: EstadoConsultado = aoVivo ?? {
    estado: conexao.estado,
    rotulo: conexao.rotulo,
    motivo: conexao.motivo,
    atualizadoEm: conexao.atualizadoEm,
    numero: conexao.numero,
  };

  function recarregar() {
    setAoVivo(null);
    router.refresh();
  }

  function pedirQrCode() {
    setAviso(null);
    iniciar(async () => {
      const r = await reconectar(conexao.id);
      if (!r.ok) {
        setAviso({ tom: "ruim", texto: r.erro });
        return;
      }
      if (r.conectado) {
        setQr(null);
        setAviso({
          tom: "ok",
          texto: "O número já está conectado. Nada foi desligado.",
        });
        recarregar();
        return;
      }
      setQr({ ...r.qr, chave: Date.now() });
    });
  }

  function atualizar() {
    iniciar(async () => {
      const agora = await consultarEstado(conexao.id);
      if (agora) setAoVivo(agora);
    });
  }

  // Enquanto o QR está na tela, pergunta a cada 5 s se o número conectou.
  useEffect(() => {
    if (!qr) return;
    const relogio = setInterval(async () => {
      const agora = await consultarEstado(conexao.id);
      if (!agora) return;
      setAoVivo(agora);
      if (agora.estado === "CONECTADO") {
        setQr(null);
        setAviso({ tom: "ok", texto: "Conectado. O QR Code foi descartado." });
        router.refresh();
      }
    }, 5000);
    return () => clearInterval(relogio);
  }, [qr, conexao.id, consultarEstado, router]);

  const caixaDoMotivo =
    estado.estado === "DESCONECTADO"
      ? "border-bad/25 bg-bad-sub text-bad"
      : "border-warn/25 bg-warn-sub text-warn";

  return (
    <div className="mt-6 flex flex-col gap-4">
      <Cartao como="section">
        <TituloDeSecao
          apoio={`Instância "${conexao.nome}" · ${
            conexao.provedor === "SIMULADO"
              ? "provedor simulado (ensaio)"
              : "Evolution 2.3.7, conexão por QR Code (Baileys)"
          }`}
          acao={
            conexao.podeConectar ? (
              <Botao
                peso="secundario"
                tamanho="pequeno"
                onClick={pedirQrCode}
                carregando={ocupado && !qr}
                disabled={estado.estado === "PENDENTE"}
              >
                Reconectar
              </Botao>
            ) : undefined
          }
        >
          Conexão
        </TituloDeSecao>

        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Etiqueta tom={TOM_DO_ESTADO[estado.estado]}>
              {estado.rotulo}
            </Etiqueta>
            <span className="text-[17px] leading-6 font-semibold tabular-nums">
              {estado.numero}
            </span>
            <span className="text-ink-3 text-sm tabular-nums">
              {estado.atualizadoEm
                ? `atualizado ${quando(estado.atualizadoEm)}`
                : "sem notícia do provedor ainda"}
            </span>
            <Botao
              peso="fantasma"
              tamanho="pequeno"
              onClick={atualizar}
              disabled={ocupado}
            >
              Atualizar
            </Botao>
          </div>

          {estado.motivo && (
            <p
              className={`rounded-md border px-3 py-2 text-sm leading-5 ${caixaDoMotivo}`}
            >
              {estado.motivo}
            </p>
          )}

          {aviso && (
            <p
              role={aviso.tom === "ruim" ? "alert" : "status"}
              className={`text-sm ${aviso.tom === "ruim" ? "text-bad" : "text-ok"}`}
            >
              {aviso.texto}
            </p>
          )}

          {qr && (
            <QrCode
              key={qr.chave}
              imagem={qr.imagem}
              expiraEmMs={qr.expiraEmMs}
              aoRenovar={pedirQrCode}
              renovando={ocupado}
            />
          )}
        </div>
      </Cartao>

      <Cartao como="section">
        <TituloDeSecao apoio="O que pode sair por este número, e o que fica parado.">
          Envio
        </TituloDeSecao>
        <ul className="divide-line divide-y">
          <LinhaDeChave
            titulo="Avisos confirmados"
            estado={conexao.envioLigado ? "Liberado" : "Pausado — nada sai"}
            tom={conexao.envioLigado ? "ok" : "aviso"}
            explicacao="A chave geral do número. Pausado, nem aviso já confirmado sai."
          >
            {conexao.podeConectar && (
              <form action={alternarEnvioAcao}>
                <input type="hidden" name="id" value={conexao.id} />
                <Botao
                  type="submit"
                  peso={conexao.envioLigado ? "secundario" : "primario"}
                  tamanho="pequeno"
                >
                  {conexao.envioLigado ? "Pausar envio" : "Liberar envio"}
                </Botao>
              </form>
            )}
          </LinhaDeChave>

          <LinhaDeChave
            titulo="Agendamentos da Severina"
            estado={conexao.agendamentosPausados ? "Pausados" : "Liberados"}
            tom={conexao.agendamentosPausados ? "neutro" : "ok"}
            explicacao="Mensagens que saem sozinhas, por horário. Ficam pausadas até você escolher horário, fuso, público e conteúdo."
          >
            {conexao.podeConectar && (
              <form action={alternarAgendamentosAcao}>
                <input type="hidden" name="id" value={conexao.id} />
                {conexao.agendamentosPausados ? (
                  <ComConfirmacao
                    rotulo="Liberar agendamentos"
                    pergunta="Os agentes ativos passam a enviar no horário deles."
                    confirmar="Sim, liberar"
                  />
                ) : (
                  <Botao type="submit" peso="secundario" tamanho="pequeno">
                    Pausar agendamentos
                  </Botao>
                )}
              </form>
            )}
          </LinhaDeChave>
        </ul>
      </Cartao>

      <Cartao como="section">
        <TituloDeSecao apoio="Quem pode ver o QR Code e conectar é decidido na loja deste número.">
          Loja autorizada
        </TituloDeSecao>
        <div className="px-4 py-4">
          {conexao.podeConectar ? (
            <FormularioDeLoja conexao={conexao} lojas={lojas} />
          ) : (
            <p className="text-sm">{conexao.unidadeNome ?? "A rede inteira"}</p>
          )}
        </div>
      </Cartao>

      {conexao.podeConectar && (
        <CartaoDeEventos conexao={conexao} aplicarEventos={aplicarEventos} />
      )}
    </div>
  );
}
