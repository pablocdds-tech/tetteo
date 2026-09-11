import { desafioDe } from "../oauth/segredos.js";

/**
 * O CAMINHO QUE O CLAUDE FAZ, feito à mão para os testes: abre a tela, envia
 * e-mail e senha, escolhe a loja se precisar e pega o código no retorno.
 */

export type OpcoesDoFluxo = {
  email: string;
  senha: string;
  clientId: string;
  redirectUri: string;
  verificador: string;
  recurso: string;
  unidade?: string;
};

const postar = (base: string, campos: Record<string, string>) =>
  fetch(new URL("/oauth/authorize", base), {
    method: "POST",
    body: new URLSearchParams(campos),
    redirect: "manual",
  });

export async function obterCodigo(
  base: string,
  opcoes: OpcoesDoFluxo,
): Promise<string> {
  const url = new URL("/oauth/authorize", base);
  for (const [chave, valor] of Object.entries({
    response_type: "code",
    client_id: opcoes.clientId,
    redirect_uri: opcoes.redirectUri,
    code_challenge: desafioDe(opcoes.verificador),
    code_challenge_method: "S256",
    state: "estado-de-ensaio",
    scope: "vendas:ler",
    resource: opcoes.recurso,
  })) {
    url.searchParams.set(chave, valor);
  }

  const tela = await fetch(url, { redirect: "manual" });
  const pedido = /name="pedido" value="([^"]+)"/.exec(await tela.text())?.[1];
  if (!pedido) throw new Error(`a tela de login não abriu (${tela.status})`);

  let resposta = await postar(base, {
    pedido,
    acao: "autorizar",
    email: opcoes.email,
    senha: opcoes.senha,
  });
  if (resposta.status === 200 && opcoes.unidade) {
    resposta = await postar(base, {
      pedido,
      acao: "autorizar",
      unidade: opcoes.unidade,
    });
  }
  const destino = resposta.headers.get("location");
  const code = destino ? new URL(destino).searchParams.get("code") : null;
  if (!code)
    throw new Error(`o retorno não trouxe código (${resposta.status})`);
  return code;
}

export async function pedirChaves(
  base: string,
  campos: Record<string, string>,
): Promise<{
  status: number;
  corpo: Record<string, unknown>;
  resposta: Response;
}> {
  const resposta = await fetch(new URL("/oauth/token", base), {
    method: "POST",
    body: new URLSearchParams(campos),
  });
  return {
    status: resposta.status,
    corpo: (await resposta.json()) as Record<string, unknown>,
    resposta,
  };
}
