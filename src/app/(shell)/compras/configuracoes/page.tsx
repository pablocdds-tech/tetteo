import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Tabela, type Coluna } from "@/design-system/tabela";
import { Vazio } from "@/design-system/vazio";
import {
  definirDestinoDeTesteAcao,
  enviarTesteAcao,
  pausarCanalAcao,
  salvarAgendaAcao,
  salvarAlcadaAcao,
} from "@/modules/compras/acoes";
import { Acao } from "@/modules/compras/components/acao";
import { dia } from "@/modules/compras/components/formato";
import { emReais } from "@/modules/compras/components/linha-do-pedido";
import { listarAgendas } from "@/modules/compras/services/agenda";
import { listarAlcadas } from "@/modules/compras/services/alcadas";
import { canalDaOrganizacao } from "@/modules/compras/services/fila";

/**
 * AS REGRAS DE COMPRAS — quem aprova até quanto, o envio ao fornecedor e a
 * rodada que abre sozinha.
 *
 * Nenhum segredo passa por esta tela. O canal real (número, instância, senha
 * do relógio) mora no ambiente privado do servidor; aqui só se lê se ele está
 * ligado, e se configura o que é regra de negócio.
 */

type LinhaDaAlcada = Awaited<ReturnType<typeof listarAlcadas>>[number];
type Agenda = Awaited<ReturnType<typeof listarAgendas>>[number];

const DIAS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

const CAIXA =
  "bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent h-10 w-full min-w-0 rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:text-sm";
const ROTULO = "text-ink-2 text-sm font-semibold";

