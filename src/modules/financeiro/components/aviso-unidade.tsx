/**
 * O que aparece quando o usuário está vendo a REDE e abre o Financeiro.
 *
 * Caixa é físico. A gaveta fica num endereço, o boleto vence no CNPJ de uma
 * loja, e um saldo somado da rede não paga a conta de luz de nenhuma delas.
 */
export function AvisoUnidade({ acao }: { acao: string }) {
  return (
    <div className="border-line-2 bg-surface-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <p aria-hidden className="text-2xl opacity-50">
        🏪
      </p>
      <p className="mt-2 font-semibold">Escolha uma unidade primeiro</p>
      <p className="text-ink-3 mx-auto mt-1 max-w-md text-sm">
        {acao} é de loja: a gaveta do caixa fica num endereço e o boleto vence
        no CNPJ de uma unidade. Um saldo somado da rede não paga a conta de luz
        de nenhuma delas. Use o seletor no topo para escolher onde você está.
      </p>
    </div>
  );
}
