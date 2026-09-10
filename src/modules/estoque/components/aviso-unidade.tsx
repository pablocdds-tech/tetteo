import { Cartao } from "@/design-system/cartao";
import { Vazio } from "@/design-system/vazio";

/**
 * O que aparece quando o usuário está vendo a REDE e abre o Estoque.
 *
 * Não é um erro — é uma pergunta. Estoque é físico: a rede não tem câmara
 * fria, e "contar a rede" não significa nada. Em vez de mostrar uma tela vazia
 * ou um aviso técnico, a tela explica o porquê e diz onde clicar.
 *
 * O seletor de unidade mora na BARRA LATERAL, logo abaixo da marca — e a
 * gaveta o leva junto no celular. Um texto que aponta para o lugar errado é
 * pior do que não apontar: manda a pessoa procurar onde não tem.
 */
export function AvisoUnidade({ acao }: { acao: string }) {
  return (
    <Cartao>
      <Vazio
        icone="casa"
        titulo="Escolha uma unidade primeiro"
        explicacao={`${acao} é coisa de loja, não de rede: a farinha que está na câmara fria de uma unidade não vira pizza na outra. Use o seletor de unidade no alto do menu à esquerda.`}
      />
    </Cartao>
  );
}
