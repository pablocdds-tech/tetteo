import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { Router, type Response } from "express";
import { z } from "zod";

import type { Banco } from "../banco/conexao.js";
import {
  buscarUsuarioParaLogin,
  lojasComVendasVisiveis,
  type UsuarioParaLogin,
} from "../banco/tetteo.js";
import type { Config } from "../config.js";
import type { Registro } from "../registro.js";
import {
  apagarPedido,
  aprovarConexao,
  criarPedido,
  falhasRecentes,
  lerPedido,
  marcarPedidoAutenticado,
  marcarTentativaComSucesso,
  registrarTentativa,
  type Pedido,
} from "./armazem.js";
import { ErroDeCliente, type ResolverCliente } from "./cliente.js";
import { escoposConcedidos } from "./escopos.js";
import {
  aplicarCabecalhosDePagina,
  ESTILO,
  paginaDeErro,
  paginaDeEscolha,
  paginaDeLogin,
} from "./paginas.js";
import {
  descreverDestino,
  ehLoopback,
  redirecionamentoPermitido,
} from "./redirecionamento.js";
import { desafioValido, impressaoDigital } from "./segredos.js";

/**
 * O LOGIN E O CONSENTIMENTO.
 *
 * GET mostra a tela; POST confere a senha do Tetteo, escolhe a loja e manda o
 * código de volta ao Claude.
 *
 * A ordem dos cuidados importa. Enquanto o cliente e o endereço de retorno
 * não estão validados, NENHUM erro é redirecionado — mostrar uma página é
 * seguro, mandar a pessoa para um endereço que não sabemos de quem é, não.
 *
 * A senha é conferida pela mesma resposta em todas as falhas, e com bcrypt
 * mesmo quando o e-mail não existe: quem fica tentando não descobre quais
 * e-mails têm conta. Dez falhas por e-mail (ou trinta por IP) em 15 minutos
 * travam novas tentativas — e a tentativa conta ANTES da conferência, para
 * que dezenas de envios ao mesmo tempo não passem pela mesma contagem. No
 * máximo quatro conferências de senha rodam juntas neste processo.
 */

export type DependenciasDoLogin = {
  banco: Banco;
  config: Config;
  resolverCliente: ResolverCliente;
  registro: Registro;
};

const LIMITE_POR_EMAIL = 10;
const LIMITE_POR_IP = 30;
const MAX_CONFERENCIAS_SIMULTANEAS = 4;
let conferenciasEmAndamento = 0;

