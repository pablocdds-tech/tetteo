import Link from "next/link";
import { Etiqueta } from "@/design-system/etiqueta";
import type { PainelNotas } from "../services/notas-autorizacao";
import { PessoaAutorizacaoNotas } from "./pessoas-notas";
import { formatarTelefone } from "../schemas/telefone-notas";

export function PainelDeNotas({ dados }: { dados: PainelNotas }) {
  const autorizadas = dados.pessoas.filter(
    (p) => p.autorizada && p.elegivel,
  ).length;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Notas pelo WhatsApp
        </h1>
        <p className="text-ink-3 mt-1">
          Número receptor, agente e pessoas autorizadas de {dados.unidade}.
        </p>
      </header>
      <section
        aria-labelledby="numero-notas"
        className="border-line bg-surface rounded-xl border p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="numero-notas" className="text-ink-2 font-medium">
            Envie as notas para este número
          </h2>
          <Etiqueta tom={dados.conexao.pronta ? "ok" : "aviso"}>
            {dados.conexao.pronta
              ? "WhatsApp conectado"
              : "Configuração pendente"}
          </Etiqueta>
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {dados.conexao.numero
            ? formatarTelefone(dados.conexao.numero)
            : "Número não disponível"}
        </p>
        <p className="text-ink-3 mt-2 text-sm">
          WhatsApp interno da equipe · Unidade {dados.unidade}
        </p>
        {dados.conexao.motivo ? (
          <p role="status" className="text-ink-2 mt-3">
            {dados.conexao.motivo}
          </p>
        ) : null}
        <Link
          href="/assistente/equipe/whatsapp"
          className="text-accent mt-3 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
        >
          Ver conexão do WhatsApp
        </Link>
      </section>
      <section
        aria-labelledby="agente-notas"
        className="border-line border-b pb-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="agente-notas" className="text-lg font-semibold">
            Severina · Agente de notas
          </h2>
          <Etiqueta tom="neutro">Confirmação obrigatória</Etiqueta>
        </div>
        <p className="text-ink-2 mt-2 max-w-3xl">
          Lê XML, PDF e fotos, confere fornecedor, itens e pagamento com você e
          prepara a entrada. Os cadastros e os lançamentos no Financeiro e no
          Estoque acontecem depois da sua confirmação.
        </p>
        <ol className="text-ink-2 mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <li>
            <span className="font-semibold">1. Envie o documento</span>
            <p className="text-ink-3 mt-1">
              Use um dos números autorizados abaixo.
            </p>
          </li>
          <li>
            <span className="font-semibold">2. Confira a nota</span>
            <p className="text-ink-3 mt-1">
              Revise os dados, vínculos e pagamento.
            </p>
          </li>
          <li>
            <span className="font-semibold">3. Confirme o resumo</span>
            <p className="text-ink-3 mt-1">
              Responda <strong>OK</strong> seguido do código recebido na mesma
              conversa.
            </p>
          </li>
        </ol>
        <p className="text-ink-3 mt-4 text-sm">
          Nas fotos, o Gemini lê a nota inteira primeiro. O QR Code fica como
          último recurso; a consulta externa continua desativada.{" "}
          <Link
            href="/assistente/configuracao"
            className="text-accent underline underline-offset-4"
          >
            Ver configuração da leitura por IA
          </Link>
        </p>
      </section>
      <section aria-labelledby="pessoas-notas">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pessoas-notas" className="text-lg font-semibold">
            Pessoas autorizadas para notas
          </h2>
          <p className="text-ink-3 text-sm">
            {autorizadas}{" "}
            {autorizadas === 1 ? "pessoa liberada" : "pessoas liberadas"}
          </p>
        </div>
        <p className="text-ink-3 mt-2 max-w-3xl text-sm">
          Esta liberação permite enviar e confirmar notas nesta unidade. Receber
          avisos é uma autorização separada. O usuário também precisa de acesso
          ao Estoque e ao Financeiro.
        </p>
        {dados.pessoas.length ? (
          <ul className="border-line bg-surface mt-5 rounded-xl border p-5 sm:p-6">
            {dados.pessoas.map((p) => (
              <PessoaAutorizacaoNotas
                key={p.id}
                pessoa={p}
                podeAutorizar={dados.podeAutorizar}
                unidadeId={dados.unidadeId}
              />
            ))}
          </ul>
        ) : (
          <div className="border-line mt-5 rounded-xl border border-dashed p-6">
            <p>Nenhum número vinculado disponível nesta unidade.</p>
            <p className="text-ink-3 mt-1 text-sm">
              Vincule o telefone a um usuário da equipe antes de autorizar
              notas.
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            href="/assistente/equipe/vinculos"
            className="text-accent inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            Gerenciar pessoas e números
          </Link>
          {!dados.podeAutorizar ? (
            <p className="text-ink-3 text-sm">
              Um responsável com permissão de autorizar notas pode alterar estas
              liberações.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
