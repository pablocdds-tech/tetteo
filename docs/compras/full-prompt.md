# Full Prompt — Compras de restaurante: da lista da loja à conferência do recebimento

**Resumo.** Em restaurante com mais de uma unidade, a compra da semana costuma
viver em mensagem de WhatsApp, planilha e memória: a loja pede de cabeça, o
comprador cota fornecedor por fornecedor, preço de caixa de 12 × 900 g é
comparado com preço por quilo, o frete some da conta, ninguém sabe se o pedido
saiu, e a mercadoria que chega pela metade vira discussão. Esta especificação
descreve um App de Compras que liga a lista da loja à conferência do
recebimento, com preço sempre comparado na mesma unidade, aprovação com alçada
conferida no servidor, fila de envio que nunca manda duas vezes e entrada no
estoque na mesma transação da conferência.

---

```text
CONSTRUA UM APP DE COMPRAS PARA [NOME DO RESTAURANTE] — DA LISTA DA LOJA À CONFERÊNCIA DO RECEBIMENTO

1. OBJETIVO E CONTEXTO DA OPERAÇÃO
Construa um App de Compras para resolver a compra semanal de insumos em [TIPO DE OPERAÇÃO] com [UNIDADES] (uma ou mais lojas). Quem usa:
- Gerente de loja: diz o que a loja precisa (requisição) e confere o que chegou (recebimento).
- Comprador: abre a rodada, convida fornecedores, lança respostas, compara e escolhe, gera pedidos, cuida do envio.
- Diretor/dono: aprova pedidos dentro da alçada.
- Fornecedor: responde a cotação por um link, sem login.
Entrada: listas das lojas, cadastro de fornecedores e do que cada um vende (com embalagem), propostas de preço.
Saída: pedidos aprovados e congelados por loja × fornecedor, mensagens aos fornecedores com situação rastreável, entradas no estoque pela nota de entrada, divergências a conciliar e conta a pagar sem duplicar.
Exemplo fictício: a Loja Centro pede 20 kg de molho; a Distribuidora A vende caixa de 12 × 900 g por R$ 96,00 e a B vende balde de 10 kg por R$ 92,00. O sistema converte (10,8 kg por caixa), arredonda para embalagens inteiras por loja (2 caixas = 21,6 kg, +1,6 kg a mais, com o custo do excesso mostrado), soma frete e mínimo por entrega, sugere a combinação de menor custo total e o comprador escolhe item a item. O Diretor aprova; a mensagem vai para a fila; a loja confere 1 caixa de 2 e o saldo fica pendente.

2. ESCOPO E PERSONALIZAÇÃO
Funciona (implementar de ponta a ponta):
- Rodada com estados RASCUNHO → COLETANDO → COTANDO → REVISÃO → APROVADA → ENVIANDO PEDIDOS → FECHADA, e CANCELADA. Voltar é "reabrir" e exige motivo; cancelar exige motivo; rodada fechada não se cancela.
- Rodada automática semanal por agenda (dia e hora), uma por semana (chave ISO da semana no fuso da organização).
- Requisição por loja com sugestão calculada no servidor (mínimo − disponível − já pedido e não recebido), com a conta escrita.
- Consolidação: soma só requisições ENVIADAS; loja que não enviou fica de fora, registrado; item com fornecedor fixo vira compra direcionada.
- Cotação por link público com código secreto, expiração, revogação, reemissão e freios.
- Comparação com conversão por dimensão, embalagens inteiras por loja, frete e mínimo por entrega, sugestão de menor custo total por combinação de fornecedores, escolha com justificativa.
- Pedidos por loja × fornecedor, congelados na aprovação; alçada por papel com versão; adendo (só itens novos) e alteração/cancelamento (só diminui).
- Fila durável de mensagens com idempotência, tentativas, trava por mensagem, estado "incerta", reprocessar, pausar, número de teste, simulador e envio manual declarado.
- Recebimento parcial acumulado, excedente e substituição com decisão obrigatória, avaria fora do estoque, lote, validade, fotos, devolução, divergências, encerramento de saldo.
Fora do escopo: pagamento bancário; leitura de XML da NF-e (a nota é digitada ou ligada a uma já lançada); ranking de qualidade de fornecedor.
Antes de construir, confirme com o dono: [UNIDADES]; quem aprova e até quanto ([RESPONSÁVEIS] e alçadas); se o envio começa em simulador (recomendado) ou em WhatsApp real; fuso da operação (padrão America/Sao_Paulo). Se já existe sistema com estoque e financeiro, integre com eles em vez de criar cadastros paralelos.

3. TECNOLOGIAS, DEPENDÊNCIAS E REQUISITOS
Obrigatório (versões usadas): Next.js 16.3 (App Router, Server Components, Server Actions, Route Handlers; o arquivo de interceptação chama-se proxy.ts), React 19.2, TypeScript 5, Prisma 7.9 com PostgreSQL (@prisma/adapter-pg), Tailwind CSS 4, Zod 4, Auth.js 5 (e-mail e senha, bcryptjs), tsx para scripts e testes com o executor nativo do Node.
Opcional: Evolution API (WhatsApp) para envio real; Playwright só para conferência visual em desenvolvimento.
Hospedagem: servidor Node com PostgreSQL, uma tarefa agendada que chame uma rota a cada minuto e uma pasta persistente para fotos. Custos: [NÃO INFORMADO].
Código em monólito modular: um módulo não importa outro; conectores externos não importam módulos; só a camada de rotas junta Compras, Estoque e Financeiro.

4. SISTEMA VISUAL GLOBAL
Direção: sistema operacional de restaurante, denso e calmo; tarefa visível, uma ação primária por tela, pouco deslocamento. Sem hero, sem marketing.
Cores (tema claro): fundo #f2f3f5; superfície #fdfdfe; superfície 2 #ebecef; superfície 3 #e0e2e7; linha #dbdde2; linha forte #838790; texto #202124 / #45484f / #646870; destaque #0066cc (texto #ffffff, fundo suave #e3eefc); ok #1a7548 / #e2f2e9; aviso #8a5b00 / #f8efdd; ruim #c0342a / #fbe9e7; informação #0b6e99 / #e2f1f7. Há tema escuro com os mesmos papéis (fundo #0f1114, superfície #191b1f, texto #eceef1, destaque #6cb0ff). Todo par de cor passa em WCAG AA.
Tipografia: fonte do sistema (-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial), sem baixar fonte. Título da tela 24/30 px no celular e 28/34 px no computador, peso 600; título de seção 15/24 px peso 600; texto 14 px; apoio 12 px; números com algarismos tabulares.
Formas: raio 6 px (etiqueta), 8 px (botão e campo), 12 px (cartão); cartão com borda de 1 px e sem sombra; só o que flutua (barra fixa, menu) tem sombra. Botões de 32/40/48 px; campos de 40 px no computador e 44 px no celular; foco de teclado sempre visível (contorno de 2 px na cor de destaque).
Largura máxima de conteúdo 1400 px; barra lateral fixa a partir de 1180 px, gaveta abaixo disso.
Estado sempre em TEXTO + cor: etiqueta com ponto e palavra ("Aguardando aprovação", "Simulado — nada saiu", "Entrega parcial"). Nunca só cor.
Ícones: conjunto próprio de SVG em linha (carrinho, entrega, grade, relógio, check, alerta, setas, fechar, lupa, filtro).

5. TELAS, ROTAS E NAVEGAÇÃO
Menu do App (cada item só para quem tem a permissão): Rodadas, Requisição, Comparação, Aprovação, Pedidos e envios, Recebimento, Fornecedores, Configurações. Filtros de lista ficam no endereço (?loja=&estado=&rodada=) e o "← voltar" do detalhe devolve o mesmo recorte. Lista vazia ensina o próximo passo; filtro sem resultado oferece "Limpar filtros"; "nada pendente" aparece como boa notícia. Erro em frase que diz o que fazer, sem apagar o que foi digitado (formulários enviados pelo onSubmit). Sem permissão: "não encontrado".
5.1 Rodadas (/compras): filtros Loja e Estado, botão "Nova rodada"; tabela com rodada, estado (+ "Prazo vencido"), lojas (enviou N itens / não enviou / devolvida), prazo da etapa, entrega, propostas (N de M), pedidos (N aguardando), aberta em.
5.2 Nova rodada: nome (sugerido "Semana 37"), lojas (todas marcadas), prazo da lista e da cotação (data e hora sugeridas), janela de entrega, observação; "Abrir rodada" cria em rascunho.
5.3 Rodada (/compras/rodadas/[id]): etapas em pílulas (feito/agora/depois); "Próximo passo" com UM botão verbal por estado ("Abrir coleta das requisições", "Consolidar e abrir cotação", "Encerrar cotação", "Revisar propostas", "Concluir aprovação", "Passar para envio e entrega", "Fechar rodada"), confirmação nos passos irreversíveis, "Reabrir para…" e "Cancelar rodada" com motivo; prazos; lojas e requisições ("Devolver para corrigir" com motivo); itens (total, por loja, "Fornecedor fixo"/"Em disputa", "Colocar em disputa" com motivo); fornecedores em largura inteira (situação, última resposta com versão e origem, link e convite; Convidar, Copiar link, Copiar convite, Lançar resposta, Mandar link novo, Desativar link, Não vai cotar); incluir fornecedor fora do cadastro.
5.4 Lançar resposta: o formulário da 5.12 + "como chegou" (digitada/negociação), motivo e autorização de preço zero; ao lado, as versões recebidas.
5.5 Requisição (/compras/requisicao): exige loja escolhida. Estado, prazo e motivo de devolução. Busca e recortes (Na lista / Abaixo do mínimo / Todos); por insumo: tem agora ("não contado"), mínimo, já pedido, sugestão com a conta e "Usar 12 kg", campo "Pedir" na unidade de estoque, observação, alertas. Barra fixa: "N itens · alterações não salvas", "Salvar lista", "Enviar requisição" (só com tudo salvo).
5.6 Comparação (/compras/comparacao?rodada=) [Print 1]: indicadores (sugestão de menor custo, escolhido até agora e diferença, propostas recebidas, itens). Grade item × fornecedor; célula: custo do item inteiro, preço e descrição da embalagem, preço por unidade, "N embalagens = X kg", "+Y a mais por arredondar (R$ Z)", etiquetas Menor custo/Sugerido/Escolhido e botão "Escolher" (pede frase se difere da sugestão ou se falta quantidade). Estados escritos: "Sem resposta", "Não tem o item", "Não foi pedido a ele", "Conferir embalagem" + motivo, "Preço zero sem autorização", "Não tem a quantidade toda". Rodapé por fornecedor: mercadoria, frete (N entregas ou "Não informado"), mínimo (atende/não atinge), total com frete (ou "falta o frete"), prazo, cotou N de M. Cartões: sugestão (quem ficou de fora e por quê; sem ranking de qualidade), itens de fornecedor fixo (preço confirmado ou de referência com data e origem) e "Gerar pedidos para aprovação" (marcar o que não será comprado). Celular: um cartão por item.
5.7 Aprovação: cartão por pedido pendente (fornecedor, loja, entrega, total, itens com origem do preço, aviso de frete não informado, a alçada de quem olha); "Aprovar pedido" (confirma o valor), "Recusar" (motivo), "Abrir e ajustar".
5.8 Pedidos e envios: aba Pedidos (referência PC-0104/1, loja, fornecedor, situação, envio, resposta do fornecedor, recebimento, entrega, total — três fatos em três colunas) e aba Envios (aviso do simulador, pausar/retomar com motivo, mensagens com tipo, destino, situação e motivo, tentativas; Copiar mensagem, Mandei pelo meu WhatsApp, Tentar de novo, Usar o número novo, Conferi: chegou / Não chegou: reenviar).
5.9 Pedido (/compras/pedidos/[id]) [Print 2]: etiquetas de pedido, confirmação e recebimento; itens congelados com totais e a regra de arredondamento escrita; "Situação do envio" em linha do tempo (aprovado por, na fila para, simulador aceitou — nada saiu, entregue, incerta, falhou, enviada à mão, e o que falta em destaque); resposta do fornecedor; aprovação (quem, valor, versão da alçada); alterações e adendos; recebimentos; divergências; dados congelados.
5.10 Recebimento: pedidos esperando entrega e divergências abertas ("Resolver" com frase).
5.11 Conferência (/compras/recebimento/[id]) [Print 3]: onde guardar; nota (lançar agora ou ligar a uma já lançada); "Chegou tudo o que falta"; por item: pedido, já entrou, falta, chegou bom na unidade de compra ("= 21,6 kg no estoque"), avariado, "Lote, fotos…" (lote, validade, observação, até 6 fotos pela câmera, "veio outro produto" com decisão); decisão de excedente quando chega mais que falta; conta a pagar; "Conferir recebimento" com confirmação. Abaixo: entregas conferidas com devolução, divergências, "Encerrar o saldo pendente".
5.12 Página do fornecedor (/fornecedor/cotacao#código, sem login, sem menu, sem indexação): restaurante, fornecedor, rodada, prazo, entrega, lojas com endereço; por item: quantidade, "Tenho — vou cotar / Não trabalho com este item / Deixar em branco", embalagem fechada ou a granel, embalagem, peças, conteúdo e unidade, preço por embalagem, disponível, observação e prévia da conversão ("Caixa: 12 × 900 g = 10,8 kg · R$ 8,89/kg" ou "Falta quanto pesa cada peça"); frete por entrega (0 = grátis, vazio = não informado), mínimo, prazo, validade; "Enviar proposta". Link inválido, vencido, revogado ou bloqueado: só uma frase.
5.13 Fornecedores: coluna "Mensagens de pedido" (Autorizado / Sem autorização / Sem telefone); detalhe com o que ele vende (embalagem em partes, conversão ou "Conferir", fixo, referência), destino das mensagens e cadastro. Configurações: alçadas com versão e histórico, envio (canal, pausa, número de teste, teste) e rodada automática.

6. COMPONENTES E INTERAÇÕES
Botão de ação com resultado (Server Action; frase de erro ou sucesso embaixo; envio único por ref, contra duplo clique; motivo e confirmação opcionais); Copiar (busca o texto no servidor no clique e registra a cópia); Tabela (tabela a partir de 768 px, cartões abaixo; rolagem lateral só dentro da região); filtros no endereço; barras fixas de ação no rodapé; foto pela câmera (até 5 MB, JPEG/PNG/WebP conferidos pela assinatura). Só transições de cor de 150 ms.

7. DADOS E REGRAS DO NEGÓCIO
Entidades (PostgreSQL): Fornecedor (telefone de pedidos, autorizado); FornecedorInsumo (embalagem em partes, fator com origem e versão, fixo único por insumo, preço de referência com origem e data); AgendaDeRodada; RodadaDeCompra (número, estado, versão, prazos, janela, motivo de reabertura; agenda+semana única); Requisicao/ItemDeRequisicao (quantidade, sugestão e fórmula); ItemDaRodada (total, cotável/direcionado, motivo da exceção); SolicitacaoDeCotacao (hash e cópia cifrada do código, validade, revogação, tentativas, versão); VersaoDeProposta/ItemDeProposta (cotado/indisponível, fator ou motivo, preços, zero autorizado, disponível); EscolhaDeItem (seguiu a sugestão, justificativa); AlcadaDeCompra (limite, versão, uma vigente por papel); AprovacaoDeCompra (valor, alçada, versão); Pedido (tipo, origem e sequência, status, versão, snapshot, totais, regra de arredondamento, confirmação, situação do recebimento); ItemDePedido (embalagem congelada, embalagens, necessário, comprado, adicional, preços, origem do preço, cancelado); AlteracaoDePedido; MensagemAoFornecedor (tipo, referência, destino congelado, bloqueio, simulada, chave única, estado, tentativas, trava, carimbos, enviada à mão); Recebimento/ItemDeRecebimento (bom, avariado, recusado, lote, validade, fotos, chave única); DivergenciaDeCompra; Arquivo; Auditoria (quem, quando, antes, depois).
Contas: dinheiro em centavos inteiros; quantidade em milésimos; fator de embalagem × 10.000; preço por unidade × 1.000.000; nada em ponto flutuante. Conversão só na mesma dimensão (g↔kg, ml↔L, un); peça sem peso ou dimensão errada = "conferir", fora da disputa. Embalagens inteiras POR LOJA. Cada linha arredonda uma vez, meio para cima; total = soma das linhas + frete; a regra fica gravada no pedido.
Sugestão: frete e mínimo por entrega (loja atendida); fornecedor sem frete informado fica de fora; testa todas as combinações até 12 fornecedores (acima, o mais barato por item, com aviso); descarta combinação que não atinge mínimo.
Concorrência: toda mudança de estado confere a versão (escrita condicional) e trava a linha (SELECT … FOR UPDATE); a fila pega mensagens com FOR UPDATE SKIP LOCKED e trava de 2 minutos; recebimento e devolução usam chave de idempotência gerada quando a tela abre; entrada no estoque e recebimento na mesma transação.
Permissões (no servidor): compras.ver, .requisitar, .rodadas, .cotar, .pedir, .aprovar (mais alçada), .enviar, .receber, .fornecedores, .configurar. Loja só vê e mexe no que é dela.
Fuso: America/Sao_Paulo para prazos, datas e a chave da semana.
Recuperação: nada se edita depois de registrado — reabrir com motivo, adendo, alteração, devolução, encerrar saldo; divergência fecha com frase.
Dados de exemplo (fictícios): "Rede Exemplo", lojas "Exemplo Centro" e "Exemplo Sul", "Distribuidora Exemplo A/B", "Atacado Exemplo C", "Laticínio Exemplo" (fixo de mussarela), telefones 5500000000001…, molho (caixa 12 × 900 g / balde 10 kg), farinha (saco 25 kg / saco 5 kg), calabresa (peça 2 kg / peça sem peso), azeite (caixa 12 × 500 ml), caixa de pizza (fardo 50 / fardo 100).

8. INTEGRAÇÕES E SEGURANÇA
- Canal de mensagem: contrato único enviar(destino, texto, chave) → aceita (id do provedor) | recusada antes de sair (pode tentar de novo?) | incerta; consultar(chave) → aceita | não encontrada | desconhecido. Implementados: SIMULADOR (padrão, nada sai; a tela diz "Simulado — nada saiu") e WhatsApp via Evolution API (implementado e desligado; instância e token próprios de Compras, recusado se for a instância do atendimento; nunca liga em teste). Não houve teste com número real. Dependem de homologação: número e instância, aviso de entrega (webhook), consulta por referência. Documentação: https://doc.evolution-api.com
- Relógio: POST /api/compras/tick com cabeçalho secreto, a cada minuto; sem o segredo configurado a rota fica fechada.
- Link do fornecedor: código aleatório de 256 bits, guardado só como hash SHA-256 e uma cópia cifrada (AES-256-GCM, chave derivada do segredo do app) para copiar de novo; o código vai depois do "#" (fora de log e de Referer); vence no prazo; freios: 10 envios inválidos bloqueiam, 1 envio a cada 10 s, até 30 versões, limite por endereço de rede; a página nunca mostra preço de concorrente nem de referência.
- Segredos só em variáveis de ambiente do servidor: [CONFIGURAR CREDENCIAL LOCALMENTE]. Nunca em código, prompt, print ou URL.
- Estoque e Financeiro: a conferência lança a nota de entrada do Estoque na mesma transação (custo médio ponderado) ou liga a uma nota já lançada; a conta a pagar vem da importação de notas do Financeiro, uma por nota. Sem esses módulos no sistema de destino: [NÃO INFORMADO] — decida como integrar.

9. PRINTS E ARQUIVOS DE REFERÊNCIA
Print 1 — Comparação de propostas: rodada em revisão, três fornecedores (um sem resposta), sugestão de menor custo total, escolha diferente da sugestão com justificativa, embalagem sem conversão, item que o fornecedor não tem.
Print 2 — Pedido aprovado com a situação do envio: itens congelados com origem do preço, linha do tempo pelo simulador, fornecedor confirmou, entrega parcial.
Print 3 — Conferência de recebimento parcial: já entrou e falta por item, contagem na unidade de compra, nota fiscal e conta a pagar.
Todos com dados fictícios. O texto desta especificação vale sem os prints.

10. RESPONSIVIDADE E USO NO RESTAURANTE
Computador: barra lateral fixa a partir de 1180 px; tabelas densas; detalhe com coluna lateral (próximo passo, situação do envio). Celular: tabelas viram cartões abaixo de 768 px; alvos de toque de 44 px; barras de ação fixas no rodapé; a conferência funciona inteira no celular, com foto pela câmera; a página do fornecedor é de uma coluna e funciona no celular dele. Nenhuma página rola para o lado. Impressão física não foi validada.

11. IMPLEMENTAÇÃO, INSTALAÇÃO E ENTREGA
Estrutura: src/modules/compras/{schemas (regras puras testáveis), services (banco), components, acoes.ts (Server Actions)}; src/app/(shell)/compras/... (telas); src/app/fornecedor/cotacao (página pública com freio); src/app/api/compras/tick (relógio); src/app/api/arquivos (fotos); src/connectors/fornecedores (simulador e WhatsApp); orquestrador do recebimento na camada de rotas (Compras + Estoque + Financeiro). Sequência: 1) esquema e migração; 2) regras puras com testes (aritmética, embalagem, sugestão, comparação, pedido, alçada, link, proposta, recebimento, ritmo de envio); 3) serviços com testes em banco real; 4) fila e relógio; 5) telas; 6) conferência no navegador em computador e celular.
Comandos: npx prisma migrate deploy; npm run seed (o Diretor ganha alçada sem limite); npx tsx prisma/compras-demo.ts (demonstração; recusa banco que não seja local de desenvolvimento; --apagar remove); npm test; npm run test:integracao (banco com "_test" no nome); npm run build.
Variáveis (sem valores): DATABASE_URL, AUTH_SECRET, APP_URL, COMPRAS_CANAL (simulador | whatsapp), EVOLUTION_URL, COMPRAS_EVOLUTION_INSTANCIA, COMPRAS_EVOLUTION_API_KEY, COMPRAS_TICK_SEGREDO, ARQUIVOS_DIR (pasta persistente de fotos).

12. CRITÉRIOS DE ACEITE, TESTES E LIMITAÇÕES
Dado um insumo com fornecedor fixo, quando a coleta é consolidada, então ele vira compra direcionada e só sai da disputa com motivo.
Dado 12 × 900 g, quando o fornecedor responde, então o servidor grava fator 10,8 kg e a versão 1; nova resposta é versão 2 e a 1 não muda.
Dado um link revogado, vencido ou com 10 envios inválidos, quando o fornecedor envia, então é recusado com uma frase e nada é gravado.
Dado preço zero pelo link, então é recusado; pelo comprador, só com autorização e motivo.
Dado um fornecedor sem resposta, então a célula diz "Sem resposta" e ele não entra na sugestão como oferta.
Dado "1 peça" sem peso para um insumo em kg, então a célula diz "Conferir embalagem" e não pode ser escolhida.
Dado 20 kg pedidos e caixa de 10,8 kg, então compra 2 caixas por loja e mostra +1,6 kg e o custo do excesso.
Dado um fornecedor mais barato por item mas com frete ou mínimo que piora o total, então a sugestão escolhe a combinação de menor total.
Dado uma escolha diferente da sugestão, sem justificativa, então é recusada.
Dado um total acima da alçada, então o servidor recusa a aprovação — inclusive para o Diretor com alçada limitada.
Dado duas aprovações ao mesmo tempo, então uma passa e sai uma mensagem só; aprovar a versão velha de um pedido ajustado é recusado.
Dado um pedido aprovado, então ele não se edita: aumentar é adendo (só os itens novos, sequência /2), diminuir é alteração com mensagem própria.
Dado que o telefone do fornecedor mudou com a mensagem na fila, então ela não segue sozinha.
Dado dois servidores batendo o relógio, então cada mensagem sai uma vez; resposta perdida depois de enviar vira "incerta" e não reenvia sozinha; canal fora do ar espera 1, 4, 9, 16 min e desiste na quinta tentativa.
Dado uma loja tentando ver ou conferir o pedido de outra, então recebe "não encontrado".
Dado 1 de 2 caixas entregue, então entra 10,8 kg no estoque e o saldo fica pendente; a segunda entrega conclui.
Dado excedente ou substituição sem decisão, então a conferência não passa; avaria não entra no estoque e abre divergência.
Dado duplo clique ou duas conferências ao mesmo tempo, então há um recebimento, uma nota e uma entrada; falha no meio não deixa nada gravado.
Dado uma nota já lançada à mão, então a conferência se liga a ela sem segunda entrada; a conta a pagar nunca duplica.
Testes executados: 281 testes de regra (o projeto inteiro) e 68 testes de integração com banco real cobrindo os cenários acima; conferência no navegador (Playwright) em 1440 × 900 e em celular 390 × 844 com dados fictícios, incluindo envio real de uma proposta pelo link copiado e o bloqueio de acesso entre lojas.
Recomendados antes de usar: número de WhatsApp real de Compras; relógio agendado em produção; volume persistente de fotos; um ciclo completo com fornecedores reais.
Limitações: sem aviso de entrega do WhatsApp a mensagem para em "aceita pelo canal"; "incerta" é decidida por pessoa até existir consulta por referência; sem leitura de XML de NF-e; o freio da página pública é por servidor (com duas cópias, o limite dobra); sem ranking de qualidade.
```
