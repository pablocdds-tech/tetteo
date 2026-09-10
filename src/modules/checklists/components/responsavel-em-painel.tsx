"use client";

import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Icone } from "@/design-system/icones";
import { PainelLateral } from "@/design-system/painel-lateral";

import { alterarResponsavelAcao, type EstadoChecklist } from "../acoes";

export type Pessoa = { id: string; nome: string };

/** O valor que representa "de quem estiver de plantão". */
const PLANTAO = "";

/**
 * DE QUEM SE COBRA ESTA ROTINA.
 *
 * Um painel lateral, e não uma página de edição, por um motivo prático: trocar
 * o responsável da abertura é uma decisão de dez segundos, tomada olhando a
 * folha do dia. Tirar a pessoa da tela para isso faria com que ela perdesse o
 * lugar — e, na prática, com que ninguém trocasse nunca.
 *
 * O painel é o `<dialog>` do design system. Dele vêm de graça, e sem defeito:
 * o foco preso dentro, o Esc fechando, o fundo inerte para o leitor de tela e
 * o foco VOLTANDO para o botão "Alterar" ao fechar.
 *
 * O que este arquivo acrescenta:
 *
 *   • "de quem estiver de plantão" é uma ESCOLHA, na mesma lista das pessoas,
 *     e não a ausência de escolha. Ela tem significado — a lista aparece para
 *     todo mundo que pode responder — e precisa ser dizível.
 *
 *   • sair com a escolha mexida e não salva PERGUNTA antes. É a única edição
 *     desta tela que não salva sozinha, e um Esc distraído não pode desfazê-la
 *     em silêncio.
 *
 *   • o erro do servidor aparece DENTRO do painel, sem fechá-lo e sem perder
 *     o que foi escolhido.
 */
export function ResponsavelEmPainel({
  rotinaId,
  rotinaNome,
  atual,
  pessoas,
}: {
  rotinaId: string;
  rotinaNome: string;
  atual: Pessoa | null;
  pessoas: Pessoa[];
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState(atual?.id ?? PLANTAO);

  /**
   * O painel fecha DENTRO da ação, não num efeito que observa o resultado.
   *
   * A diferença não é de estilo. Fechar num `useEffect` que olha `estado.ok`
   * faz o React desenhar a tela uma vez com o painel ainda aberto e o sucesso
   * já dentro dele, e só então fechar — um piscar. Pior: um segundo sucesso
   * com a MESMA mensagem não mudaria a dependência do efeito, e o painel
   * ficaria aberto sem motivo aparente.
   *
   * Fechar é a consequência de um evento (gravou), e consequência de evento
   * mora no manipulador do evento.
   */
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    async (anterior, dados) => {
      const resultado = await alterarResponsavelAcao(anterior, dados);
      if (resultado.ok) setAberto(false);
      return resultado;
    },
    {},
  );

  const original = atual?.id ?? PLANTAO;
  const mudou = escolhido !== original;

  // Reabrir sempre parte do que está gravado agora, não do que a pessoa
  // rascunhou e abandonou da última vez.
  function abrir() {
    setEscolhido(original);
    setAberto(true);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-2 text-base">
          {atual ? (
            <>
              Responsável:{" "}
              <span className="text-ink font-semibold">{atual.nome}</span>
            </>
          ) : (
            <>
              Responsável:{" "}
              <span className="text-ink font-semibold">
                quem estiver de plantão
              </span>
            </>
          )}
        </span>

        <button
          type="button"
          onClick={abrir}
          className="text-accent hover:bg-accent-sub focus-visible:outline-accent inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-base font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Icone nome="pessoa" tamanho={15} />
          Alterar
        </button>
      </div>

      {estado.ok && (
        <p
          role="status"
          className="bg-ok-sub text-ok mt-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium"
        >
          <Icone nome="check" tamanho={14} />
          {estado.ok}
        </p>
      )}

      <PainelLateral
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo="Responsável pela rotina"
        apoio={rotinaNome}
        podeFechar={() =>
          !mudou ||
          window.confirm(
            "Você trocou o responsável e ainda não salvou. Sair agora descarta a troca.",
          )
        }
        rodape={
          <form action={acao} className="flex w-full items-center gap-2">
            <input type="hidden" name="rotinaId" value={rotinaId} />
            <input type="hidden" name="responsavelId" value={escolhido} />

            <span className="text-ink-3 mr-auto text-sm">
              {mudou ? "Alteração ainda não salva" : "Nada foi alterado"}
            </span>

            <Botao
              type="button"
              peso="secundario"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </Botao>
            <Botao type="submit" carregando={enviando} disabled={!mudou}>
              Salvar responsável
            </Botao>
          </form>
        }
      >
        {estado.erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad mb-4 rounded-md px-3 py-2 text-base"
          >
            {estado.erro}
          </p>
        )}

        <fieldset disabled={enviando}>
          <legend className="text-ink-2 mb-2 text-sm font-semibold">
            Quem responde por esta rotina nesta loja
          </legend>

          <div className="border-line divide-line divide-y rounded-md border">
            <OpcaoDePessoa
              valor={PLANTAO}
              rotulo="Quem estiver de plantão"
              apoio="A rotina aparece para toda a equipe que pode responder."
              escolhido={escolhido === PLANTAO}
              aoEscolher={setEscolhido}
            />

            {pessoas.map((pessoa) => (
              <OpcaoDePessoa
                key={pessoa.id}
                valor={pessoa.id}
                rotulo={pessoa.nome}
                apoio={pessoa.id === original ? "Responsável atual" : undefined}
                escolhido={escolhido === pessoa.id}
                aoEscolher={setEscolhido}
              />
            ))}
          </div>
        </fieldset>

        <p className="text-ink-3 mt-3 text-sm">
          A lista traz apenas quem tem acesso a esta loja. Trocar o responsável
          não altera nenhum checklist já respondido.
        </p>
      </PainelLateral>
    </>
  );
}

/**
 * Uma opção da lista.
 *
 * Radio de verdade por baixo: as setas do teclado andam entre as pessoas, o
 * grupo é anunciado como grupo, e a escolha é anunciada ao mudar. O visto à
 * direita é o sinal ALÉM da cor de fundo.
 */
function OpcaoDePessoa({
  valor,
  rotulo,
  apoio,
  escolhido,
  aoEscolher,
}: {
  valor: string;
  rotulo: string;
  apoio?: string;
  escolhido: boolean;
  aoEscolher: (valor: string) => void;
}) {
  return (
    <label
      className={`focus-within:outline-accent flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5 first:rounded-t-md last:rounded-b-md focus-within:outline-2 focus-within:-outline-offset-2 ${
        escolhido ? "bg-accent-sub" : "hover:bg-surface-2"
      }`}
    >
      <input
        type="radio"
        name="escolha-de-responsavel"
        value={valor}
        checked={escolhido}
        onChange={() => aoEscolher(valor)}
        className="sr-only"
      />

      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-base ${escolhido ? "font-semibold" : ""}`}
        >
          {rotulo}
        </span>
        {apoio && <span className="text-ink-3 block text-sm">{apoio}</span>}
      </span>

      {escolhido && (
        <span aria-hidden="true" className="text-accent flex-none">
          <Icone nome="check" tamanho={18} />
        </span>
      )}
    </label>
  );
}
