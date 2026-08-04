# `design-system/` — a linguagem visual

Botão, campo, cartão, tabela, modal, aviso, etiqueta de estado. Os tijolos que
qualquer App usa.

## A regra

**Aqui não existe negócio.** Um componente daqui serviria para qualquer sistema do
mundo — ele não sabe o que é um insumo, um pedido ou uma unidade.

`<Button>` mora aqui. `<SeletorDeUnidade>` não — esse é do Core.
`<EditorDeFichaTecnica>` também não — esse é do App de Cardápio.

## Onde colocar um componente novo

| A pergunta                             | A resposta                  |
| -------------------------------------- | --------------------------- |
| Serviria em qualquer sistema?          | `design-system/`            |
| Serve a qualquer App, mas é do Tetteo? | `core/`                     |
| Só faz sentido dentro de um App?       | `modules/<app>/components/` |

**Na dúvida, comece no módulo.** Promover depois é fácil; separar o que nasceu
compartilhado, não.

## Estados obrigatórios

Todo componente interativo responde a oito situações — padrão, sobre, foco,
pressionado, carregando, desabilitado, erro e vazio. Foco de teclado nunca é
removido.

As cores, a escala tipográfica e os espaçamentos vivem em `src/app/globals.css`.
