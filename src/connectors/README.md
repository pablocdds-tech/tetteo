# `connectors/` — as pontes com o mundo externo

PDV, iFood, WhatsApp, bancos.

## A regra

**Sistema externo nunca fala com um App. Fala com um conector.**

```
PDV  ──→  [conector]  ──→  publica "venda.registrada"  ──→  Estoque
                            (vocabulário do Tetteo)         Financeiro
                                                            Analytics
```

O conector é um tradutor: recebe o formato específico daquele fornecedor e converte
para o vocabulário interno do Tetteo. O App de Estoque **nunca ouviu falar do PDV** —
ele só escuta `venda.registrada`, como escuta qualquer outro evento.

Trocar de PDV vira reescrever um tradutor pequeno, não um App inteiro.

## Não são Apps

Conectores não aparecem na tela inicial, não têm ícone e não têm manifesto. São
infraestrutura — por isso ficam fora de `modules/`.

```
connectors/  →  modules/   ❌  bloqueado pelo linter
```
