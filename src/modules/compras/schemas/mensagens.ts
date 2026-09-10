/**
 * OS TEXTOS QUE VÃO AO FORNECEDOR.
 *
 * Todo texto termina com a REFERÊNCIA ("Ref. PC-0104/1"). É ela que permite
 * a uma pessoa achar a mensagem no WhatsApp quando o envio ficou incerto — e
 * é ela que o fornecedor cita ao confirmar.
 *
 * O convite leva "{{LINK}}" no lugar do link: o código do link não é gravado
 * em texto puro em lugar nenhum, nem na fila. Ele é decifrado e colocado no
 * texto só na hora de enviar ou de copiar.
 *
 * Nada aqui fala de preço de concorrente, custo interno ou outra loja.
 */

export const MARCADOR_DO_LINK = "{{LINK}}";

export function referenciaDoPedido(numero: number, sequencia: number): string {
  return `PC-${String(numero).padStart(4, "0")}/${sequencia}`;
}

export type LinhaDaMensagem = {
  nome: string;
  /** "2 × Caixa (12 × 900 g)" ou "6,5 kg a granel" */
  quanto: string;
  /** "21,6 kg" — na unidade de estoque, para ninguém ter dúvida. */
  quantidade: string;
  /** "R$ 95,40 a caixa" */
  preco: string;
  total: string;
};

type Cabecalho = {
  referencia: string;
  organizacao: string;
  fornecedor: string;
  contato: string | null;
  loja: string;
  endereco: string | null;
  entrega: string | null;
  condicaoPagamento: string | null;
};

function cabecalho(c: Cabecalho, titulo: string): string[] {
  return [
    `*${titulo} — ${c.organizacao}*`,
    `Para: ${c.fornecedor}${c.contato ? ` (${c.contato})` : ""}`,
    "",
    `Entregar em: ${c.loja}${c.endereco ? ` — ${c.endereco}` : ""}`,
    ...(c.entrega ? [`Entrega: ${c.entrega}`] : []),
    ...(c.condicaoPagamento ? [`Pagamento: ${c.condicaoPagamento}`] : []),
    "",
  ];
}

function linhas(itens: LinhaDaMensagem[]): string[] {
  return itens.map(
    (l) => `• ${l.nome}: ${l.quanto} = ${l.quantidade} · ${l.preco} → ${l.total}`,
  );
}

export function textoDoPedido(
  p: Cabecalho & {
    itens: LinhaDaMensagem[];
    subtotal: string;
    frete: string;
    total: string;
    observacao: string | null;
  },
): string {
  return [
    ...cabecalho(p, `Pedido ${p.referencia}`),
    ...linhas(p.itens),
    "",
    `Subtotal: ${p.subtotal}`,
    `Frete: ${p.frete}`,
    `*Total: ${p.total}*`,
    ...(p.observacao ? ["", `Obs.: ${p.observacao}`] : []),
    "",
    "Por favor, confirme este pedido respondendo esta mensagem.",
    `Ref. ${p.referencia}`,
  ].join("\n");
}

export function textoDoAdendo(
  p: Cabecalho & {
    pedidoOriginal: string;
    itens: LinhaDaMensagem[];
    total: string;
  },
): string {
  return [
    ...cabecalho(p, `Adendo ${p.referencia}`),
    `Acréscimo ao pedido ${p.pedidoOriginal}. O pedido original continua valendo; entram só os itens abaixo:`,
    "",
    ...linhas(p.itens),
    "",
    `*Total do adendo: ${p.total}*`,
    "",
    "Por favor, confirme este adendo respondendo esta mensagem.",
    `Ref. ${p.referencia}`,
  ].join("\n");
}

export function textoDaAlteracao(p: {
  referencia: string;
  pedidoOriginal: string;
  organizacao: string;
  fornecedor: string;
  cancelamento: boolean;
  mudancas: { nome: string; antes: string; depois: string }[];
  motivo: string;
}): string {
  const titulo = p.cancelamento
    ? `Cancelamento do pedido ${p.pedidoOriginal}`
    : `Alteração do pedido ${p.pedidoOriginal}`;
  return [
    `*${titulo} — ${p.organizacao}*`,
    `Para: ${p.fornecedor}`,
    "",
    ...(p.cancelamento
      ? ["O pedido inteiro está cancelado."]
      : p.mudancas.map((m) => `• ${m.nome}: de ${m.antes} para ${m.depois}`)),
    "",
    `Motivo: ${p.motivo}`,
    "",
    "Por favor, responda confirmando se está de acordo.",
    `Ref. ${p.referencia}`,
  ].join("\n");
}

export function textoDoConvite(c: {
  organizacao: string;
  fornecedor: string;
  contato: string | null;
  rodada: string;
  prazo: string;
  itens: { nome: string; quantidade: string }[];
}): string {
  return [
    `Olá${c.contato ? `, ${c.contato}` : ""}! A ${c.organizacao} pede a cotação da ${c.fornecedor} para: ${c.rodada}.`,
    "",
    ...c.itens.map((i) => `• ${i.nome}: ${i.quantidade}`),
    "",
    `Responda até ${c.prazo} por este link, que mostra também o endereço de entrega:`,
    MARCADOR_DO_LINK,
    "",
    "O link é só da sua empresa e vale até o prazo. Por favor, não repasse.",
  ].join("\n");
}
