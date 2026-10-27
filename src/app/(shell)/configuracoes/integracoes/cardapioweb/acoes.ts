"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { obterContexto } from "@/core/sessao/contexto";
import { ErroCw, configCw } from "@/connectors/cardapioweb/config";
import { escopoCw } from "@/connectors/cardapioweb/seguranca";
import {
  confirmarLegadoCw,
  desativarRecebimentoCw,
  prepararLegadoCw,
} from "@/connectors/cardapioweb/recebimento";
import {
  cancelarCw,
  confirmarCw,
  consultarCw,
  desconectarCw,
  iniciarCw,
} from "@/connectors/cardapioweb/servico";

const caminho = "/configuracoes/integracoes/cardapioweb";
export async function acaoCardapioWeb(dados: FormData): Promise<void> {
  const sessao = await obterContexto();
  if (!sessao) redirect("/login");
  let destino = caminho;
  try {
    const scope = escopoCw(sessao);
    const id = String(dados.get("id") || "");
    switch (dados.get("acao")) {
      case "preparar-legado": {
        const ambiente = dados.get("ambiente");
        if (ambiente !== "sandbox" && ambiente !== "producao")
          throw new ErroCw("configuracao", "Ambiente inválido.");
        await prepararLegadoCw(
          scope,
          ambiente,
          String(dados.get("apiKey") || "").trim(),
          String(dados.get("webhookToken") || "").trim(),
        );
        destino += "?aviso=conferir";
        break;
      }
      case "confirmar-legado":
        await confirmarLegadoCw(scope, id);
        destino += "?aviso=webhook-ativo";
        break;
      case "desativar-webhook":
        await desativarRecebimentoCw(scope, id);
        destino += "?aviso=webhook-pausado";
        break;
      case "conectar": {
        const inicio = await iniciarCw(scope);
        (await cookies()).set("tetteo.cw.oauth", inicio.state, {
          httpOnly: true,
          secure: configCw().redirectUri.startsWith("https:"),
          sameSite: "lax",
          path: "/api/cardapioweb/callback",
          maxAge: 600,
        });
        destino = inicio.url;
        break;
      }
      case "confirmar":
      case "cancelar":
        if (!/^[a-z0-9]{1,100}$/i.test(id))
          throw new ErroCw("state", "Autorização inválida.");
        if (dados.get("acao") === "confirmar") await confirmarCw(scope, id);
        else await cancelarCw(scope, id);
        destino += "?aviso=salvo";
        break;
      case "consultar":
        await consultarCw(scope);
        destino += "?aviso=consultado";
        break;
      case "desconectar":
        await desconectarCw(scope);
        destino += "?aviso=desconectada";
        break;
      default:
        throw new ErroCw("acao", "Ação inválida.");
    }
  } catch (erro) {
    destino = `${caminho}?aviso=${encodeURIComponent(erro instanceof ErroCw ? erro.codigo : "interno")}`;
  }
  revalidatePath(caminho);
  redirect(destino);
}