const consulta = z.object({
  response_type: z.string().max(50).optional(),
  client_id: z.string().min(1).max(500),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  state: z.string().max(1000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(500).optional(),
});

const formulario = z.object({
  pedido: z.string().min(1).max(100),
  acao: z.enum(["autorizar", "cancelar"]),
  email: z.string().max(320).optional(),
  senha: z.string().max(500).optional(),
  unidade: z.string().max(100).optional(),
});

let hashFalso: Promise<string> | undefined;
const obterHashFalso = () =>
  (hashFalso ??= bcrypt.hash(randomBytes(16).toString("hex"), 12));

function hostDe(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
}

/** O `resource` pedido (RFC 8707) é este MCP? Barra final e fragmento não contam. */
export function mesmoRecurso(pedido: string, canonico: URL): boolean {
  try {
    const url = new URL(pedido);
    url.hash = "";
    return url.href.replace(/\/$/, "") === canonico.href.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function mostrar(
  res: Response,
  status: number,
  html: string,
  origensDoFormulario: string[] = [],
): void {
  aplicarCabecalhosDePagina(res, origensDoFormulario);
  res.status(status).type("html").send(html);
}

function voltar(
  res: Response,
  redirectUri: string,
  parametros: Record<string, string | null | undefined>,
): void {
  const url = new URL(redirectUri);
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor) url.searchParams.set(chave, valor);
  }
  res.set("Cache-Control", "no-store");
  res.redirect(303, url.href);
}

function dadosDaTela(
  pedido: Pick<Pedido, "clientId" | "clienteNome" | "redirectUri">,
) {
  return {
    clienteNome: pedido.clienteNome,
    clienteHost: hostDe(pedido.clientId),
    destino: descreverDestino(pedido.redirectUri),
    loopback: ehLoopback(new URL(pedido.redirectUri)),
  };
}

export function rotasDeAutorizacao(deps: DependenciasDoLogin): Router {
  const rotas = Router();

  rotas.get("/estilo.css", (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600").type("css").send(ESTILO);
  });

  rotas.get("/authorize", async (req, res) => {
    const analise = consulta.safeParse(req.query);
    if (!analise.success) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Pedido incompleto",
          mensagem: "Faltam informações no pedido de conexão.",
        }),
      );
    }
    const q = analise.data;

    let cliente: Awaited<ReturnType<ResolverCliente>>;
    try {
      cliente = await deps.resolverCliente(q.client_id);
    } catch (erro) {
      if (!(erro instanceof ErroDeCliente)) throw erro;
      deps.registro.aviso("cliente recusado", {
        host: hostDe(q.client_id),
        motivo: erro.message,
      });
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Cliente não autorizado",
          mensagem: erro.message,
        }),
      );
    }

    if (!redirecionamentoPermitido(q.redirect_uri, cliente.redirectUris)) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Endereço de retorno inválido",
          mensagem: "O endereço de retorno não pertence a este cliente.",
        }),
      );
    }

    // Daqui em diante o retorno é confiável: os erros voltam para o cliente.
    const devolver = (erro: string, descricao: string) =>
      voltar(res, q.redirect_uri, {
        error: erro,
        error_description: descricao,
        state: q.state,
        iss: deps.config.emissor,
      });

    if (q.response_type !== "code") {
      return devolver("unsupported_response_type", "Use response_type=code.");
    }
    if (
      q.code_challenge_method !== "S256" ||
      !q.code_challenge ||
      !desafioValido(q.code_challenge)
    ) {
      return devolver("invalid_request", "PKCE com S256 é obrigatório.");
    }
    const escopos = escoposConcedidos(q.scope);
    if (!escopos) {
      return devolver("invalid_scope", "Nenhum escopo pedido existe aqui.");
    }
    if (
      q.resource !== undefined &&
      !mesmoRecurso(q.resource, deps.config.urlMcp)
    ) {
      return devolver(
        "invalid_target",
        "Este servidor só emite chaves para o próprio MCP.",
      );
    }

    const pedidoId = await criarPedido(deps.banco, {
      clientId: cliente.clientId,
      clienteNome: cliente.nome,
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      escopos,
      recurso: deps.config.urlMcp.href,
    });
    const tela = dadosDaTela({
      clientId: cliente.clientId,
      clienteNome: cliente.nome,
      redirectUri: q.redirect_uri,
    });
    return mostrar(res, 200, paginaDeLogin({ pedidoId, ...tela }), [
      new URL(q.redirect_uri).origin,
    ]);
  });

  rotas.post("/authorize", async (req, res) => {
    const analise = formulario.safeParse(req.body ?? {});
    if (!analise.success) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Formulário inválido",
          mensagem: "Não entendi o que foi enviado.",
        }),
      );
    }
    const f = analise.data;

    const pedido = await lerPedido(deps.banco, f.pedido);
    if (!pedido) {
      return mostrar(
        res,
        400,
        paginaDeErro({
          titulo: "Pedido expirado",
          mensagem: "Este pedido de conexão expirou ou já foi usado.",
        }),
      );
    }
    const origens = [new URL(pedido.redirectUri).origin];
    const devolver = (parametros: Record<string, string>) =>
      voltar(res, pedido.redirectUri, {
        ...parametros,
        state: pedido.state,
        iss: deps.config.emissor,
      });

    if (f.acao === "cancelar") {
      await apagarPedido(deps.banco, pedido.hash);
      return devolver({
        error: "access_denied",
        error_description: "A pessoa não autorizou a conexão.",
      });
    }

    const concluir = async (
      usuarioId: string,
      unidadeId: string,
      versaoSenha: string,
    ) => {
      const code = await aprovarConexao(deps.banco, {
        usuarioId,
        unidadeId,
        versaoSenha,
        clientId: pedido.clientId,
        clienteNome: pedido.clienteNome,
        escopos: pedido.escopos,
        recurso: pedido.recurso,
        redirectUri: pedido.redirectUri,
        codeChallenge: pedido.codeChallenge,
      });
      await apagarPedido(deps.banco, pedido.hash);
      deps.registro.info("conexão aprovada", {
        cliente: hostDe(pedido.clientId),
      });
      return devolver({ code });
    };

    // Segunda etapa: a pessoa já entrou e está escolhendo a loja.
    if (pedido.usuarioId && pedido.versaoSenha) {
      const lojas = await lojasComVendasVisiveis(deps.banco, pedido.usuarioId);
      const loja = lojas.find((item) => item.id === f.unidade);
      if (!loja) {
        return mostrar(
          res,
          400,
          paginaDeEscolha({
            pedidoId: f.pedido,
            clienteNome: pedido.clienteNome,
            lojas,
            erro: "Escolha uma das lojas da lista.",
          }),
          origens,
        );
      }
      return concluir(pedido.usuarioId, loja.id, pedido.versaoSenha);
    }

    // Primeira etapa: e-mail e senha do Tetteo.
    const email = (f.email ?? "").trim().toLowerCase();
    const senha = f.senha ?? "";
    const refazer = (status: number, erro: string) =>
      mostrar(
        res,
        status,
        paginaDeLogin({
          pedidoId: f.pedido,
          ...dadosDaTela(pedido),
          erro,
          email,
        }),
        origens,
      );

    if (!email || !senha) return refazer(400, "Informe e-mail e senha.");

    const chaves = {
      emailHash: impressaoDigital(email),
      ipHash: impressaoDigital(req.ip ?? ""),
    };
    // A tentativa conta ANTES da conferência da senha. Contada depois,
    // tentativas simultâneas liam a mesma contagem e passavam todas.
    const tentativa = await registrarTentativa(deps.banco, {
      ...chaves,
      sucesso: false,
    });
    const falhas = await falhasRecentes(deps.banco, chaves);
    if (falhas.porEmail > LIMITE_POR_EMAIL || falhas.porIp > LIMITE_POR_IP) {
      return refazer(
        429,
        "Muitas tentativas. Espere 15 minutos e tente de novo.",
      );
    }
    // bcrypt gasta CPU de propósito. Um teto de conferências ao mesmo tempo
    // impede que uma enxurrada de logins pare o servidor inteiro.
    if (conferenciasEmAndamento >= MAX_CONFERENCIAS_SIMULTANEAS) {
      return refazer(
        429,
        "Muitas tentativas ao mesmo tempo. Tente de novo em instantes.",
      );
    }
    conferenciasEmAndamento += 1;
    let usuario: UsuarioParaLogin | null;
    let confere: boolean;
    try {
      usuario = await buscarUsuarioParaLogin(deps.banco, email);
      confere = await bcrypt.compare(
        senha,
        usuario?.senhaHash ?? (await obterHashFalso()),
      );
    } finally {
      conferenciasEmAndamento -= 1;
    }
    if (!usuario || !confere)
      return refazer(401, "E-mail ou senha incorretos.");
    await marcarTentativaComSucesso(deps.banco, tentativa);

    const lojas = await lojasComVendasVisiveis(deps.banco, usuario.id);
    if (lojas.length === 0) {
      await apagarPedido(deps.banco, pedido.hash);
      return mostrar(
        res,
        403,
        paginaDeErro({
          titulo: "Sem permissão",
          mensagem:
            "Sua conta não tem permissão para ver as vendas de nenhuma loja. Peça a quem administra o Tetteo.",
        }),
      );
    }
    if (lojas.length === 1) {
      return concluir(usuario.id, lojas[0]!.id, usuario.versaoSenha);
    }

    await marcarPedidoAutenticado(
      deps.banco,
      pedido.hash,
      usuario.id,
      usuario.versaoSenha,
    );
    return mostrar(
      res,
      200,
      paginaDeEscolha({
        pedidoId: f.pedido,
        clienteNome: pedido.clienteNome,
        lojas,
      }),
      origens,
    );
  });

  return rotas;
}
