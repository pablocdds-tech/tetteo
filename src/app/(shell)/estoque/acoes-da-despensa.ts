"use server";

import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { ExigeUnidade, SemPermissao } from "@/lib/erros";
import {
  CASAS,
  NumeroInvalido,
  digitado,
} from "@/modules/compras/schemas/aritmetica";
import { adicionarDaDespensa } from "@/modules/compras/services/requisicoes";
import type { EstadoDaCotacao } from "@/modules/estoque/components/lista-de-compras";

/**
 * DA DESPENSA PARA A REQUISIÇÃO DA LOJA.
 *
 * Esta ação mora na camada de ROTA, e não dentro do App de Estoque, porque ela
 * precisa conhecer os dois lados. Um App nunca importa de outro App — a trava
 * está no `eslint.config.mjs`. Quem tem o direito de juntar os dois é a rota.
 *
 * O que ela NÃO faz: inventar rodada, preço, fornecedor ou regra de compra.
 * Os itens entram na requisição desta loja, na rodada aberta mais recente,
 * pelo mesmo `salvarItem` da tela de Requisição — mesma permissão, mesma
 * validação, mesma sugestão recalculada no servidor. Nada vai ao comprador
 * até a loja enviar a requisição.
 */

/**
 * O que vai para o banco sai com o hífen comum: um Postgres em WIN1252 não
 * aceita o sinal de menos tipográfico "−" (U+2212) de "mínimo 15 kg −
 * disponível 3,5 kg", e a gravação inteira cairia com 22P05.
 */
function paraOBanco(texto: string) {
  return texto.replace(/−/g, "-");
}

type ItemRecebido = {
  insumoId: string;
  quantidade: string;
  origem: string | null;
};

function lerItens(bruto: string): ItemRecebido[] | null {
  try {
    const dados: unknown = JSON.parse(bruto);
    if (!Array.isArray(dados)) return null;
    return dados.map((linha) => {
      const item = linha as Record<string, unknown>;
      return {
        insumoId: String(item.insumoId ?? ""),
        quantidade: String(item.quantidade ?? ""),
        origem: typeof item.origem === "string" ? item.origem : null,
      };
    });
  } catch {
    return null;
  }
}

export async function criarCotacaoDaDespensa(
  _estado: EstadoDaCotacao,
  dados: FormData,
): Promise<EstadoDaCotacao> {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");

  // A permissão é conferida aqui E dentro do serviço. A daqui dá uma frase; a
  // de lá é a que vale, porque protege quem chamar o serviço por outro caminho.
  if (!pode(contexto, "compras.requisitar")) {
    return {
      erro: "Seu perfil não inclui preparar a requisição da loja. A lista continua aqui.",
    };
  }

  const recebidos = lerItens(String(dados.get("itens") ?? ""));
  if (recebidos === null) {
    return {
      erro: "Não deu para ler a lista. Recarregue a página e monte de novo.",
    };
  }

  const porInsumo = new Map<string, ItemRecebido>();
  for (const item of recebidos) {
    if (item.insumoId) porInsumo.set(item.insumoId, item);
  }
  const itens = [...porInsumo.values()];
  if (itens.length === 0) {
    return { erro: "A lista está vazia. Adicione ao menos um insumo." };
  }

  // Quantidade em branco NÃO vira zero, e zero não vira compra: é uma decisão
  // que a pessoa ainda não tomou. Todas são conferidas antes da primeira
  // gravação — a lista não entra pela metade.
  const invalidos = itens
    .filter((i) => {
      try {
        const q = digitado(i.quantidade, CASAS.milesimos);
        return q === null || q <= 0n;
      } catch (erro) {
        if (erro instanceof NumeroInvalido) return true;
        throw erro;
      }
    })
    .map((i) => i.insumoId);
  if (invalidos.length > 0) {
    return {
      erro: "Algumas quantidades estão vazias ou não foram entendidas — corrija as marcadas.",
      invalidos,
    };
  }

  try {
    const r = await adicionarDaDespensa(
      contexto,
      itens.map((i) => ({
        insumoId: i.insumoId,
        quantidade: i.quantidade,
        origem: i.origem ? paraOBanco(i.origem) : null,
      })),
    );
    return { cotacaoId: r.rodadaId };
  } catch (erro) {
    if (erro instanceof SemPermissao || erro instanceof ExigeUnidade)
      return { erro: erro.message };
    if (erro instanceof Error && !erro.name.startsWith("PrismaClient")) {
      return { erro: erro.message };
    }
    console.error("criarCotacaoDaDespensa:", erro);
    return {
      erro: "O sistema não conseguiu gravar agora. Sua lista continua aqui — tente de novo.",
    };
  }
}
