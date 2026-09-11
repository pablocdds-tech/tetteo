import Link from "next/link";

import type { ContextoSessao } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { Etiqueta } from "@/design-system/etiqueta";
import { Icone } from "@/design-system/icones";

import {
  cancelarRespostaAcao,
  desativarRotinaAcao,
  executarRotinaAcao,
} from "../acoes";
import {
  historicoDaRotina,
  obterResposta,
  type LinhaDoHistorico,
} from "../services/respostas";
import {
  listarResponsaveis,
  nomesDeUsuarios,
  type Periodo,
  type RotinaDoDia,
} from "../services/rotinas";

import { AcaoComConfirmacao } from "./acao-com-confirmacao";
import { FolhaDeChecklist } from "./folha-de-checklist";
import { paraLinha } from "./preparar-folha";
import { ResponsavelEmPainel } from "./responsavel-em-painel";

const DIAS = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const dataPorExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

function agendaEmTexto(r: RotinaDoDia) {
  const hora = r.horario ? ` às ${r.horario}` : "";
  if (r.recorrencia === "DIARIA") return `Todo dia${hora}`;
  if (r.recorrencia === "SEMANAL")
    return `Toda ${DIAS[r.diaDaSemana ?? 1]}${hora}`;
  return `Todo dia ${r.diaDoMes ?? 1} do mês${hora}`;
}

function corDaNota(nota: number) {
  if (nota >= 90) return "text-ok";
  if (nota >= 70) return "text-warn";
  return "text-bad";
}

/**
 * O DETALHE — a coluna da direita.
 *
 * Cabeçalho, responsável, folha e histórico ficam JUNTOS, um embaixo do outro,
 * numa coluna só que rola. Não são abas: quem está respondendo a abertura
 * precisa ver, sem clicar em nada, que ontem deu 71% e que a rotina é do
 * Alisson. Uma aba "histórico" é uma aba que ninguém abre.
 *
 * É um componente de SERVIDOR. Ele lê o banco a cada seleção — que é o que
 * garante que a folha aberta na coluna da direita seja a folha de verdade, e
 * não uma cópia de trinta minutos atrás guardada no navegador.
 */