export default async function ConfiguracoesDeCompras({
  searchParams,
}: {
  searchParams: Promise<{ agenda?: string }>;
}) {
  const ctx = await obterContexto();
  if (!ctx) redirect("/login");
  const podeConfigurar = pode(ctx, "compras.configurar");
  const podeRodadas = pode(ctx, "compras.rodadas");
  const podeEnviar = pode(ctx, "compras.enviar");
  if (
    !pode(ctx, "compras.ver") ||
    !(podeConfigurar || podeRodadas || podeEnviar)
  )
    notFound();

  const { agenda: agendaPedida } = await searchParams;
  const [alcadas, agendas, canal] = await Promise.all([
    listarAlcadas(ctx),
    listarAgendas(ctx),
    canalDaOrganizacao(ctx.organizacao.id),
  ]);
  const simulado = (process.env.COMPRAS_CANAL ?? "simulador") !== "whatsapp";
  const editando = agendas.find((a) => a.id === agendaPedida) ?? null;
  const nomeDaLoja = new Map(ctx.unidadesVisiveis.map((u) => [u.id, u.nome]));

  const colunasAlcada: Coluna<LinhaDaAlcada>[] = [
    {
      chave: "papel",
      titulo: "Papel",
      principal: true,
      celula: (a) => a.papel.nome,
    },
    {
      chave: "hoje",
      titulo: "Aprova hoje",
      celula: (a) =>
        a.vigente ? (
          <span>
            {a.vigente.limite === null
              ? "Qualquer valor"
              : `Até ${emReais(a.vigente.limite)}`}
            <span className="text-ink-3 block text-xs">
              versão {a.vigente.versao} · desde {dia(a.vigente.vigenteDesde)}
            </span>
          </span>
        ) : (
          <span className="text-ink-3">Não aprova</span>
        ),
    },
    {
      chave: "historico",
      titulo: "Versões anteriores",
      celula: (a) => {
        const anteriores = a.historico.filter((h) => h.chaveVigente === null);
        return anteriores.length ? (
          <details>
            <summary className="text-accent cursor-pointer text-xs font-semibold">
              {anteriores.length}{" "}
              {anteriores.length === 1 ? "anterior" : "anteriores"}
            </summary>
            <ul className="text-ink-3 mt-1 flex flex-col gap-0.5 text-xs">
              {anteriores.map((h) => (
                <li key={h.id}>
                  v{h.versao}:{" "}
                  {h.limite === null ? "sem limite" : emReais(h.limite)} ·{" "}
                  {dia(h.vigenteDesde)} a {dia(h.encerradaEm)}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-ink-3 text-xs">—</span>
        );
      },
    },
    ...(podeConfigurar
      ? [
          {
            chave: "mudar",
            titulo: "Mudar",
            larguraMin: "19rem",
            celula: (a: LinhaDaAlcada) => (
              <div className="flex flex-col gap-2">
                <Acao
                  acao={salvarAlcadaAcao}
                  campos={{ papelId: a.papel.id }}
                  rotulo="Salvar como versão nova"
                  peso="secundario"
                  tamanho="pequeno"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`limite-${a.papel.id}`} className="sr-only">
                      Limite de aprovação para {a.papel.nome}
                    </label>
                    <input
                      id={`limite-${a.papel.id}`}
                      name="limite"
                      placeholder="Até R$ 1.500,00"
                      inputMode="decimal"
                      className={`${CAIXA} w-40`}
                    />
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        name="semLimite"
                        className="size-4"
                      />
                      Qualquer valor
                    </label>
                  </div>
                </Acao>
                {a.vigente && (
                  <Acao
                    acao={salvarAlcadaAcao}
                    campos={{ papelId: a.papel.id, remover: "1" }}
                    rotulo="Tirar a alçada"
                    peso="fantasma"
                    tamanho="pequeno"
                    confirmar={`${a.papel.nome} deixa de aprovar compras. Continuar?`}
                  />
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  const colunasAgenda: Coluna<Agenda>[] = [
    {
      chave: "nome",
      titulo: "Agenda",
      principal: true,
      celula: (a) =>
        podeRodadas ? (
          <Link
            href={`/compras/configuracoes?agenda=${a.id}#agenda`}
            className="hover:text-accent font-medium"
          >
            {a.nome}
          </Link>
        ) : (
          a.nome
        ),
    },
    {
      chave: "quando",
      titulo: "Abre",
      celula: (a) => `${DIAS[a.diaDaSemana]} às ${a.horaAbertura}`,
    },
    {
      chave: "prazos",
      titulo: "Prazos",
      celula: (a) => (
        <span className="text-xs">
          lista das lojas em {a.horasParaRequisicao} h
          <span className="text-ink-3 block">
            cotação em {a.horasParaCotacao} h
          </span>
        </span>
      ),
    },
    {
      chave: "entrega",
      titulo: "Entrega",
      celula: (a) => `de ${a.entregaDeDias} a ${a.entregaAteDias} dias`,
    },
    {
      chave: "lojas",
      titulo: "Lojas",
      celula: (a) =>
        a.unidadeIds.map((id) => nomeDaLoja.get(id) ?? "Loja").join(", ") ||
        "—",
    },
    {
      chave: "situacao",
      titulo: "Situação",
      celula: (a) =>
        a.ativa ? (
          <Etiqueta tom="ok">Ligada</Etiqueta>
        ) : (
          <Etiqueta tom="neutro">Desligada</Etiqueta>
        ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[var(--width-data)] flex-col gap-4">
      <CabecalhoDePagina
        titulo="Configurações de Compras"
        contexto="Quem aprova, como o pedido chega ao fornecedor e a rodada que abre sozinha"
      />

      <Cartao como="section" className="min-w-0 overflow-hidden">
        <TituloDeSecao apoio="Aprovar exige a permissão de aprovar E uma alçada que cubra o valor. Mudar cria versão nova; a aprovação guarda sob qual versão foi feita.">
          Quem aprova, e até quanto
        </TituloDeSecao>
        <Tabela
          legenda="Alçadas de aprovação por papel"
          colunas={colunasAlcada}
          linhas={alcadas}
          chaveDaLinha={(a) => a.papel.id}
          vazio={
            <Vazio
              icone="pessoas"
              titulo="Nenhum papel cadastrado"
              explicacao="Os papéis (Diretor, Comprador, Gerente…) vêm das Configurações gerais."
            />
          }
        />
      </Cartao>

      <Cartao como="section" className="min-w-0">
        <TituloDeSecao apoio="O que o sistema manda ao fornecedor: convite de cotação, pedido, adendo, alteração.">
          Envio ao fornecedor
        </TituloDeSecao>
        <div className="desk:grid-cols-2 grid gap-4 p-4">
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-3">Canal</dt>
              <dd>
                {simulado ? (
                  <Etiqueta tom="aviso">
                    Simulador — nada sai do sistema
                  </Etiqueta>
                ) : (
                  <Etiqueta tom="ok">WhatsApp de Compras</Etiqueta>
                )}
              </dd>
              <dt className="text-ink-3">Situação</dt>
              <dd>
                {canal.pausado ? (
                  <span className="text-bad">
                    Pausado{canal.motivoPausa ? `: ${canal.motivoPausa}` : ""}
                  </span>
                ) : (
                  "Enviando normalmente"
                )}
              </dd>
              <dt className="text-ink-3">Número de teste</dt>
              <dd className="tabular-nums">
                {canal.destinoTeste ?? "não definido"}
              </dd>
            </dl>

            {podeEnviar &&
              (canal.pausado ? (
                <Acao
                  acao={pausarCanalAcao}
                  campos={{ pausar: "0" }}
                  rotulo="Retomar envio"
                  peso="secundario"
                  tamanho="pequeno"
                />
              ) : (
                <Acao
                  acao={pausarCanalAcao}
                  campos={{ pausar: "1" }}
                  rotulo="Pausar todo o envio"
                  peso="fantasma"
                  tamanho="pequeno"
                  pedeMotivo="Por que pausar? A frase aparece para todos no painel."
                />
              ))}

            {podeConfigurar && (
              <Acao
                acao={definirDestinoDeTesteAcao}
                campos={{}}
                rotulo="Salvar número de teste"
                peso="secundario"
                tamanho="pequeno"
              >
                <label htmlFor="destino-teste" className={ROTULO}>
                  Número de teste (WhatsApp)
                </label>
                <input
                  id="destino-teste"
                  name="telefone"
                  type="tel"
                  defaultValue={canal.destinoTeste ?? ""}
                  placeholder="(84) 99999-0000"
                  className={CAIXA}
                />
                <p className="text-ink-3 text-xs leading-[18px]">
                  Mensagem de teste vai SÓ para este número — nunca para
                  fornecedor. Deixe em branco para desligar.
                </p>
              </Acao>
            )}

            {(podeEnviar || podeConfigurar) && canal.destinoTeste && (
              <Acao
                acao={enviarTesteAcao}
                campos={{}}
                rotulo="Mandar teste"
                peso="secundario"
                tamanho="pequeno"
              >
                <label htmlFor="texto-teste" className={ROTULO}>
                  Texto do teste
                </label>
                <textarea
                  id="texto-teste"
                  name="texto"
                  rows={2}
                  maxLength={300}
                  defaultValue="Teste do envio de Compras. Pode ignorar."
                  className="bg-surface border-line-2 text-ink focus:border-accent w-full rounded-md border px-3 py-2 text-base md:text-sm"
                />
              </Acao>
            )}
          </div>

          <div className="border-line-2 bg-surface-2 text-ink-2 flex flex-col gap-2 self-start rounded-md border border-dashed p-4 text-sm leading-5">
            <p className="text-ink font-semibold">
              Para as mensagens saírem de verdade
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>
                Um número de WhatsApp só de Compras, conectado na Evolution —
                separado do número da Severina.
              </li>
              <li>
                No ambiente privado do servidor: o canal em
                &ldquo;whatsapp&rdquo; e o nome da instância. Nenhum segredo é
                digitado nesta tela.
              </li>
              <li>
                O relógio do servidor chamando a batida de Compras a cada
                minuto, com a senha dele guardada no servidor.
              </li>
              <li>
                Até lá, o simulador registra tudo e nada sai: copie cada
                mensagem e mande pelo seu WhatsApp.
              </li>
            </ul>
          </div>
        </div>
      </Cartao>

      <Cartao como="section" className="min-w-0 overflow-hidden">
        <TituloDeSecao
          id="agenda"
          apoio="Abre uma rodada por semana, sozinha, no dia e hora marcados — já coletando as listas das lojas."
        >
          Rodada automática
        </TituloDeSecao>
        <Tabela
          legenda="Agendas de rodada"
          colunas={colunasAgenda}
          linhas={agendas}
          chaveDaLinha={(a) => a.id}
          vazio={
            <Vazio
              icone="relogio"
              titulo="Nenhuma agenda"
              explicacao="Sem agenda, cada rodada é aberta à mão em Rodadas › Nova rodada."
            />
          }
        />
        {podeRodadas && (
          <div className="border-line flex flex-col gap-3 border-t p-4">
            <h3 className="text-sm font-semibold">
              {editando ? `Editar a agenda “${editando.nome}”` : "Nova agenda"}
            </h3>
            <Acao
              key={editando?.id ?? "nova"}
              acao={salvarAgendaAcao}
              campos={editando ? { id: editando.id } : {}}
              rotulo="Salvar agenda"
              peso="secundario"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="agenda-nome" className={ROTULO}>
                    Nome
                  </label>
                  <input
                    id="agenda-nome"
                    name="nome"
                    required
                    maxLength={60}
                    defaultValue={editando?.nome ?? "Compra da semana"}
                    className={CAIXA}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agenda-dia" className={ROTULO}>
                    Dia
                  </label>
                  <select
                    id="agenda-dia"
                    name="diaDaSemana"
                    defaultValue={editando?.diaDaSemana ?? 1}
                    className={CAIXA}
                  >
                    {DIAS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agenda-hora" className={ROTULO}>
                    Hora
                  </label>
                  <input
                    id="agenda-hora"
                    name="horaAbertura"
                    type="time"
                    required
                    defaultValue={editando?.horaAbertura ?? "07:00"}
                    className={CAIXA}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agenda-req" className={ROTULO}>
                    Lojas mandam a lista em (horas)
                  </label>
                  <input
                    id="agenda-req"
                    name="horasParaRequisicao"
                    type="number"
                    min={1}
                    max={168}
                    defaultValue={editando?.horasParaRequisicao ?? 24}
                    className={CAIXA}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agenda-cot" className={ROTULO}>
                    Fornecedores respondem em (horas)
                  </label>
                  <input
                    id="agenda-cot"
                    name="horasParaCotacao"
                    type="number"
                    min={2}
                    max={336}
                    defaultValue={editando?.horasParaCotacao ?? 48}
                    className={CAIXA}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agenda-de" className={ROTULO}>
                    Entrega a partir de (dias)
                  </label>
                  <input
                    id="agenda-de"
                    name="entregaDeDias"
                    type="number"
                    min={0}
                    max={60}
                    defaultValue={editando?.entregaDeDias ?? 2}
                    className={CAIXA}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agenda-ate" className={ROTULO}>
                    Entrega até (dias)
                  </label>
                  <input
                    id="agenda-ate"
                    name="entregaAteDias"
                    type="number"
                    min={0}
                    max={60}
                    defaultValue={editando?.entregaAteDias ?? 3}
                    className={CAIXA}
                  />
                </div>
              </div>
              <fieldset className="flex flex-col gap-1.5">
                <legend className={`${ROTULO} mb-1`}>Lojas</legend>
                <div className="flex flex-wrap gap-2">
                  {ctx.unidadesVisiveis.map((u) => (
                    <label
                      key={u.id}
                      className="border-line-2 has-[:checked]:border-accent has-[:checked]:bg-accent-sub flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm md:min-h-9"
                    >
                      <input
                        type="checkbox"
                        name="unidadeIds"
                        value={u.id}
                        defaultChecked={
                          editando ? editando.unidadeIds.includes(u.id) : true
                        }
                        className="size-4"
                      />
                      {u.nome}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="ativa"
                  defaultChecked={editando?.ativa ?? true}
                  className="size-4"
                />
                Ligada
              </label>
            </Acao>
            {editando && (
              <Link
                href="/compras/configuracoes#agenda"
                className="text-ink-3 hover:text-ink text-sm"
              >
                Cancelar edição
              </Link>
            )}
          </div>
        )}
      </Cartao>
    </div>
  );
}
