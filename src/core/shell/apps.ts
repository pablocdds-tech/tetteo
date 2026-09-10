import type { NomeDeIcone } from "@/design-system/icones";

/**
 * O QUE A CASCA SABE DE UM APP.
 *
 * Uma versão reduzida e SERIALIZÁVEL do manifesto: só o que a barra lateral, a
 * gaveta do celular, o caminho no topo e a busca precisam para desenhar.
 *
 * Este arquivo é puro de propósito — nenhuma importação de sessão, de banco ou
 * de `next/headers`. É o que permite que um componente cliente (a gaveta, o
 * caminho, a busca) use `appAtual` sem arrastar o servidor inteiro para dentro
 * do pacote do navegador. Quem lê a sessão é `apps-visiveis.ts`, que só roda
 * no servidor.
 */

export type DestinoDoApp = { rota: string; nome: string };

export type AppNaBarra = {
  chave: string;
  nome: string;
  subtitulo: string;
  icone: NomeDeIcone;
  cor: { fundo: string; frente: string };
  rota: string;
  navegacao: DestinoDoApp[];
  emConstrucao?: boolean;
};

/**
 * Qual App é o dono do endereço atual.
 *
 * O mais ESPECÍFICO vence: com "/compras" e "/compras/cotacoes" registrados, o
 * endereço "/compras/cotacoes/123" pertence ao segundo. Ordenar por tamanho da
 * rota resolve isso sem o Core precisar entender nenhuma delas.
 */
export function appAtual(
  apps: AppNaBarra[],
  caminho: string,
): AppNaBarra | null {
  return (
    apps
      .filter((a) => caminho === a.rota || caminho.startsWith(`${a.rota}/`))
      .sort((a, b) => b.rota.length - a.rota.length)[0] ?? null
  );
}

/** O destino aberto dentro do App — a última perna do caminho no topo. */
export function destinoAtual(
  app: AppNaBarra,
  caminho: string,
): DestinoDoApp | null {
  return (
    app.navegacao
      .filter((d) => caminho === d.rota || caminho.startsWith(`${d.rota}/`))
      .sort((a, b) => b.rota.length - a.rota.length)[0] ?? null
  );
}

/**
 * Um destino está ativo quando é o endereço atual, ou quando o endereço está
 * abaixo dele.
 *
 * A exceção é a rota-raiz do App: "/compras" é prefixo de "/compras/cotacoes",
 * e sem esse cuidado "Pedidos" ficaria marcado como ativo em toda tela do
 * módulo. Dois itens acesos ao mesmo tempo é pior que nenhum.
 */
export function destinoEstaAtivo(
  destino: DestinoDoApp,
  rotaDoApp: string,
  caminho: string,
): boolean {
  if (caminho === destino.rota) return true;
  if (destino.rota === rotaDoApp) return false;
  return caminho.startsWith(`${destino.rota}/`);
}
