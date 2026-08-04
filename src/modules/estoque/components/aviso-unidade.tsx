/**
 * O que aparece quando o usuário está vendo a REDE e abre o Estoque.
 *
 * Não é um erro — é uma pergunta. Estoque é físico: a rede não tem câmara
 * fria, e "contar a rede" não significa nada. Em vez de mostrar uma tela vazia
 * ou um aviso técnico, a tela explica o porquê e diz onde clicar.
 */
export function AvisoUnidade({ acao }: { acao: string }) {
  return (
    <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <p aria-hidden className="text-2xl opacity-50">
        🏪
      </p>
      <p className="mt-2 font-semibold">Escolha uma unidade primeiro</p>
      <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
        {acao} é coisa de loja, não de rede: a farinha que está na câmara fria
        de uma unidade não vira pizza na outra. Use o seletor no topo da tela
        para escolher em qual unidade você está.
      </p>
    </div>
  );
}
