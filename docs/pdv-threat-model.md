# Modelo de ameaças do PDV

## Escopo e contexto confirmado

Módulo interno de produtos, online, para uso próprio, sem fiscal ou processador de pagamentos. Aplicação Next.js existente publicada no Dokploy, usando a sessão Auth.js e o banco PostgreSQL existentes. Os valores de Pix/cartão são registros manuais, não provas de liquidação. Confirmação de escopo dada na conversa de 27/10/2026. Acesso externo ao Tetteo já existe; não são criados novos canais públicos.

Ativos: integridade das vendas, estoque, dinheiro em caixa, identificação de clientes e trilha de auditoria. Atacante relevante: operador autenticado tentando exceder suas permissões, manipular payloads ou repetir requisições; visitante sem sessão tentando invocar ações. Administrador do banco/VPS já pode alterar dados e está fora desse modelo.

```mermaid
flowchart LR
  A["Navegador do operador"] --> B["Server Actions e sessão"]
  B --> C["Escopo e permissões"]
  C --> D["Transação do PDV"]
  D --> E["Vendas e caixa"]
  D --> F["Estoque e receitas"]
  D --> G["Auditoria"]
```

## Fronteiras e evidências

- Navegador → servidor: `src/modules/pdv/acoes.ts`; sessão obtida no servidor, payload validado com Zod em `schemas/venda.ts`.
- Sessão → organização/unidade: `core/sessao/contexto.ts` e `services/pdv.ts`, função `exigirEscopo`. IDs do navegador não são autorização.
- Operação → persistência: `services/pdv.ts`; valores e composição são obtidos do catálogo do banco; caixa, venda, estoque e auditoria usam transação.
- Escritas simultâneas → estado de caixa: trava transacional por organização/unidade e restrição de caixa aberto na migração PDV.
- Receita atual → história: snapshots de itens, pagamentos e consumo na venda. Cancelamento reverte o consumo registrado.

## Abusos, prioridade e controles

| Abuso                                                           | Probabilidade / impacto | Prioridade | Controle                                                                                                     |
| --------------------------------------------------------------- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Trocar IDs para acessar outra loja ou cliente                   | Média / alto            | Alta       | Escopo servidor e consultas por organização/unidade, validação de caixa, local e cliente                     |
| Enviar preço negativo, desconto indevido ou complementos falsos | Média / alto            | Alta       | Centavos inteiros limitados, preços recalculados, grupos min/max, IDs únicos e permissão de desconto         |
| Repetir venda após perda de resposta                            | Alta / alto             | Alta       | Chave idempotente única no escopo e hash do payload; replay não consome estoque novamente                    |
| Fechar caixa junto com venda ou abrir dois caixas               | Média / alto            | Alta       | Operações serializadas por trava no banco e unicidade de caixa aberto                                        |
| Cancelar sem autorização ou mudar receita para ganhar estoque   | Média / alto            | Alta       | Permissão, motivo, caixa aberto e estorno pelo snapshot, com auditoria                                       |
| Marcar Pix/cartão sem pagamento real                            | Média / médio           | Média      | Registro manual explícito na interface; conferência operacional necessária, sem simular confirmação bancária |
| Expor clientes em dados de teste ou capturas versionadas        | Baixa / alto            | Média      | Fixtures locais fictícias; capturas e credenciais não incluídas no commit                                    |

## Riscos residuais e validação

Na gestão de pedidos, a fila usa `PdvPedido` e eventos ligados por organização/unidade/venda, com unicidade da venda e número por unidade. Entradas em `services/pedidos.ts` e `acoes-pedidos.ts` verificam sessão e escopo; leitura exige `pdv.ver`, avanço exige `pdv.operar`. `schemas/pedido.ts` permite apenas a próxima etapa da modalidade; estados terminais não voltam à cozinha. Versão e trava de unidade protegem contra dois operadores avançando o mesmo cartão.

O cancelamento permanece em `services/pdv.ts`, com `pdv.cancelar`, versão opcional do pedido validada antes de qualquer estorno e atualização financeira/estoque/fila/eventos na mesma transação. Uma corrida entre avançar e cancelar não pode confirmar duas alterações da mesma versão. Vendas antigas não são convertidas em produção pela migração. Polling autenticado tem limites de resultados, uma consulta por vez e invalidação de respostas antigas antes de aplicar mudanças na interface. A numeração legível nunca substitui IDs opacos e escopo de autorização.

Na evolução de preparação e carrinhos, o diagnóstico administrativo exige também `pdv.configurar`. Carrinhos persistidos em `pdv_carrinho` usam organização, unidade e autor em toda consulta, não contêm pagamentos ou preços e têm limite de 20 ativos por operador/unidade. As referências de clientes exigem `crm.ver`; a retomada valida novamente o catálogo sem apagar o conteúdo recusado.

`services/carrinhos.ts` serializa save/discard pela mesma trava da venda; versão otimista impede perda de alterações entre abas. Hash da tentativa recupera confirmação de salvamento sem duplicação. `finalizarVenda` confere estado, autor e versão e conclui o carrinho na mesma transação da baixa de estoque. Chaves diferentes para o mesmo carrinho não podem produzir duas vendas. Descarte é lógico e auditado. Testes locais cobrem também concorrência salvar/concluir, retorno de confirmação e tentativas de outro operador/unidade.

Um usuário autorizado a registrar pagamentos manuais pode registrar valores incorretos. O fechamento expõe diferenças de dinheiro, mas não comprova liquidação de cartão/Pix. Não há contingência offline; recarregar/fechar a tela pode perder itens não salvos. O cadastro incorreto de receitas ou vínculos de complementos altera consumo futuro e exige revisão operacional. Não há devolução parcial ou após fechamento nesta entrega.

Validação obrigatória: testes de domínio de preços/troco/complementos, integração local de isolamento, repetição, concorrência e baixa/estorno, navegação Playwright com usuário fictício, `npm run check` e `npm run build`. Nenhum teste usa banco de produção. O relatório descreve controles implementados; resultados executados são informados no encerramento da tarefa.
