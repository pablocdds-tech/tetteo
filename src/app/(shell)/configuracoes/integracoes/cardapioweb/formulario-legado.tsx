"use client";

import { useState } from "react";
import { Botao } from "@/design-system/botao";
import { acaoCardapioWeb } from "./acoes";
import { BotaoAcaoCw } from "./botao-acao";

export function FormularioLegadoCw() {
  const [token, setToken] = useState("");
  const [copiado, setCopiado] = useState(false);
  const campo =
    "border-line bg-surface mt-1 block h-10 w-full rounded-md border px-3 text-sm";
  return (
    <form action={acaoCardapioWeb} className="space-y-4">
      <input type="hidden" name="acao" value="preparar-legado" />
      <label className="block text-sm font-medium">
        Ambiente
        <select name="ambiente" defaultValue="producao" className={campo}>
          <option value="producao">Produção — minha loja</option>
          <option value="sandbox">Sandbox — loja de testes</option>
        </select>
      </label>
      <label className="block text-sm font-medium">
        Token de API da loja
        <input
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          maxLength={4096}
          className={campo}
          aria-describedby="ajuda-api-cw"
        />
      </label>
      <p id="ajuda-api-cw" className="text-ink-3 text-xs">
        Use o token de Configurações → Integrações → API da Cardápio Web. Ele
        será protegido no servidor.
      </p>
      <label className="block text-sm font-medium">
        Token de autenticação do webhook
        <input
          name="webhookToken"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setCopiado(false);
          }}
          required
          minLength={32}
          maxLength={512}
          className={campo}
          aria-describedby="ajuda-webhook-cw"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Botao
          type="button"
          peso="secundario"
          tamanho="pequeno"
          onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            setToken(
              Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join(
                "",
              ),
            );
            setCopiado(false);
          }}
        >
          Gerar token seguro
        </Botao>
        <Botao
          type="button"
          peso="secundario"
          tamanho="pequeno"
          disabled={!token}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              setCopiado(true);
            } catch {
              setCopiado(false);
            }
          }}
        >
          {copiado ? "Token copiado" : "Copiar token do webhook"}
        </Botao>
      </div>
      <p id="ajuda-webhook-cw" className="text-ink-3 text-xs">
        Copie este token e use o mesmo valor no campo de autenticação do webhook
        na Cardápio Web. Ele não será exibido novamente após salvar.
      </p>
      <BotaoAcaoCw>Conferir a loja pela API</BotaoAcaoCw>
    </form>
  );
}
