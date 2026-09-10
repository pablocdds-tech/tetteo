/**
 * O ESQUELETO DE CARREGAMENTO.
 *
 * Ocupa aproximadamente o espaço do conteúdo que está vindo. É por isso que
 * ele existe: não para entreter, mas para a página não PULAR quando o dado
 * chega. Um giro no meio da tela some e empurra tudo; um esqueleto do tamanho
 * certo é substituído no lugar, e o olho já está onde precisa estar.
 *
 * Nunca cobre a tela inteira. Se o cabeçalho e o menu já podem ser desenhados,
 * eles são desenhados — piscar a casca a cada navegação desfaz a sensação de
 * sistema e faz cada clique parecer um recarregamento.
 *
 * A animação morre sozinha em `prefers-reduced-motion` pela regra global do
 * globals.css. Para quem sente enjoo com movimento, uma tela inteira de blocos
 * pulsando é o pior tipo de espera.
 */
export function Esqueleto({
  className = "",
  arredondado = "sm",
}: {
  className?: string;
  arredondado?: "sm" | "md" | "lg" | "cheio";
}) {
  const raio = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    cheio: "rounded-full",
  }[arredondado];

  return (
    <span
      aria-hidden="true"
      className={`bg-surface-3 block animate-pulse ${raio} ${className}`}
    />
  );
}

/**
 * Linhas de tabela em carregamento.
 *
 * `aria-hidden` no bloco todo e um aviso de texto ao lado: quem usa leitor de
 * tela precisa ouvir "carregando", não dezoito retângulos.
 */
export function LinhasCarregando({ linhas = 5 }: { linhas?: number }) {
  return (
    <div>
      <span className="sr-only" role="status">
        Carregando os dados.
      </span>
      <div aria-hidden="true" className="divide-line divide-y">
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Esqueleto className="h-4 flex-1" />
            <Esqueleto className="h-4 w-24" />
            <Esqueleto className="h-4 w-20" />
            <Esqueleto className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
