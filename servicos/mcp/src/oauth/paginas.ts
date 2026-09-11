import type { Response } from "express";

import type { Loja } from "../banco/tetteo.js";

/**
 * AS TELAS DO LOGIN: entrar, escolher a loja, ou entender o que deu errado.
 *
 * HTML feito à mão, sem framework: são três telas pequenas, e cada byte que
 * vem de fora passa por `escaparHtml`. Abrem no celular, então o layout é de
 * uma coluna só e os botões são grandes.
 *
 * A tela diz QUEM pede (o host do client_id) e PARA ONDE a autorização volta
 * (o host do redirect_uri). A especificação exige isso: é o que permite à
 * pessoa perceber um pedido que não fez.
 */

export function escaparHtml(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

const e = escaparHtml;

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(titulo)} · Tetteo</title>
<link rel="stylesheet" href="/oauth/estilo.css">
</head>
<body>
<main class="cartao">
<p class="marca">Tetteo</p>
${corpo}
</main>
</body>
</html>`;
}

export function paginaDeLogin(dados: {
  pedidoId: string;
  clienteNome: string;
  clienteHost: string;
  destino: string;
  loopback: boolean;
  erro?: string;
  email?: string;
}): string {
  return moldura(
    "Conectar",
    `<h1>Conectar o ${e(dados.clienteNome)} ao Tetteo</h1>
<p class="quem">Pedido feito por <strong>${e(dados.clienteHost)}</strong>. A autorização volta para <strong>${e(dados.destino)}</strong>.</p>
${
  dados.loopback
    ? `<p class="alerta">Só continue se você acabou de pedir esta conexão neste computador, por exemplo no Claude Code.</p>`
    : ""
}
<section class="escopo">
<h2>Vai poder</h2>
<ul><li>Ver a quantidade de vendas e o total de um dia, da loja que você autorizar.</li></ul>
<h2>Não vai poder</h2>
<ul><li>Alterar pedidos, pagamentos ou qualquer outro dado. É somente leitura.</li></ul>
</section>
${dados.erro ? `<p class="erro" role="alert">${e(dados.erro)}</p>` : ""}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="pedido" value="${e(dados.pedidoId)}">
<label for="email">E-mail do Tetteo</label>
<input id="email" name="email" type="email" autocomplete="username" required value="${e(dados.email ?? "")}">
<label for="senha">Senha do Tetteo</label>
<input id="senha" name="senha" type="password" autocomplete="current-password" required>
<div class="acoes">
<button type="submit" name="acao" value="autorizar">Autorizar</button>
<button type="submit" name="acao" value="cancelar" formnovalidate class="secundario">Cancelar</button>
</div>
</form>
<p class="nota">Você pode desconectar quando quiser. A conexão também para sozinha se sua conta for suspensa no Tetteo.</p>`,
  );
}

export function paginaDeEscolha(dados: {
  pedidoId: string;
  clienteNome: string;
  lojas: Loja[];
  erro?: string;
}): string {
  const opcoes = dados.lojas
    .map(
      (loja, indice) =>
        `<label class="opcao"><input type="radio" name="unidade" value="${e(loja.id)}"${indice === 0 ? " checked" : ""} required> ${e(loja.nome)}</label>`,
    )
    .join("\n");
  return moldura(
    "Escolher a loja",
    `<h1>Qual loja o ${e(dados.clienteNome)} vai consultar?</h1>
<p class="quem">Cada conexão enxerga uma loja. Para outra loja, conecte de novo.</p>
${dados.erro ? `<p class="erro" role="alert">${e(dados.erro)}</p>` : ""}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="pedido" value="${e(dados.pedidoId)}">
<fieldset><legend>Loja</legend>
${opcoes}
</fieldset>
<div class="acoes">
<button type="submit" name="acao" value="autorizar">Autorizar esta loja</button>
<button type="submit" name="acao" value="cancelar" formnovalidate class="secundario">Cancelar</button>
</div>
</form>`,
  );
}

export function paginaDeErro(dados: {
  titulo: string;
  mensagem: string;
}): string {
  return moldura(
    dados.titulo,
    `<h1>${e(dados.titulo)}</h1>
<p>${e(dados.mensagem)}</p>
<p class="nota">Volte ao Claude e tente conectar de novo. Se continuar, fale com quem administra o Tetteo.</p>`,
  );
}

/**
 * As travas de toda tela. `form-action` lista também a origem do retorno:
 * alguns navegadores aplicam a regra ao redirecionamento que vem depois do
 * envio do formulário, e sem ela o código não chegaria ao Claude.
 */
export function aplicarCabecalhosDePagina(
  res: Response,
  origensDoFormulario: string[] = [],
): void {
  const formAction = ["'self'", ...origensDoFormulario].join(" ");
  res.set({
    "Content-Security-Policy": `default-src 'none'; style-src 'self'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    // same-origin, e não no-referrer: com no-referrer o navegador manda
    // "Origin: null" ao enviar o formulário, e a checagem de Origin recusaria
    // todo login. Para o claude.ai (outra origem) continua sem Referer.
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
}

export const ESTILO = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:#f4f1ec;color:#1f1b16;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.cartao{width:100%;max-width:440px;background:#fff;border:1px solid #e4ded5;border-radius:14px;padding:28px 24px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.marca{margin:0 0 12px;font-weight:700;letter-spacing:.02em;color:#9a3412}
h1{margin:0 0 8px;font-size:22px;line-height:1.3}
h2{margin:16px 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#57534e}
ul{margin:0;padding-left:20px}
.quem{margin:0 0 8px;color:#44403c}
.alerta{margin:12px 0;padding:10px 12px;border-radius:10px;background:#fef3c7;color:#78350f}
.erro{margin:16px 0 0;padding:10px 12px;border-radius:10px;background:#fee2e2;color:#7f1d1d}
.nota{margin:16px 0 0;font-size:14px;color:#57534e}
form{margin-top:16px}
label{display:block;margin:12px 0 4px;font-weight:600}
input[type=email],input[type=password]{width:100%;padding:12px;border:1px solid #c9c1b6;border-radius:10px;font:inherit}
input:focus-visible,button:focus-visible{outline:3px solid #fdba74;outline-offset:2px}
fieldset{margin:8px 0 0;padding:0;border:0}
legend{font-weight:600}
.opcao{display:flex;gap:10px;align-items:center;padding:12px;border:1px solid #e4ded5;border-radius:10px;font-weight:400}
.acoes{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
button{flex:1 1 140px;min-height:48px;border:0;border-radius:10px;background:#9a3412;color:#fff;font:600 16px/1 inherit;cursor:pointer}
button.secundario{background:#f4f1ec;color:#1f1b16;border:1px solid #c9c1b6}
`;
