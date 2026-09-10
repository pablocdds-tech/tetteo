"use server";

import { redirect } from "next/navigation";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { lerNumeroBr } from "@/lib/numero";
import {
  adicionarItem,
  cancelarCotacao,
  criarCotacao,
} from "@/modules/compras/services/cotacoes";
import type { EstadoDaCotacao } from "@/modules/estoque/components/lista-de-compras";

/**
 * DA DESPENSA PARA A COTAÇÃO.
 *
 * Esta ação mora na camada de ROTA, e não dentro do App de Estoque, porque ela
 * precisa conhecer os dois lados. Um App nunca importa de outro App — a trava
 * está no `eslint.config.mjs`, e ela existe para que Estoque e Compras possam
 * evoluir sem se quebrarem. Quem tem o direito de juntar os dois é a rota, que
 * é justamente o lugar onde o sistema é montado.
 *
 * O que ela NÃO faz: inventar cotação nova, preço, fornecedor ou regra de
 * compra. Ela usa `criarCotacao` e `adicionarItem` exatamente como a tela de
 * Compras usa — mesma permissão, mesmas validações, mesmo histórico.
 */

/**
 * O que vai para o banco sai com o hífen comum.
 *
 * O Postgres desta instalação guarda texto em WIN1252, e o sinal de menos
 * tipográfico "−" (U+2212), que a tela usa em "mínimo 15 kg − disponível
 * 3,5 kg", não existe nessa tabela: a gravação inteira cai com o código
 * 22P05. Na tela o sinal certo continua; no banco, o que o banco aceita.
 */
function paraOBanco(texto: string) {
  return texto.replace(/−/g, "-");
}

type ItemRecebido = {
  insumoId: string;
  nome: string;
  unidade: string;
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
        nome: String(item.nome ?? ""),
        unidade: String(item.unidade ?? ""),
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

  // A permissão é conferida aqui E dentro de `criarCotacao`. A daqui existe
  // para dar uma frase em vez de uma exceção; a de lá é a que vale, porque é
  // ela que protege quem chamar o serviço por outro caminho.
  if (!pode(contexto, "compras.cotar")) {
    return {
      erro: "Seu perfil não inclui criar cotações. A lista continua aqui.",
    };
  }

  const descricao = String(dados.get("descricao") ?? "").trim();
  if (descricao.length < 2) {
    return { erro: "Dê um nome à cotação para conseguir achá-la depois." };
  }
  if (descricao.length > 120) {
    return { erro: "O nome da cotação passou de 120 caracteres." };
  }

  const recebidos = lerItens(String(dados.get("itens") ?? ""));
  if (recebidos === null) {
    return {
      erro: "Não deu para ler a lista. Recarregue a página e monte de novo.",
    };
  }

  // Duas linhas do mesmo insumo violariam a unicidade da cotação no banco.
  // A tela já impede, mas quem valida é o servidor — sempre.
  const porInsumo = new Map<string, ItemRecebido>();
  for (const item of recebidos) {
    if (item.insumoId) porInsumo.set(item.insumoId, item);
  }
  const itens = [...porInsumo.values()];

  if (itens.length === 0) {
    return { erro: "A lista está vazia. Adicione ao menos um insumo." };
  }

  /**
   * Quantidade em branco NÃO vira zero, e zero não vira compra.
   *
   * Um item na lista com o campo vazio é uma decisão que a pessoa ainda não
   * tomou. Mandar zero para a cotação criaria um item que nenhum fornecedor
   * consegue cotar, e o erro só apareceria na hora de comparar preços.
   */
  const invalidos: string[] = [];
  const prontos: { item: ItemRecebido; quantidade: number }[] = [];

  for (const item of itens) {
    const quantidade = lerNumeroBr(item.quantidade);
    if (quantidade === undefined || quantidade === null || quantidade <= 0) {
      invalidos.push(item.insumoId);
      continue;
    }
    prontos.push({ item, quantidade });
  }

  if (invalidos.length > 0) {
    const nomes = itens
      .filter((i) => invalidos.includes(i.insumoId))
      .map((i) => i.nome);

    return {
      invalidos,
      erro:
        invalidos.length === 1
          ? `Falta a quantidade de ${nomes[0]}. Preencha ou tire da lista.`
          : `Faltam quantidades em ${invalidos.length} itens: ${nomes.join(", ")}. Preencha ou tire da lista.`,
    };
  }

  let criada: string | null = null;

  try {
    const cotacao = await criarCotacao(contexto, {
      descricao: paraOBanco(descricao),
      validaAte: null,
      // De onde a cotação veio fica gravado nela, não só na tela. Daqui a um
      // mês, quem abrir precisa saber que a lista nasceu da despensa.
      observacao: "Montada a partir da Despensa (Estoque).",
    });
    criada = cotacao.id;

    for (const { item, quantidade } of prontos) {
      await adicionarItem(contexto, cotacao.id, {
        insumoId: item.insumoId,
        quantidade,
        // A origem da sugestão viaja junto com o item. Quem for cotar vê que
        // aquele número saiu do mínimo, e não do dedo de alguém.
        observacao: item.origem
          ? paraOBanco(`Sugestão da Despensa: ${item.origem}`)
          : null,
      });
    }

    // A tela recebe o id, limpa o rascunho e navega até a cotação.
    // Redirecionar daqui deixaria o rascunho vivo na aba — pronto para ser
    // mandado de novo.
    return { cotacaoId: cotacao.id };
  } catch (erro) {
    // Criou a cotação e falhou no meio dos itens: ela ficaria em Compras pela
    // metade, ABERTA, e a próxima tentativa criaria outra ao lado. Cancelar é
    // o desfazer que o próprio Compras oferece — fica no histórico, sai da
    // lista, e ninguém cota metade de um pedido.
    if (criada) {
      await cancelarCotacao(contexto, criada).catch(() => undefined);
    }

    // A mensagem técnica do banco ("Invalid prisma.itemDeCotacao.create()
    // invocation… 22P05") não ajuda quem está comprando e revela a estrutura
    // do sistema. Ela vai para o log do servidor; a tela recebe uma frase.
    // As mensagens das regras de Compras ("Insumo não encontrado.") passam.
    console.error("criarCotacaoDaDespensa:", erro);
    const motivo =
      erro instanceof Error && !erro.name.startsWith("PrismaClient")
        ? erro.message
        : "O banco recusou a gravação da cotação.";
    return {
      erro: `${motivo} Nada ficou pela metade em Compras — sua lista continua aqui.`,
    };
  }
}
