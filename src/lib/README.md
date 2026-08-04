# `lib/` — utilitários genéricos

Formatar moeda, tratar data, gerar identificador, funções de texto.

## A regra

**Nada aqui conhece o negócio.**

O teste é simples: se o nome da função tem uma palavra do negócio — `insumo`,
`pedido`, `unidade`, `ficha` — ela não pertence a `lib/`. É uma regra de negócio, e
mora em `services/` dentro do App correspondente.

```
formatarMoeda(1250)          ✅  lib/
calcularCustoDaFicha(ficha)  ❌  modules/cardapio/services/
```

## Fronteira

`lib/` é a camada mais baixa do sistema: **não importa de lugar nenhum** dentro de
`src/`. Se um utilitário precisou importar do Core ou de um módulo, ele não era um
utilitário.
