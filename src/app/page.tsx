/**
 * Página provisória — Fase 0.
 *
 * Existe só para confirmar que os tokens do Design System estão aplicados e
 * que os dois temas funcionam. Será substituída pela Home (o lançador de Apps)
 * quando a casca do Core for construída.
 */

const TOKENS = [
  { nome: "paper", classe: "bg-paper" },
  { nome: "surface", classe: "bg-surface" },
  { nome: "surface-2", classe: "bg-surface-2" },
  { nome: "surface-3", classe: "bg-surface-3" },
  { nome: "line", classe: "bg-line" },
  { nome: "line-2", classe: "bg-line-2" },
  { nome: "ink-3", classe: "bg-ink-3" },
  { nome: "ink-2", classe: "bg-ink-2" },
  { nome: "ink", classe: "bg-ink" },
  { nome: "accent", classe: "bg-accent" },
  { nome: "ok", classe: "bg-ok" },
  { nome: "warn", classe: "bg-warn" },
  { nome: "bad", classe: "bg-bad" },
  { nome: "info", classe: "bg-info" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-20">
      <div className="flex items-center gap-3">
        <span className="bg-accent text-accent-ink grid size-9 place-items-center rounded-md text-lg font-bold">
          T
        </span>
        <span className="text-2xl font-semibold tracking-tight">Tetteo</span>
      </div>

      <p className="text-ink-2 mt-4 max-w-md">
        Sistema operacional da Vitaliano Pizzaria.
      </p>

      <div className="border-line bg-surface mt-10 rounded-lg border p-5">
        <p className="text-ink-3 font-mono text-xs tracking-widest uppercase">
          Fase 0 · Componente 1
        </p>
        <p className="mt-2 font-semibold">Repositório e esqueleto</p>
        <p className="text-ink-2 mt-1 text-sm">
          Estrutura de pastas, tokens do Design System e travas de importação no
          linter. Sem banco, sem login e sem telas — cada um é um componente
          próprio, na sequência.
        </p>
      </div>

      <p className="text-ink-3 mt-10 font-mono text-xs tracking-widest uppercase">
        Tokens de cor
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TOKENS.map((token) => (
          <div
            key={token.nome}
            className="border-line overflow-hidden rounded-md border"
          >
            <div className={`h-10 ${token.classe}`} />
            <div className="bg-surface text-ink-3 px-2 py-1.5 font-mono text-xs">
              {token.nome}
            </div>
          </div>
        ))}
      </div>

      <p className="text-ink-2 mt-6 text-sm">
        Os dois temas estão desenhados. Troque o modo claro/escuro do Windows e
        a página acompanha — nenhum é a inversão automática do outro.
      </p>
    </main>
  );
}
