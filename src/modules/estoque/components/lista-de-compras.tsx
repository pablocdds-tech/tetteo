"use client";

import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useId,
  useRef,
  type FormEvent,
} from "react";

import { Botao } from "@/design-system/botao";
import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Icone } from "@/design-system/icones";
import { Vazio } from "@/design-system/vazio";
import { sigla } from "@/lib/unidades";

import type { EscolhaDeCompra } from "./rascunho-de-compras";

/**
 * A LISTA DE COMPRAS.
 *
 * O rascunho do pedido, montado a partir do que a despensa mostrou. Enquanto
 * está aqui, NÃO EXISTE no banco — é uma lista na memória da aba. Ela só vira
 * registro quando alguém clica em criar a cotação, e a tela diz isso em
 * palavras, porque uma lista que parece salva e não está é a forma mais barata
 * de perder o trabalho de meia hora.
 *
 * ---------------------------------------------------------------------------
 * A SUGESTÃO TEM DONO.
 *
 * Quando o sistema preenche uma quantidade, ele escreve embaixo de onde ela
 * saiu: "mínimo 20 kg − disponível 6 kg". Assim que a pessoa encosta no campo,
 * a origem some — porque a partir dali o número é dela, e continuar creditando
 * ao sistema seria mentira.
 *
 * Quando não há mínimo cadastrado ou nunca se contou o insumo, o campo entra
 * VAZIO. O sistema não tem base para sugerir, e um número inventado num campo
 * de compra vira pedido de verdade no fornecedor.
 * ---------------------------------------------------------------------------
 *
 * O BOTÃO FICA À VISTA. No computador a lista acompanha a rolagem, abaixo do
 * topo fixo, e só os itens rolam por dentro dela. Com quinze insumos na lista,
 * uma lista que crescesse junto empurraria "Criar cotação" para fora da tela
 * justamente quando ela está pronta.
 *
 * A ação de criar a cotação chega por PROPRIEDADE, não por importação: um App
 * nunca importa de outro App (a trava está no `eslint.config.mjs`). Quem junta
 * Estoque e Compras é a camada de rota, que pode conhecer os dois.
 */

export type EstadoDaCotacao = {
  erro?: string;
  /** Os insumos cujo campo de quantidade não passou. */
  invalidos?: string[];
  /** A cotação criada. A tela limpa o rascunho e vai até ela. */
  cotacaoId?: string;
};

