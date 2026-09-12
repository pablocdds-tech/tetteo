# Assistente privado — roteiro de demonstração em três telas

Escrito em 12/09/2026. Um roteiro curto para mostrar o assistente a
alguém, em três passos: a configuração, a conversa, e o resultado no
Tetteo.

**Todos os números que aparecem nas telas abaixo são dados fictícios**,
gerados de propósito por uma ferramenta de demonstração, para testar o
assistente sem usar nenhuma informação real da Vitaliano Pizzaria.

## Tela 1 — a configuração

**O que mostrar:** a página de configurações do assistente no painel do
OpenClaw, seção "MCP", com o servidor **fechamento** ativado — o único
servidor de ferramentas que o assistente enxerga.

**O que falar:** "O assistente só tem uma caixa de ferramentas: essa aqui,
chamada 'fechamento'. Ela lê os arquivos de vendas autorizados, calcula o
fechamento do período e salva relatórios e rascunhos. Não tem terminal,
não tem navegador, não manda mensagem para ninguém — só isso. Isso não é
uma promessa do modelo de IA, é uma trava na configuração: mesmo que
alguém peça outra coisa, a ferramenta simplesmente não existe para ele
usar."

**Print:** `../telas/assistente-privado/1-configuracao.png` — dados
fictícios.

## Tela 2 — a conversa (o fluxo principal)

**O que mostrar:** uma conversa real, feita nos testes ao vivo de
12/09/2026, pedindo o fechamento dos últimos 30 dias da Loja Centro. Na
tela aparece o pedido, os dois passos da ferramenta (calcular e depois
salvar) e o fechamento pronto: total, número de pedidos, ticket médio,
dias com venda, e as ações propostas como rascunho — nada executado.

**O que falar:** "Eu peço em português simples: 'feche os últimos 30 dias
da Loja Centro e salve o relatório'. Quem calcula é a ferramenta, não o
modelo — o modelo só lê o resultado e escreve a resposta. Repare que
mesmo aqui, fictício, ele já aponta os dias sem venda no arquivo e um dia
fora da curva, e termina dizendo que nada foi executado — só preparado."

Repare também que o campo de nova mensagem, no rodapé, mostra "Nenhum
modelo disponível" — isso é só uma falha de exibição do catálogo do
mecanismo da assinatura (ver `versoes-e-fontes.md`, seção "Limites
conhecidos"); a conversa acima já mostra o modelo certo respondendo
normalmente.

**Print:** `../telas/assistente-privado/2-fluxo-principal.png` — dados
fictícios; a conversa e os valores (Total R$ 47.085,81, 1.075 pedidos,
ticket médio R$ 43,80) vêm do arquivo de demonstração gerado para o
teste, não de vendas reais.

## Tela 3 — o resultado no Tetteo

**O que mostrar:** o cartão do assistente no Painel da operação do
Tetteo, com Conexão, Última execução, Próxima rotina e Pendências.

**O que falar:** "E isso aparece resumido aqui no Tetteo, no mesmo painel
que você já usa todo dia — sem precisar abrir mais nada."

**Print:** `../telas/assistente-privado/3-resultado-cartao-no-painel.png`
— dados fictícios.

**Atenção ao explicar esta tela:** o "Conectado" que aparece neste print
veio de um **ensaio local** (Task 16), feito na máquina de
desenvolvimento, sem nenhum modelo de verdade por trás — o próprio recado
de verificação usado nesse ensaio dizia literalmente "teste local, sem
modelo". Esse print **não prova** conexão real com a conta ChatGPT do
Pablo. Essa prova só existe nas Telas 1 e 2 acima, feitas depois do login
de verdade e da verificação ao vivo no servidor (ver
`verificacao.md`, seção "Ambiente de demonstração").
