"use client";

import { useFormStatus } from "react-dom";

import { Botao } from "@/design-system/botao";

/**
 * UM BOTÃO QUE DESFAZ ALGO — e por isso pergunta antes.
 *
 * Serve às duas ações do detalhe que tiram algo da tela: remover uma rotina
 * da loja e cancelar o checklist em andamento. Cancelar não tem volta: as
 * respostas gravadas deixam de valer. Remover tem, mas não à vista — é preciso
 * agendar o mesmo checklist de novo. Nas duas, um toque errado custa trabalho
 * de alguém, e a pergunta diz qual.
 *
 * A pergunta é a do navegador (`confirm`), e não um modal desenhado aqui. Ela
 * já prende o foco, responde ao Esc e ao Enter, é lida pelo leitor de tela e
 * funciona igual no celular — e aparece raramente o bastante para não valer
 * um componente próprio.
 *
 * O botão trava enquanto o pedido está no ar (`useFormStatus`). Dois toques
 * seguidos num celular lento seriam dois pedidos, e o segundo cairia num
 * registro que o primeiro já mudou.
 */
export function AcaoComConfirmacao({
  acao,
  campos,
  pergunta,
  children,
}: {
  acao: (dados: FormData) => Promise<void>;
  /** Os campos escondidos que a ação lê: `{ rotinaId, periodo }`. */
  campos: Record<string, string>;
  /** Diz O QUE vai acontecer e o que NÃO tem volta. */
  pergunta: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={acao}
      onSubmit={(evento) => {
        if (!window.confirm(pergunta)) evento.preventDefault();
      }}
    >
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      <BotaoDeEnvio>{children}</BotaoDeEnvio>
    </form>
  );
}

function BotaoDeEnvio({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" peso="fantasma" tamanho="pequeno" carregando={pending}>
      {children}
    </Botao>
  );
}
