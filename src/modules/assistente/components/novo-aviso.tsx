"use client";

import { useActionState, useId, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { Cartao } from "@/design-system/cartao";

import { criarRascunhoAcao, type EstadoFormulario } from "../acoes";

/**
 * PREPARAR UM AVISO À MÃO.
 *
 * Vira RASCUNHO, sempre. Quem prepara não escolhe se sai: isso é do
 * responsável, na tela do aviso. É a divisão que deixa um operador ajudar sem
 * poder mandar mensagem em nome da loja.
 */
export function NovoAviso({
  lojas,
  lojaPadrao,
}: {
  lojas: { id: string; nome: string }[];
  lojaPadrao: string | null;
}) {
  const idTexto = useId();
  const idLoja = useId();
  const [aberto, setAberto] = useState(false);
  const [estado, criar, criando] = useActionState(
    async (anterior: EstadoFormulario, dados: FormData) => {
      const resultado = await criarRascunhoAcao(anterior, dados);
      if (resultado.ok) setAberto(false);
      return resultado;
    },
    {},
  );

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Botao peso="secundario" onClick={() => setAberto(true)}>
            Preparar aviso
          </Botao>
        </div>
        {estado.ok && (
          <p role="status" className="text-ok text-sm">
            Rascunho salvo. Ele espera um responsável em “Para revisar”.
          </p>
        )}
      </div>
    );
  }

  return (
    <Cartao>
      <form action={criar} className="flex flex-col gap-4 p-4">
        <div>
          <h2 className="font-semibold">Preparar um aviso</h2>
          <p className="text-ink-3 mt-0.5 text-sm">
            Fica como rascunho. Só sai quando um responsável confirmar.
          </p>
        </div>

        <Campo
          rotulo="Título"
          name="titulo"
          maxLength={80}
          required
          erro={estado.erros?.titulo}
          ajuda="A primeira linha, em negrito no celular."
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={idTexto} className="text-ink-2 text-sm font-semibold">
            Texto
          </label>
          <textarea
            id={idTexto}
            name="texto"
            rows={4}
            maxLength={1200}
            required
            aria-invalid={estado.erros?.texto ? true : undefined}
            className="bg-surface text-ink border-line-2 hover:border-ink-3 focus:border-accent w-full rounded-md border px-3 py-2 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
          />
          {estado.erros?.texto && (
            <span className="text-bad text-sm">{estado.erros.texto}</span>
          )}
        </div>

        {lojas.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={idLoja}
              className="text-ink-2 text-sm font-semibold"
            >
              Loja
            </label>
            <select
              id={idLoja}
              name="unidadeId"
              defaultValue={lojaPadrao ?? lojas[0]?.id}
              className="border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:shadow-[0_0_0_3px_var(--accent-sub)] focus:outline-none"
            >
              {lojas.map((loja) => (
                <option key={loja.id} value={loja.id}>
                  {loja.nome}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input
            type="hidden"
            name="unidadeId"
            value={lojaPadrao ?? lojas[0]?.id ?? ""}
          />
        )}

        {estado.erro && (
          <p role="alert" className="text-bad text-sm">
            {estado.erro}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Botao type="submit" carregando={criando}>
            Salvar rascunho
          </Botao>
          <Botao type="button" peso="fantasma" onClick={() => setAberto(false)}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
