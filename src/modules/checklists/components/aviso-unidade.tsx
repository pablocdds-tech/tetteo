import { Vazio } from "@/design-system/vazio";

/**
 * O que aparece quando o usuário está vendo a REDE e abre os Checklists.
 *
 * Não é um erro — é uma pergunta. Checklist é presencial: a rede não abre a
 * porta às 7h nem confere a temperatura da câmara. Quem faz isso é uma pessoa,
 * num endereço.
 *
 * O seletor de unidade saiu do topo e foi para o alto da barra lateral (no
 * celular, para dentro do Menu). O texto diz isso: mandar a pessoa procurar
 * "no topo da tela" um controle que não está mais lá é pior do que não dizer
 * nada.
 */
export function AvisoUnidade({ acao }: { acao: string }) {
  return (
    <div className="bg-surface border-line rounded-lg border">
      <Vazio
        icone="casa"
        titulo="Escolha uma unidade primeiro"
        explicacao={`${acao} acontece dentro de uma loja: é uma pessoa que abre a porta, confere a câmara fria e assina embaixo. Escolha a unidade no seletor do alto da barra lateral — no celular, ele fica dentro do Menu.`}
      />
    </div>
  );
}
