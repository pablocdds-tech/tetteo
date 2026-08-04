"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { salvarFornecedorAcao, type EstadoCompras } from "../acoes";

/**
 * O cadastro do fornecedor.
 *
 * Só o nome é obrigatório, e isso é uma decisão. Um cadastro que exige CNPJ
 * deixa de fora o hortifrúti da feira, que é metade da compra de uma pizzaria
 * — e um fornecedor fora do sistema é um preço que nunca entra na comparação.
 */
export function FormularioFornecedor({
  fornecedor,
}: {
  fornecedor?: {
    id: string;
    nome: string;
    documento: string | null;
    telefone: string | null;
    email: string | null;
    contato: string | null;
    prazoEntregaDias: number | null;
    condicaoPagamento: string | null;
    observacao: string | null;
  };
}) {
  const [estado, acao, enviando] = useActionState<EstadoCompras, FormData>(
    salvarFornecedorAcao,
    {},
  );

  return (
    <form action={acao} className="flex max-w-[640px] flex-col gap-4">
      {fornecedor && <input type="hidden" name="id" value={fornecedor.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          name="nome"
          defaultValue={fornecedor?.nome ?? ""}
          placeholder="Ex.: Distribuidora Bom Preço"
          erro={estado.erros?.nome}
          required
          autoFocus
        />
        <Campo
          rotulo="Quem atende"
          name="contato"
          defaultValue={fornecedor?.contato ?? ""}
          placeholder="Ex.: Marcos (vendedor)"
          erro={estado.erros?.contato}
          ajuda="O nome que você procura às seis da manhã."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Telefone"
          name="telefone"
          type="tel"
          defaultValue={fornecedor?.telefone ?? ""}
          placeholder="(11) 90000-0000"
          erro={estado.erros?.telefone}
        />
        <Campo
          rotulo="E-mail"
          name="email"
          type="email"
          defaultValue={fornecedor?.email ?? ""}
          erro={estado.erros?.email}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo
          rotulo="CNPJ ou CPF"
          name="documento"
          defaultValue={fornecedor?.documento ?? ""}
          erro={estado.erros?.documento}
          ajuda="Opcional — feira não tem nota."
        />
        <Campo
          rotulo="Entrega em (dias)"
          name="prazoEntregaDias"
          inputMode="numeric"
          defaultValue={fornecedor?.prazoEntregaDias?.toString() ?? ""}
          placeholder="2"
          erro={estado.erros?.prazoEntregaDias}
        />
        <Campo
          rotulo="Condição de pagamento"
          name="condicaoPagamento"
          defaultValue={fornecedor?.condicaoPagamento ?? ""}
          placeholder="Ex.: 28 dias"
          erro={estado.erros?.condicaoPagamento}
        />
      </div>

      <Campo
        rotulo="Observação"
        name="observacao"
        defaultValue={fornecedor?.observacao ?? ""}
        placeholder="Ex.: só entrega terça e sexta"
        erro={estado.erros?.observacao}
      />

      {estado.erro && (
        <p
          role="alert"
          className="bg-bad-sub text-bad rounded-md px-3 py-2 text-sm"
        >
          {estado.erro}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Botao type="submit" carregando={enviando}>
          {fornecedor ? "Salvar" : "Cadastrar"}
        </Botao>
        <Link href="/compras/fornecedores">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
