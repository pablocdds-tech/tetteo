/**
 * O que aparece quando o usuário está vendo a REDE e abre Compras.
 *
 * Preço é local. O hortifrúti que entrega no Centro não é o mesmo que entrega
 * na Zona Sul, e o frete muda com o endereço — uma cotação de rede esconderia
 * justamente a diferença que faz a cotação valer a pena.
 */
export function AvisoUnidade({ acao }: { acao: string }) {
  return (
    <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <p aria-hidden className="text-2xl opacity-50">
        🏪
      </p>
      <p className="mt-2 font-semibold">Escolha uma unidade primeiro</p>
      <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
        {acao} é coisa de loja: o caminhão entrega num endereço, o frete muda
        com a distância e o preço do hortifrúti muda com o bairro. Use o seletor
        no topo para escolher em qual unidade você está.
      </p>
    </div>
  );
}