export function ListaDeCompras({
  escolhas,
  podeCotar,
  acao,
  aoRemover,
  aoMudarQuantidade,
  aoLimpar,
}: {
  escolhas: readonly EscolhaDeCompra[];
  podeCotar: boolean;
  acao?: (estado: EstadoDaCotacao, dados: FormData) => Promise<EstadoDaCotacao>;
  aoRemover: (insumoId: string) => void;
  aoMudarQuantidade: (insumoId: string, quantidade: string) => void;
  aoLimpar: () => void;
}) {
  const idNome = useId();
  const idResumo = useId();

  const router = useRouter();

  // Um envio por vez. A trava é um ref, e não o `enviando`, porque ela precisa
  // valer JÁ no segundo clique de um duplo clique — antes de o React redesenhar
  // o botão como desabilitado. Duas cotações iguais em Compras é o tipo de erro
  // que só aparece quando alguém paga o fornecedor duas vezes.
  const emVoo = useRef(false);

  const [estado, despachar, enviando] = useActionState<
    EstadoDaCotacao,
    FormData
  >(async (anterior, dados) => {
    try {
      const resultado: EstadoDaCotacao = acao
        ? await acao(anterior, dados)
        : {};
      if (resultado.cotacaoId) {
        // Virou cotação: o rascunho cumpriu o papel. Deixá-lo na tela
        // convidaria a mandar a mesma lista de novo amanhã.
        aoLimpar();
        router.push(`/compras/cotacoes/${resultado.cotacaoId}`);
      }
      return resultado;
    } finally {
      emVoo.current = false;
    }
  }, {});

  /**
   * O envio sai pelo `onSubmit`, e não pelo `action` do formulário.
   *
   * Com `action`, o React LIMPA os campos não controlados assim que a ação
   * termina — inclusive quando ela volta com erro. O nome da cotação sumiria
   * justamente na hora em que a pessoa precisa corrigir outra coisa.
   */
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (emVoo.current) return;
    emVoo.current = true;
    const dados = new FormData(evento.currentTarget);
    startTransition(() => despachar(dados));
  }

  const invalidos = new Set(estado.invalidos ?? []);

  return (
    <Cartao
      como="section"
      className="desk:sticky desk:top-[calc(var(--shell-header,4rem)_+_1rem)] desk:flex desk:max-h-[calc(100dvh_-_var(--shell-header,4rem)_-_2rem)] desk:flex-col min-w-0 overflow-hidden"
    >
      <TituloDeSecao
        apoio="Rascunho — ainda não salvo"
        acao={
          escolhas.length > 0 ? (
            <Botao peso="fantasma" tamanho="pequeno" onClick={aoLimpar}>
              Esvaziar
            </Botao>
          ) : undefined
        }
      >
        Lista de compras
      </TituloDeSecao>

      {escolhas.length === 0 ? (
        <Vazio
          icone="carrinho"
          titulo="Nada na lista ainda"
          explicacao="Use Adicionar na tabela ao lado. Quem estiver abaixo do mínimo já entra com a quantidade que falta preenchida — e você pode mudar."
        />
      ) : (
        <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col">
          {/* O estado do React viaja como um campo só. É ele que o servidor
              lê e valida — o que está na tela nunca é a fonte da verdade. */}
          <input type="hidden" name="itens" value={JSON.stringify(escolhas)} />

          <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto">
            {escolhas.map((e) => (
              <ItemDaLista
                key={e.insumoId}
                escolha={e}
                invalido={invalidos.has(e.insumoId)}
                aoRemover={aoRemover}
                aoMudarQuantidade={aoMudarQuantidade}
              />
            ))}
          </ul>

          <div className="border-line flex flex-col gap-3 border-t p-4">
            <p
              id={idResumo}
              aria-live="polite"
              className="text-ink-3 text-xs leading-[18px] tabular-nums"
            >
              {escolhas.length} {escolhas.length === 1 ? "insumo" : "insumos"}{" "}
              na lista
            </p>

            {podeCotar && acao ? (
              <>
                <div className="flex w-full flex-col gap-1.5">
                  <label
                    htmlFor={idNome}
                    className="text-ink-2 text-sm font-semibold"
                  >
                    Nome da cotação
                  </label>
                  <input
                    id={idNome}
                    name="descricao"
                    required
                    maxLength={120}
                    placeholder="Ex.: Semana 37 — hortifrúti"
                    className="bg-surface border-line-2 text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-accent h-11 w-full rounded-md border px-3 text-base transition-[border-color,box-shadow] duration-150 focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none md:h-[42px] md:text-sm"
                  />
                  <span className="text-ink-3 text-xs leading-[18px]">
                    Até aqui nada foi gravado. A cotação nasce aberta em
                    Compras, com estes itens e estas quantidades.
                  </span>
                </div>

                {estado.erro && (
                  <p
                    role="alert"
                    className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm leading-5"
                  >
                    {estado.erro}
                  </p>
                )}

                <Botao type="submit" carregando={enviando}>
                  <Icone nome="carrinho" tamanho={15} />
                  Criar cotação em Compras
                </Botao>
              </>
            ) : (
              <p className="text-ink-3 text-xs leading-[18px]">
                Seu perfil não inclui criar cotações. A lista continua aqui para
                você conferir — para transformá-la num pedido, peça a quem cuida
                das compras.
              </p>
            )}
          </div>
        </form>
      )}
    </Cartao>
  );
}

function ItemDaLista({
  escolha,
  invalido,
  aoRemover,
  aoMudarQuantidade,
}: {
  escolha: EscolhaDeCompra;
  invalido: boolean;
  aoRemover: (insumoId: string) => void;
  aoMudarQuantidade: (insumoId: string, quantidade: string) => void;
}) {
  const id = useId();
  const idApoio = `${id}-apoio`;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <label
          htmlFor={id}
          className="text-ink min-w-0 text-sm leading-5 font-medium"
        >
          {escolha.nome}
        </label>

        <button
          type="button"
          onClick={() => aoRemover(escolha.insumoId)}
          aria-label={`Tirar ${escolha.nome} da lista de compras`}
          className="text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-accent -m-1.5 grid size-11 flex-none place-items-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 md:size-8"
        >
          <Icone nome="fechar" tamanho={14} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={id}
          value={escolha.quantidade}
          onChange={(ev) =>
            aoMudarQuantidade(escolha.insumoId, ev.target.value)
          }
          inputMode="decimal"
          placeholder="—"
          aria-invalid={invalido || undefined}
          aria-describedby={idApoio}
          className={`bg-surface text-ink placeholder:text-ink-3 h-11 w-full min-w-0 rounded-md border px-3 text-base tabular-nums transition-[border-color,box-shadow] duration-150 focus:outline-none md:h-[42px] md:text-sm ${
            invalido
              ? "border-bad focus:shadow-[0_0_0_3px_var(--bad-sub)]"
              : "border-line-2 hover:border-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-sub)]"
          }`}
        />
        <span className="text-ink-2 flex-none text-sm font-medium">
          {sigla(escolha.unidade)}
        </span>
      </div>

      <p
        id={idApoio}
        className={`text-xs leading-[18px] ${invalido ? "text-bad" : "text-ink-3"}`}
      >
        {invalido
          ? "Informe uma quantidade maior que zero, com vírgula nos decimais."
          : escolha.origem
            ? `Sugerido: ${escolha.origem}`
            : escolha.quantidade.trim() === ""
              ? "Sem sugestão do sistema — informe quanto comprar"
              : "Quantidade escolhida por você"}
      </p>
    </li>
  );
}