export async function DetalheDaRotina({
  contexto,
  rotina,
  periodo,
  podeResponder,
  podeEditar,
}: {
  contexto: ContextoSessao;
  rotina: RotinaDoDia;
  periodo: Periodo;
  podeResponder: boolean;
  podeEditar: boolean;
}) {
  const [resposta, historico, pessoas] = await Promise.all([
    rotina.respostaAbertaId
      ? obterResposta(contexto, rotina.respostaAbertaId)
      : null,
    historicoDaRotina(contexto, rotina.id),
    // A lista de pessoas só é buscada por quem pode trocar o responsável.
    // Quem não pode não recebe os nomes — não é economia de consulta, é não
    // vazar a folha de pessoal para quem não tem acesso a ela.
    podeEditar
      ? listarResponsaveis(contexto)
      : Promise.resolve([] as { id: string; nome: string }[]),
  ]);

  const nomes = resposta
    ? await nomesDeUsuarios(
        resposta.itens
          .map((i) => i.respondidoPorId)
          .filter((id): id is string => !!id),
      )
    : new Map<string, { id: string; nome: string }>();

  const linhas = resposta
    ? resposta.itens.map((item) =>
        paraLinha(item, new Map([...nomes].map(([id, u]) => [id, u.nome]))),
      )
    : [];

  const tomDoStatus = {
    atrasada: "ruim",
    aguardando: "aviso",
    feita: "ok",
  } as const;

  const rotuloDoStatus = {
    atrasada: "Atrasado",
    aguardando: "Aguardando",
    feita: "Feito",
  } as const;

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Cabeçalho da atividade ---------------- */}
      <section className="bg-surface border-line rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">
              {rotina.nome}
            </h2>
            <p className="text-ink-3 mt-1 text-base">
              {agendaEmTexto(rotina)} · {rotina.totalItens}{" "}
              {rotina.totalItens === 1 ? "item" : "itens"}
              {rotina.descricao ? ` · ${rotina.descricao}` : ""}
            </p>
          </div>

          <Etiqueta tom={tomDoStatus[rotina.status]}>
            {rotuloDoStatus[rotina.status]}
          </Etiqueta>
        </div>

        <p className="text-ink-3 mt-2 text-sm">
          {rotina.status === "feita"
            ? `Próxima cobrança em ${dataPorExtenso.format(rotina.proxima)}.`
            : `Cobrança de ${dataPorExtenso.format(rotina.prazo)}.`}
        </p>

        <div className="border-line mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t pt-3">
          <div className="min-w-0">
            {podeEditar ? (
              <ResponsavelEmPainel
                rotinaId={rotina.id}
                rotinaNome={rotina.nome}
                atual={rotina.responsavel}
                pessoas={pessoas}
              />
            ) : (
              <p className="text-ink-2 text-base">
                Responsável:{" "}
                <span className="text-ink font-semibold">
                  {rotina.responsavel?.nome ?? "quem estiver de plantão"}
                </span>
              </p>
            )}
          </div>

          {/* Remover mora aqui, discreto, e não em cada linha da fila: é raro,
              não tem desfazer pela tela, e um botão por linha seria um convite
              a apertar sem querer. A pergunta diz a verdade sobre isso. */}
          {podeEditar && (
            <AcaoComConfirmacao
              acao={desativarRotinaAcao}
              campos={{ rotinaId: rotina.id, periodo }}
              pergunta={`Remover a rotina “${rotina.nome}” desta loja? Ela deixa de ser cobrada. Para voltar a cobrar, basta agendar o mesmo checklist de novo — o histórico de conclusão continua guardado e volta junto.`}
            >
              Remover rotina
            </AcaoComConfirmacao>
          )}
        </div>
      </section>

      {/* ---------------- A folha, ou o convite para abrir uma ---------------- */}
      {resposta ? (
        <div className="flex flex-col gap-3">
          <FolhaDeChecklist
            respostaId={resposta.id}
            rotinaId={rotina.id}
            periodo={periodo}
            linhas={linhas}
            podeResponder={podeResponder}
          />

          {podeResponder && (
            <div>
              <AcaoComConfirmacao
                acao={cancelarRespostaAcao}
                campos={{
                  respostaId: resposta.id,
                  rotinaId: rotina.id,
                  periodo,
                }}
                pergunta="Cancelar este checklist? As respostas já gravadas deixam de valer: ele não entra na nota nem no histórico, e a rotina volta a ficar sem folha."
              >
                Cancelar este checklist
              </AcaoComConfirmacao>
            </div>
          )}
        </div>
      ) : (
        <ParaComecar
          rotina={rotina}
          periodo={periodo}
          podeResponder={podeResponder}
        />
      )}

      {/* ---------------- Histórico de conclusão ---------------- */}
      <section className="bg-surface border-line rounded-lg border">
        <div className="border-line border-b px-4 py-3">
          <h3 className="text-base font-semibold">Histórico de conclusão</h3>
          <p className="text-ink-3 mt-0.5 text-sm">
            As últimas vezes em que esta rotina foi cumprida nesta loja.
          </p>
        </div>

        {historico.length === 0 ? (
          <p className="text-ink-3 px-4 py-6 text-center text-base">
            Esta rotina ainda não foi concluída nenhuma vez aqui.
          </p>
        ) : (
          <ul className="divide-line divide-y">
            {historico.map((linha) => (
              <LinhaDoHistoricoNaTela key={linha.id} linha={linha} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * O estado antes de existir folha.
 *
 * Diz o que aconteceu da última vez ANTES do botão, e não depois: "ontem deu
 * 71%, com 2 pendências" é a informação que muda o jeito de responder o de
 * hoje. Depois do botão, ela seria lida por ninguém.
 */
function ParaComecar({
  rotina,
  periodo,
  podeResponder,
}: {
  rotina: RotinaDoDia;
  periodo: Periodo;
  podeResponder: boolean;
}) {
  return (
    <section className="bg-surface border-line rounded-lg border p-4">
      {rotina.status === "feita" ? (
        <p className="text-base">
          <span className="text-ok font-semibold">Já foi feito.</span>{" "}
          <span className="text-ink-2">
            A cobrança desta rotina já foi cumprida — a próxima é{" "}
            {dataPorExtenso.format(rotina.proxima)}.
          </span>
        </p>
      ) : (
        <p className="text-base">
          <span className="font-semibold">
            {rotina.status === "atrasada"
              ? "Esta rotina está atrasada."
              : "Ainda não foi respondida hoje."}
          </span>{" "}
          <span className="text-ink-2">
            {rotina.ultimaFechadaEm
              ? `A última vez foi em ${dataCurta.format(rotina.ultimaFechadaEm)}.`
              : "Ela nunca foi respondida nesta loja."}
          </span>
        </p>
      )}

      {podeResponder ? (
        <form action={executarRotinaAcao} className="mt-3">
          <input type="hidden" name="rotinaId" value={rotina.id} />
          <input type="hidden" name="periodo" value={periodo} />
          <Botao
            type="submit"
            peso={rotina.status === "feita" ? "secundario" : "primario"}
          >
            {rotina.status === "feita"
              ? "Responder mesmo assim"
              : "Começar a responder"}
          </Botao>
        </form>
      ) : (
        <p className="text-ink-3 mt-3 text-sm">
          Seu perfil permite acompanhar esta rotina, mas não respondê-la.
        </p>
      )}
    </section>
  );
}

function LinhaDoHistoricoNaTela({ linha }: { linha: LinhaDoHistorico }) {
  return (
    <li>
      <Link
        href={`/checklists/${linha.id}`}
        className="hover:bg-surface-2 focus-visible:outline-accent flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <span className="text-ink-3 w-14 flex-none text-sm tabular-nums">
          {dataCurta.format(linha.referencia)}
        </span>

        <span className="min-w-0 flex-1 text-base">
          {linha.pontuacao === null ? (
            <span className="text-ink-3">Sem nota — só itens de registro</span>
          ) : (
            <>
              <span
                className={`font-semibold tabular-nums ${corDaNota(linha.pontuacao)}`}
              >
                {linha.pontuacao.toLocaleString("pt-BR")}%
              </span>
              <span className="text-ink-3">
                {" "}
                · {linha.conformes} conformes · {linha.naoConformes} não
              </span>
            </>
          )}
        </span>

        {linha.pendencias > 0 && (
          <Etiqueta tom="aviso">
            {linha.pendencias}{" "}
            {linha.pendencias === 1 ? "pendência" : "pendências"}
          </Etiqueta>
        )}

        {linha.fechadaPor && (
          <span className="text-ink-3 hidden text-sm sm:block">
            {linha.fechadaPor}
          </span>
        )}

        <Icone
          nome="seta-direita"
          tamanho={14}
          className="text-ink-3 flex-none"
        />
      </Link>
    </li>
  );
}
