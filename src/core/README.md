# `core/` — o Kernel

A plataforma. Login, unidades, permissões, casca (sidebar/header), registro de Apps,
barramento de eventos, busca, notificações, configurações.

## A regra

**O Core não conhece nenhum App.**

Ele não sabe o que é uma ficha técnica, um insumo ou um pedido. Ele sabe apenas
_como_ verificar uma permissão, _como_ entregar um evento, _como_ montar um menu —
nunca _o que_ significam.

O único ponto de contato é o **App Registry**, que lê os manifestos que os Apps
declaram sobre si mesmos.

## Proibido

```
core/  →  modules/     ❌  bloqueado pelo linter
```

Se o Core precisar de algo de um App, o desenho está errado: quem deve declarar é o
App, através do seu `manifest.ts`.
