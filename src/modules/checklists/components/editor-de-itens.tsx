"use client";

import { useActionState, useRef, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import {
  adicionarItemAcao,
  atualizarItemAcao,
  moverItemAcao,
  removerItemAcao,
  type EstadoChecklist,
} from "../acoes";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

export type ItemDoModelo = {
  id: string;
  texto: string;
  secao: string | null;
  tipo: "SIM_NAO" | "NUMERO" | "TEXTO" | "SELECAO_UNICA" | "MULTIPLA_ESCOLHA";
  obrigatorio: boolean;
  exigeObservacaoSeNao: boolean;
  exigeFoto: boolean;
  exigeVideo: boolean;
  analisarIA: boolean;
  criterioIA: string | null;
  opcoes: string[];
  rotuloUnidade: string | null;
  minimo: string | null;
  maximo: string | null;
};

const NOME_DO_TIPO = {
  SIM_NAO: "Sim / Não",
  NUMERO: "Número",
  TEXTO: "Texto livre",
  SELECAO_UNICA: "Seleção única",
  MULTIPLA_ESCOLHA: "Caixas de seleção",
} as const;

/**
 * AS PERGUNTAS DO MODELO.
 *
 * A ordem importa mais do que parece: ela é o caminho que a pessoa faz dentro
 * da loja. Um checklist que pula do banheiro para a câmara fria e volta para o
 * banheiro faz alguém andar três vezes o mesmo corredor às sete da manhã — e
 * checklist que cansa é checklist que passa a ser preenchido de memória, no
 * fim do turno, sem ninguém ter olhado nada.
 *
 * Por isso o bloco ("Cozinha", "Salão") e as setas de subir/descer estão aqui,
 * e não escondidos numa tela de configuração avançada.
 */
export function EditorDeItens({
  modeloId,
  itens,
}: {
  modeloId: string;
  itens: ItemDoModelo[];
}) {
  const [tipo, setTipo] = useState<ItemDoModelo["tipo"]>("SIM_NAO");
  const [analisarIA, setAnalisarIA] = useState(false);
  const [editando, setEditando] = useState<ItemDoModelo | null>(null);
  const [versaoFormulario, setVersaoFormulario] = useState(0);
  const formulario = useRef<HTMLFormElement>(null);
  const [estado, acao, enviando] = useActionState<EstadoChecklist, FormData>(
    async (anterior, dados) => {
      const resultado = await (dados.get("itemId")
        ? atualizarItemAcao(anterior, dados)
        : adicionarItemAcao(anterior, dados));
      if (resultado.ok) {
        setEditando(null);
        setTipo("SIM_NAO");
        setAnalisarIA(false);
        setVersaoFormulario((versao) => versao + 1);
      }
      return resultado;
    },
    {},
  );

  // Sugere o bloco do último item: quem escreve a seção "Cozinha" costuma
  // escrever mais cinco perguntas de cozinha em seguida.
  const ultimaSecao = itens.at(-1)?.secao ?? "";

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="font-semibold">Perguntas</h2>
        <p className="text-ink-3 mt-1 text-sm">
          Na ordem em que se anda pela loja. Quem responde vai de cima para
          baixo sem voltar atrás.
        </p>

        {itens.length === 0 ? (
          <p className="border-line-2 text-ink-3 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
            Nenhuma pergunta ainda. Comece pela primeira coisa que se faz ao
            chegar na loja.
          </p>
        ) : (
          <div className="border-line divide-line mt-3 divide-y rounded-xl border">
            {itens.map((item, indice) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
              >
                <span className="text-ink-3 w-6 text-xs tabular-nums">
                  {indice + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {item.texto}
                    {!item.obrigatorio && (
                      <span className="text-ink-3 font-normal">
                        {" "}
                        (opcional)
                      </span>
                    )}
                  </span>
                  <span className="text-ink-3 block text-xs">
                    {item.secao ? `${item.secao} · ` : ""}
                    {NOME_DO_TIPO[item.tipo]}
                    {item.tipo === "NUMERO" &&
                      (item.minimo || item.maximo) &&
                      ` · aceitável ${faixaEmTexto(item)}`}
                    {item.exigeFoto && " · pede foto"}
                    {item.exigeVideo && " · pede vídeo"}
                    {item.analisarIA && " · conferência por IA"}
                  </span>
                </div>

                <div className="flex items-center gap-0.5">
                  <Botao
                    type="button"
                    peso="fantasma"
                    tamanho="pequeno"
                    onClick={() => {
                      setEditando(item);
                      setTipo(item.tipo);
                      setAnalisarIA(item.analisarIA);
                      requestAnimationFrame(() =>
                        formulario.current
                          ?.querySelector<HTMLInputElement>(
                            'input[name="texto"]',
                          )
                          ?.focus(),
                      );
                    }}
                  >
                    Configurar
                  </Botao>
                  <form action={moverItemAcao}>
                    <input type="hidden" name="modeloId" value={modeloId} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="direcao" value="cima" />
                    <Botao
                      peso="fantasma"
                      tamanho="pequeno"
                      type="submit"
                      disabled={indice === 0}
                      aria-label="Subir"
                    >
                      ↑
                    </Botao>
                  </form>
                  <form action={moverItemAcao}>
                    <input type="hidden" name="modeloId" value={modeloId} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="direcao" value="baixo" />
                    <Botao
                      peso="fantasma"
                      tamanho="pequeno"
                      type="submit"
                      disabled={indice === itens.length - 1}
                      aria-label="Descer"
                    >
                      ↓
                    </Botao>
                  </form>
                  <form action={removerItemAcao}>
                    <input type="hidden" name="modeloId" value={modeloId} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <Botao peso="fantasma" tamanho="pequeno" type="submit">
                      Remover
                    </Botao>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {estado.ok && (
        <p
          role="status"
          className="bg-ok-sub text-ok rounded-md px-3 py-2 text-sm"
        >
          {estado.ok}
        </p>
      )}
      <form
        key={`${editando?.id ?? "novo"}:${versaoFormulario}`}
        ref={formulario}
        onReset={(evento) => evento.preventDefault()}
        action={acao}
        className="border-line bg-surface-2 flex flex-col gap-4 rounded-xl border p-4"
      >
        <input type="hidden" name="modeloId" value={modeloId} />
        {editando && <input type="hidden" name="itemId" value={editando.id} />}

        <h3 className="font-semibold">
          {editando ? "Configurar pergunta" : "Nova pergunta"}
        </h3>

        <Campo
          rotulo="A pergunta"
          name="texto"
          defaultValue={editando?.texto ?? ""}
          placeholder="Ex.: A câmara fria está limpa e organizada?"
          erro={estado.erros?.texto}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Bloco"
            name="secao"
            defaultValue={editando?.secao ?? ultimaSecao}
            placeholder="Ex.: Cozinha"
            erro={estado.erros?.secao}
            ajuda="Opcional. Agrupa as perguntas na tela."
          />

          <div className="flex w-full flex-col gap-1.5">
            <label htmlFor="tipo" className="text-ink-2 text-sm font-semibold">
              Tipo de resposta
            </label>
            <select
              id="tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as ItemDoModelo["tipo"])}
              className={ESTILO_SELECT}
            >
              <option value="SIM_NAO">Sim / Não</option>
              <option value="NUMERO">Número (temperatura, peso…)</option>
              <option value="TEXTO">Texto livre</option>
              <option value="SELECAO_UNICA">Escolher uma opção</option>
              <option value="MULTIPLA_ESCOLHA">
                Caixas de seleção (várias opções)
              </option>
            </select>
          </div>
        </div>

        {(tipo === "SELECAO_UNICA" || tipo === "MULTIPLA_ESCOLHA") && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="opcoes"
              className="text-ink-2 text-sm font-semibold"
            >
              Opções, uma por linha
            </label>
            <textarea
              id="opcoes"
              name="opcoes"
              required
              rows={4}
              maxLength={3100}
              defaultValue={editando?.opcoes.join("\n") ?? ""}
              placeholder={"Bancadas\nEquipamentos\nPiso"}
              className={`${ESTILO_SELECT} h-auto py-2`}
            />
            {estado.erros?.opcoes && (
              <p role="alert" className="text-bad text-sm">
                {estado.erros.opcoes}
              </p>
            )}
          </div>
        )}

        {tipo === "NUMERO" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              rotulo="Unidade"
              name="rotuloUnidade"
              defaultValue={editando?.rotuloUnidade ?? ""}
              placeholder="°C"
              erro={estado.erros?.rotuloUnidade}
            />
            <Campo
              rotulo="Mínimo aceitável"
              name="minimo"
              defaultValue={editando?.minimo ?? ""}
              inputMode="decimal"
              erro={estado.erros?.minimo}
            />
            <Campo
              rotulo="Máximo aceitável"
              name="maximo"
              defaultValue={editando?.maximo ?? ""}
              inputMode="decimal"
              erro={estado.erros?.maximo}
              ajuda="Fora da faixa vira não conformidade sozinho."
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="obrigatorio"
              defaultChecked={editando?.obrigatorio ?? true}
              className="accent-accent size-4"
            />
            Obrigatório — não deixa fechar o checklist em branco
          </label>

          {(tipo === "SIM_NAO" || tipo === "NUMERO") && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="exigeObservacaoSeNao"
                defaultChecked={editando?.exigeObservacaoSeNao ?? true}
                className="accent-accent size-4"
              />
              {tipo === "NUMERO"
                ? "Leitura fora da faixa exige escrever o que houve"
                : "Responder “Não” exige escrever o que houve"}
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="exigeFoto"
              defaultChecked={editando?.exigeFoto ?? false}
              className="accent-accent size-4"
            />
            Exigir foto para concluir
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="exigeVideo"
              defaultChecked={editando?.exigeVideo ?? false}
              className="accent-accent size-4"
            />
            Exigir vídeo para concluir
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="analisarIA"
              checked={analisarIA}
              onChange={(e) => setAnalisarIA(e.target.checked)}
              className="accent-accent size-4"
            />
            Conferir resposta e evidências com IA
          </label>
        </div>

        {analisarIA && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="criterioIA"
              className="text-ink-2 text-sm font-semibold"
            >
              O que a IA deve conferir?
            </label>
            <textarea
              id="criterioIA"
              name="criterioIA"
              required
              rows={3}
              maxLength={2000}
              defaultValue={editando?.criterioIA ?? ""}
              placeholder="Ex.: Verificar se a foto mostra a bancada sem resíduos e se a descrição explica a limpeza realizada."
              className={`${ESTILO_SELECT} h-auto py-2`}
            />
            <p className="text-ink-3 text-sm">
              Descreva critérios observáveis. Evidência insuficiente fica para
              revisão do gestor.
            </p>
            {estado.erros?.criterioIA && (
              <p role="alert" className="text-bad text-sm">
                {estado.erros.criterioIA}
              </p>
            )}
          </div>
        )}

        {estado.erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
          >
            {estado.erro}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Botao type="submit" peso="secundario" carregando={enviando}>
            {editando ? "Salvar configuração" : "Adicionar pergunta"}
          </Botao>
          {editando && (
            <Botao
              type="button"
              peso="fantasma"
              onClick={() => {
                setEditando(null);
                setTipo("SIM_NAO");
                setAnalisarIA(false);
              }}
            >
              Cancelar edição
            </Botao>
          )}
        </div>
      </form>
    </div>
  );
}

function faixaEmTexto(item: ItemDoModelo) {
  const unidade = item.rotuloUnidade ? ` ${item.rotuloUnidade}` : "";
  if (item.minimo && item.maximo)
    return `${item.minimo} a ${item.maximo}${unidade}`;
  if (item.minimo) return `a partir de ${item.minimo}${unidade}`;
  return `até ${item.maximo}${unidade}`;
}
