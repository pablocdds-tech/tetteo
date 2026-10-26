"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Campo } from "@/design-system/campo";
import { Botao } from "@/design-system/botao";
export type SalvarReferencia = (
  dados: FormData,
) => Promise<{ ok: boolean; mensagem: string; versao?: number }>;
export function ReferenciaForm({
  unidadeId,
  de,
  ate,
  totalInicial,
  versao,
  salvarAction,
}: {
  unidadeId: string;
  de: string;
  ate: string;
  totalInicial: string;
  versao: number;
  salvarAction: SalvarReferencia;
}) {
  const router = useRouter();
  const [edicao, setEdicao] = useState<{
    valor: string;
    versao: number;
  } | null>(null);
  const [resultado, setResultado] = useState<{
    ok: boolean;
    mensagem: string;
    versao?: number;
  } | null>(null);
  const [pendente, iniciar] = useTransition();
  const versaoAtual = Math.max(versao, resultado?.versao ?? 0);
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (pendente) return;
    const dados = new FormData(evento.currentTarget);
    iniciar(async () => {
      try {
        const resposta = await salvarAction(dados);
        setResultado(resposta);
        if (resposta.ok) {
          setEdicao(null);
          router.refresh();
        }
      } catch {
        setResultado({
          ok: false,
          mensagem:
            "Falha de conexão. Seu valor foi preservado; tente novamente.",
        });
      }
    });
  }
  return (
    <form
      onSubmit={enviar}
      data-edicao-pendente={edicao !== null ? "true" : "false"}
      className="mt-4 space-y-3"
    >
      <input type="hidden" name="unidadeId" value={unidadeId} />
      <input type="hidden" name="de" value={de} />
      <input type="hidden" name="ate" value={ate} />
      <input
        type="hidden"
        name="versao"
        value={edicao?.versao ?? versaoAtual}
      />
      <Campo
        rotulo="Total do relatório Saipos (R$)"
        name="total"
        inputMode="decimal"
        value={edicao?.valor ?? totalInicial}
        onChange={(e) =>
          setEdicao({
            valor: e.target.value,
            versao: edicao?.versao ?? versaoAtual,
          })
        }
        placeholder="10.457,38"
        required
        maxLength={32}
        disabled={pendente}
        ajuda="Mesmo período, mesma loja e vendas não canceladas. Informe o valor exibido no relatório; não o total da API."
      />
      <div className="flex flex-wrap gap-2">
        <Botao type="submit" carregando={pendente}>
          Salvar referência do relatório
        </Botao>
        {edicao && (
          <Botao
            type="button"
            peso="secundario"
            disabled={pendente}
            onClick={() => {
              setEdicao(null);
              setResultado(null);
              router.refresh();
            }}
          >
            Carregar referência atual
          </Botao>
        )}
      </div>
      {resultado && (
        <p
          role={resultado.ok ? "status" : "alert"}
          className={resultado.ok ? "text-ok text-sm" : "text-bad text-sm"}
        >
          {resultado.mensagem}
        </p>
      )}
    </form>
  );
}
