/**
 * O vocabulário de permissões do App de Compras.
 *
 * As separações que importam, todas sobre CONFIANÇA:
 *
 *   REQUISITAR e COTAR   a loja diz o que precisa; quem compra decide de quem.
 *   PEDIR e APROVAR      montar o pedido não é comprometer o dinheiro — aprovar
 *                        é, e passa pela ALÇADA, conferida no servidor.
 *   ENVIAR               reprocessar falha e decidir mensagem incerta é mexer no
 *                        que o fornecedor recebe; fica com quem responde por isso.
 *   RECEBER              conferir o caminhão é da loja, e dá entrada no estoque.
 *
 * Numa pizzaria pequena é tudo a mesma pessoa, e ela recebe todas — mas quando
 * deixa de ser, a separação já está pronta.
 */
export const PERMISSOES_COMPRAS = [
  {
    chave: "compras.ver",
    descricao: "Ver rodadas, pedidos, envios e fornecedores",
  },
  {
    chave: "compras.requisitar",
    descricao: "Preparar e enviar a requisição da própria loja",
  },
  {
    chave: "compras.rodadas",
    descricao: "Abrir, avançar, reabrir e cancelar rodadas de compra",
  },
  {
    chave: "compras.cotar",
    descricao:
      "Convidar fornecedores, lançar propostas e escolher de quem comprar",
  },
  {
    chave: "compras.pedir",
    descricao:
      "Gerar pedidos, fazer adendos e alterações, registrar confirmação",
  },
  {
    chave: "compras.aprovar",
    descricao: "Aprovar e recusar pedidos, dentro da alçada",
  },
  {
    chave: "compras.enviar",
    descricao:
      "Cuidar do envio: reprocessar, resolver incertas, pausar, testar",
  },
  {
    chave: "compras.receber",
    descricao: "Conferir o recebimento e registrar devolução na própria loja",
  },
  {
    chave: "compras.fornecedores",
    descricao: "Cadastrar fornecedores, produtos e o destino das mensagens",
  },
  {
    chave: "compras.configurar",
    descricao: "Mudar alçadas e o número de teste do envio",
  },
] as const;
