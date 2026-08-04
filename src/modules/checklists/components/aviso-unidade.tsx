/**
 * O que aparece quando o usuário está vendo a REDE e abre os Checklists.
 *
 * Não é um erro — é uma pergunta. Checklist é presencial: a rede não abre a
 * porta às 7h nem confere a temperatura da câmara. Quem faz isso é uma pessoa,
 * num endereço.
 */
export function AvisoUnidade({ acao }: { acao: string }) {
  return (
    <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <p aria-hidden className="text-2xl opacity-50">
        🏪
      </p>
      <p className="mt-2 font-semibold">Escolha uma unidade primeiro</p>
      <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
        {acao} acontece dentro de uma loja: é uma pessoa que abre a porta,
        confere a câmara fria e assina embaixo. Use o seletor no topo da tela
        para escolher em qual unidade você está.
      </p>
    </div>
  );
}
