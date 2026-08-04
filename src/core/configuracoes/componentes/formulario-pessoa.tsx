"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";

import { criarPessoaAcao, type EstadoConfig } from "../acoes";

const ESTILO_SELECT =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none";

/**
 * Gera uma senha inicial legível.
 *
 * Vai por WhatsApp e vai ser digitada num celular de cozinha, então evita o
 * que se confunde: I, l, 1, O, 0. Uma senha impossível de digitar acaba
 * virando "123456" na segunda tentativa.
 */
function gerarSenha() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return [...bytes].map((n) => alfabeto[n % alfabeto.length]).join("");
}

/**
 * Cadastrar alguém da equipe.
 *
 * Não existe convite por e-mail: não há serviço de envio, e prometer um
 * convite que nunca chega é pior do que não prometer. O dono define a senha e
 * entrega — que é como funciona numa pizzaria de verdade.
 */
export function FormularioPessoa({
  papeis,
  unidades,
}: {
  papeis: { id: string; nome: string }[];
  unidades: { id: string; nome: string }[];
}) {
  const [estado, acao, enviando] = useActionState<EstadoConfig, FormData>(
    criarPessoaAcao,
    {},
  );
  const [senha, setSenha] = useState("");

  return (
    <form action={acao} className="flex max-w-[520px] flex-col gap-4">
      <Campo
        rotulo="Nome"
        name="nome"
        placeholder="Ex.: Alisson"
        erro={estado.erros?.nome}
        required
        autoFocus
      />

      <Campo
        rotulo="E-mail"
        name="email"
        type="email"
        placeholder="Ex.: alisson@vitaliano.com.br"
        erro={estado.erros?.email}
        ajuda="É com ele que a pessoa entra no sistema."
        required
      />

      <div className="flex w-full flex-col gap-1.5">
        <Campo
          rotulo="Senha inicial"
          name="senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          erro={estado.erros?.senha}
          ajuda="Pelo menos 12 caracteres. Anote agora — ela não aparece de novo depois de salvar."
          required
        />
        <div>
          <Botao
            type="button"
            peso="secundario"
            tamanho="pequeno"
            onClick={() => setSenha(gerarSenha())}
          >
            Gerar senha
          </Botao>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex w-full flex-col gap-1.5">
          <label htmlFor="papelId" className="text-ink-2 text-sm font-semibold">
            Papel
          </label>
          <select
            id="papelId"
            name="papelId"
            className={ESTILO_SELECT}
            required
          >
            <option value="">Escolha…</option>
            {papeis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          {estado.erros?.papelId && (
            <span className="text-bad text-sm">{estado.erros.papelId}</span>
          )}
        </div>

        <div className="flex w-full flex-col gap-1.5">
          <label
            htmlFor="unidadeId"
            className="text-ink-2 text-sm font-semibold"
          >
            Onde ela trabalha
          </label>
          <select id="unidadeId" name="unidadeId" className={ESTILO_SELECT}>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
            <option value="">A rede inteira</option>
          </select>
          <span className="text-ink-3 text-sm">
            &quot;Rede inteira&quot; vê todas as lojas. Reserve para quem é
            dono.
          </span>
        </div>
      </div>

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
          Criar acesso
        </Botao>
        <Link href="/configuracoes/usuarios">
          <Botao type="button" peso="fantasma">
            Cancelar
          </Botao>
        </Link>
      </div>
    </form>
  );
}
