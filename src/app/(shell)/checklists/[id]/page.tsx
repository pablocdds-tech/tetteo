import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { Botao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";
import { cancelarRespostaAcao } from "@/modules/checklists/acoes";
import { AvisoUnidade } from "@/modules/checklists/components/aviso-unidade";
import { FolhaDeChecklist } from "@/modules/checklists/components/folha-de-checklist";
import { paraLinha } from "@/modules/checklists/components/preparar-folha";
import { ResumoChecklist } from "@/modules/checklists/components/resumo-checklist";
import {
  obterResposta,
  type RespostaCompleta,
} from "@/modules/checklists/services/respostas";
import { nomesDeUsuarios } from "@/modules/checklists/services/rotinas";

const data = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/**
 * UMA RESPOSTA, SOZINHA NA TELA.
 *
 * O caminho normal para responder é a tela do dia (`/checklists`), onde a
 * folha aparece ao lado da fila e o contexto não se perde. Esta página
 * continua existindo para os dois casos em que não há fila nenhuma:
 *
 *   • o checklist AVULSO, aberto fora de qualquer rotina;
 *   • um checklist FECHADO aberto pelo histórico, que é só leitura.
 *
 * A casca (barra lateral e topo) continua em volta nos dois casos — abrir um
 * detalhe nunca troca a navegação do sistema por uma tela isolada.
 */
export default async function PaginaResposta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "checklists.ver")) notFound();

  if (!contexto.unidadeAtiva) {
    return (
      <div className="mx-auto w-full max-w-[var(--width-reading)]">
        <AvisoUnidade acao="Responder checklist" />
      </div>
    );
  }

  const { id } = await params;
  const resposta = await obterResposta(contexto, id);
  if (!resposta) notFound();

  const nomes = await nomesDeUsuarios(
    resposta.itens
      .map((i) => i.respondidoPorId)
      .filter((valor): valor is string => !!valor),
  );

  const linhas = resposta.itens.map((item) =>
    paraLinha(item, new Map([...nomes].map(([chave, u]) => [chave, u.nome]))),
  );

  const aberta = resposta.status === "ABERTA";
  const podeResponder = aberta && pode(contexto, "checklists.responder");

  return (
    <div className="mx-auto w-full max-w-[var(--width-reading)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/checklists"
            className="text-ink-3 hover:text-ink focus-visible:outline-accent inline-flex items-center gap-1 rounded-sm text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-3"
          >
            <Icone nome="seta-esquerda" tamanho={14} />
            Checklists
          </Link>
          <h1 className="mt-1 text-2xl leading-[30px] font-semibold tracking-tight md:text-3xl">
            {resposta.modelo.nome}
          </h1>
          <p className="text-ink-3 mt-1 text-base">
            {data.format(resposta.referencia)} · {contexto.unidadeAtiva.nome}
            {resposta.modelo.descricao ? ` · ${resposta.modelo.descricao}` : ""}
          </p>
        </div>

        {resposta.status === "FECHADA" && <Nota resposta={resposta} />}
      </div>

      {aberta && (
        <p className="border-line bg-surface-2 text-ink-2 mt-4 rounded-lg border px-4 py-3 text-base">
          Em andamento. Cada item é gravado assim que você marca. Ao concluir, o
          checklist congela e cada &quot;não&quot; vira uma pendência com dono —
          depois disso, não dá para editar.
        </p>
      )}

      <div className="mt-6">
        {aberta ? (
          <FolhaDeChecklist
            respostaId={resposta.id}
            rotinaId={resposta.rotinaId}
            periodo="hoje"
            linhas={linhas}
            podeResponder={podeResponder}
          />
        ) : (
          <ResumoChecklist linhas={linhas} pendencias={resposta.pendencias} />
        )}
      </div>

      {aberta && pode(contexto, "checklists.responder") && (
        <form action={cancelarRespostaAcao} className="mt-8">
          <input type="hidden" name="respostaId" value={resposta.id} />
          <Botao peso="fantasma" tamanho="pequeno" type="submit">
            Cancelar este checklist
          </Botao>
        </form>
      )}
    </div>
  );
}

function Nota({ resposta }: { resposta: RespostaCompleta }) {
  if (resposta.pontuacao === null) {
    return (
      <p className="text-ink-3 text-base">Sem nota — só itens de registro</p>
    );
  }

  const valor = Number(resposta.pontuacao);
  const cor = valor >= 90 ? "text-ok" : valor >= 70 ? "text-warn" : "text-bad";

  return (
    <div className="text-right">
      <span className={`block text-4xl font-semibold tabular-nums ${cor}`}>
        {valor.toLocaleString("pt-BR")}%
      </span>
      <span className="text-ink-3 block text-sm">
        {resposta.itensConformes} conformes · {resposta.itensNaoConformes} não
      </span>
    </div>
  );
}
