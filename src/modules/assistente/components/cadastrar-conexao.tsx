"use client";

import { useActionState, useId } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { cadastrarConexaoAcao } from "../acoes";

/**
 * CADASTRAR A CONEXÃO QUE JÁ EXISTE.
 *
 * O Tetteo não cria instância na Evolution, não pede QR e não desconecta
 * nada: ele só passa a CONHECER o número que já está lá, pelo nome. O nome
 * vem sugerido do servidor quando a variável existe.
 */
export function CadastrarConexao({
  nomeSugerido,
  lojas,
}: {
  nomeSugerido: string;
  lojas: { id: string; nome: string }[];
}) {
  const idLoja = useId();
  const [estado, cadastrar, cadastrando] = useActionState(
    cadastrarConexaoAcao,
    {},
  );

  return (
    <form
      action={cadastrar}
      className="flex w-full max-w-md flex-col gap-4 text-left"
    >
      <Campo
        rotulo="Nome da instância na Evolution"
        name="nome"
        defaultValue={nomeSugerido}
        required
        erro={estado.erros?.nome}
        ajuda="O nome que já existe lá. O número conectado continua conectado."
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idLoja} className="text-ink-2 text-sm font-semibold">
          Este número avisa sobre
        </label>
        <select
          id={idLoja}
          name="unidadeId"
          defaultValue=""
          className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
        >
          <option value="">A rede inteira</option>
          {lojas.map((loja) => (
            <option key={loja.id} value={loja.id}>
              {loja.nome}
            </option>
          ))}
        </select>
      </div>
      {estado.erro && (
        <p role="alert" className="text-bad text-sm">
          {estado.erro}
        </p>
      )}
      <div>
        <Botao type="submit" carregando={cadastrando}>
          Cadastrar a conexão
        </Botao>
      </div>
    </form>
  );
}
