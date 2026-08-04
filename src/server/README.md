# `server/` — a camada de dados

Acesso ao banco, autorização no servidor, publicação e entrega de eventos, auditoria.

## As regras que valem para toda consulta

**1. Nada é lido sem escopo.** Toda consulta passa pela organização e pela unidade do
usuário. Não existe "buscar todos os insumos" — existe "buscar os insumos desta
unidade, que este usuário pode ver".

**2. Nada é apagado de verdade.** Registro excluído é marcado como excluído, com data
e autor. Apagar de verdade é perder histórico e, dependendo do dado, criar problema
fiscal.

**3. Toda escrita é auditada.** Quem mudou, o quê, de qual valor para qual, quando e
de onde. A tabela de auditoria é só escrita — nunca se altera, nunca se apaga.

**4. Identificadores não são sequenciais.** Com números em ordem, quem acessa
`/pedido/1041` testa `/pedido/1042` e descobre o pedido de outra loja.

**5. O isolamento também vale no banco.** O próprio PostgreSQL recusa devolver dados
de outra organização, mesmo que uma consulta mal escrita peça. É a rede de proteção
para o dia em que houver um bug numa consulta.

## Fronteira

```
server/  →  modules/   ❌  bloqueado pelo linter
```
