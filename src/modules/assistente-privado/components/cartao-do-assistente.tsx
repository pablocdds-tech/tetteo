import { Cartao, TituloDeSecao } from "@/design-system/cartao";
import { Etiqueta } from "@/design-system/etiqueta";

import type { DadosDoCartao, LinhaDoCartao } from "../schemas/cartao";

/**
 * O CARTÃO DO ASSISTENTE PRIVADO NO PAINEL.
 *
 * Quatro perguntas, uma por linha: está ligado? o que fez por último? o que
 * vem agora? o que espera você? O estado é sempre etiqueta — ponto e palavra,
 * nunca só cor. As frases vêm prontas de `montarCartao`; aqui só se desenha.
 */
export function CartaoDoAssistente({ cartao }: { cartao: DadosDoCartao }) {
  return (
    <Cartao como="section" className="min-w-0">
      <TituloDeSecao
        apoio={
          cartao.demonstracao
            ? "OpenClaw na VPS · dados de demonstração"
            : "OpenClaw na VPS"
        }
      >
        Assistente privado
      </TituloDeSecao>
      <dl className="divide-line divide-y">
        <Linha linha={cartao.conexao} />
        <Linha linha={cartao.ultimaExecucao} />
        <Linha linha={cartao.proximaRotina} />
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5 text-sm leading-5">
          <dt className="text-ink-3">Pendências</dt>
          <dd className="min-w-0">
            {cartao.pendencias.length === 0 ? (
              <span className="text-ink-2">Nenhuma</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {cartao.pendencias.map((p) => (
                  <li key={p} className="text-ink break-words">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </Cartao>
  );
}

function Linha({ linha }: { linha: LinhaDoCartao }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 px-4 py-2.5 text-sm leading-5">
      <dt className="text-ink-3">{linha.rotulo}</dt>
      <dd className="min-w-0">
        <Etiqueta tom={linha.tom}>{linha.texto}</Etiqueta>
        {linha.apoio && (
          <p className="text-ink-3 mt-1 text-xs leading-[18px] break-words">
            {linha.apoio}
          </p>
        )}
      </dd>
    </div>
  );
}
