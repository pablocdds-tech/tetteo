import Link from "next/link";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { APPS_REGISTRADOS } from "@/registro-de-apps";

/**
 * A HOME — o lançador de Apps.
 *
 * Responde duas perguntas: "o que precisa de mim agora?" e "para onde eu vou?".
 *
 * Regra que quero cravar desde já: a Home NUNCA vira o "App de tudo". Toda vez
 * que alguém quiser adicionar mais um número aqui, a resposta padrão é "isso
 * mora no App X". Sem essa disciplina, em um ano é um painel poluído que
 * ninguém lê.
 */

function saudacao(hora: number) {
  if (hora < 5) return { texto: "Boa madrugada", icone: "🌙" };
  if (hora < 12) return { texto: "Bom dia", icone: "☀️" };
  if (hora < 18) return { texto: "Boa tarde", icone: "🌤️" };
  return { texto: "Boa noite", icone: "🌙" };
}

export default async function Home() {
  const contexto = await obterContexto();
  if (!contexto) return null;

  const agora = new Date();
  const { texto, icone } = saudacao(
    Number(
      new Intl.DateTimeFormat("pt-BR", {
        hour: "numeric",
        hour12: false,
        timeZone: "America/Sao_Paulo",
      }).format(agora),
    ),
  );

  const dataPorExtenso = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(agora);

  const visiveis = APPS_REGISTRADOS.filter((app) => {
    if (app.emConstrucao && !contexto.ehDiretor) return false;
    return pode(contexto, app.permissaoParaVer);
  });

  const primeiroNome = contexto.usuario.nome.split(/\s+/)[0];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {texto}, {primeiroNome} {icone}
      </h1>
      <p className="text-ink-3 mt-1 text-sm">
        {dataPorExtenso} ·{" "}
        {contexto.unidadeAtiva
          ? contexto.unidadeAtiva.nome
          : `Rede Completa — ${contexto.unidadesVisiveis.length} ${
              contexto.unidadesVisiveis.length === 1 ? "unidade" : "unidades"
            }`}
      </p>

      <p className="text-ink-3 mt-8 font-mono text-xs tracking-[0.12em] uppercase">
        Seus Apps
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visiveis.map((app) => (
          <Link
            key={app.chave}
            href={app.rota}
            className={[
              "bg-surface border-line group flex flex-col gap-2.5 rounded-xl border p-4",
              "transition-[transform,box-shadow,border-color] duration-150",
              "hover:border-line-2 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]",
              "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
              app.emConstrucao ? "opacity-60" : "",
            ].join(" ")}
          >
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-xl text-lg"
              style={{ background: app.cor.fundo, color: app.cor.frente }}
            >
              {app.icone}
            </span>

            <span className="flex items-center gap-1.5">
              <span className="text-sm leading-tight font-semibold">
                {app.nome}
              </span>
              {app.emConstrucao && (
                <span className="bg-surface-3 text-ink-3 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                  em breve
                </span>
              )}
            </span>

            {/* O subtítulo não é enfeite: é o que elimina a dúvida de "onde eu
                clico para fazer X". Descreve tarefa, não categoria. */}
            <span className="text-ink-3 text-xs leading-snug">
              {app.subtitulo}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
