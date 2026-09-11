import { Etiqueta } from "@/design-system/etiqueta";

/**
 * AS ETIQUETAS DE ESTADO DE COMPRAS — sempre texto e cor, nunca só cor.
 *
 * Três estados que parecem o mesmo e não são, e por isso cada um tem a sua
 * etiqueta: a MENSAGEM (na fila, aceita pelo canal, entregue), a CONFIRMAÇÃO
 * do fornecedor (o que ele disse) e o RECEBIMENTO (o que chegou).
 */

type Tom = "neutro" | "ok" | "aviso" | "ruim" | "info" | "acento";
type Rotulo = { tom: Tom; texto: string };

const RODADA: Record<string, Rotulo> = {
  RASCUNHO: { tom: "neutro", texto: "Rascunho" },
  COLETANDO: { tom: "info", texto: "Coletando requisições" },
  COTANDO: { tom: "acento", texto: "Em cotação" },
  REVISAO: { tom: "aviso", texto: "Em revisão" },
  APROVADA: { tom: "ok", texto: "Aprovada" },
  DESPACHANDO: { tom: "info", texto: "Enviando pedidos" },
  FECHADA: { tom: "neutro", texto: "Fechada" },
  CANCELADA: { tom: "neutro", texto: "Cancelada" },
};

const REQUISICAO: Record<string, Rotulo> = {
  RASCUNHO: { tom: "aviso", texto: "Não enviada" },
  ENVIADA: { tom: "ok", texto: "Enviada" },
  DEVOLVIDA: { tom: "ruim", texto: "Devolvida para corrigir" },
};

const SOLICITACAO: Record<string, Rotulo> = {
  RASCUNHO: { tom: "neutro", texto: "Não convidado" },
  CONVIDADO: { tom: "info", texto: "Aguardando resposta" },
  RESPONDIDA: { tom: "ok", texto: "Respondeu" },
  RECUSOU: { tom: "neutro", texto: "Não vai cotar" },
  ENCERRADA_SEM_RESPOSTA: { tom: "ruim", texto: "Não respondeu" },
  ENCERRADA: { tom: "ok", texto: "Respondeu" },
};

const PEDIDO: Record<string, Rotulo> = {
  RASCUNHO: { tom: "neutro", texto: "Rascunho" },
  AGUARDANDO_APROVACAO: { tom: "aviso", texto: "Aguardando aprovação" },
  APROVADO: { tom: "ok", texto: "Aprovado" },
  RECUSADO: { tom: "ruim", texto: "Recusado" },
  CANCELADO: { tom: "neutro", texto: "Cancelado" },
  CONCLUIDO: { tom: "neutro", texto: "Concluído" },
};

const ENVIO: Record<string, Rotulo> = {
  BLOQUEADA: { tom: "ruim", texto: "Bloqueada" },
  NA_FILA: { tom: "info", texto: "Na fila" },
  ENVIANDO: { tom: "info", texto: "Saindo agora" },
  ACEITA_PELO_CANAL: { tom: "ok", texto: "Aceita pelo canal" },
  ENTREGUE: { tom: "ok", texto: "Entregue" },
  INCERTA: { tom: "aviso", texto: "Incerta — conferir" },
  FALHOU: { tom: "ruim", texto: "Falhou" },
  CANCELADA: { tom: "neutro", texto: "Cancelada" },
};

const CONFIRMACAO: Record<string, Rotulo> = {
  PENDENTE: { tom: "neutro", texto: "Fornecedor não confirmou" },
  CONFIRMADO: { tom: "ok", texto: "Fornecedor confirmou" },
  CONFIRMADO_COM_RESSALVA: { tom: "aviso", texto: "Confirmou com ressalva" },
  RECUSADO: { tom: "ruim", texto: "Fornecedor recusou" },
};

const RECEBIMENTO: Record<string, Rotulo> = {
  NADA: { tom: "neutro", texto: "Nada recebido" },
  PARCIAL: { tom: "aviso", texto: "Entrega parcial" },
  COMPLETO: { tom: "ok", texto: "Recebido" },
};

function etiqueta(tabela: Record<string, Rotulo>, valor: string) {
  const r = tabela[valor] ?? { tom: "neutro" as Tom, texto: valor };
  return <Etiqueta tom={r.tom}>{r.texto}</Etiqueta>;
}

export const EstadoDaRodada = ({ valor }: { valor: string }) =>
  etiqueta(RODADA, valor);
export const EstadoDaRequisicao = ({ valor }: { valor: string }) =>
  etiqueta(REQUISICAO, valor);
export const EstadoDaSolicitacao = ({ valor }: { valor: string }) =>
  etiqueta(SOLICITACAO, valor);
export const EstadoDoPedido = ({ valor }: { valor: string }) =>
  etiqueta(PEDIDO, valor);
export const EstadoDaConfirmacao = ({ valor }: { valor: string }) =>
  etiqueta(CONFIRMACAO, valor);
export const EstadoDoRecebimento = ({ valor }: { valor: string }) =>
  etiqueta(RECEBIMENTO, valor);

/**
 * A etiqueta do envio diz a VERDADE sobre o canal: mensagem aceita pelo
 * simulador não é mensagem enviada, e enviada à mão é uma declaração.
 */
export function EstadoDoEnvio({
  valor,
  simulada = false,
  enviadaAMao = false,
}: {
  valor: string | null;
  simulada?: boolean;
  enviadaAMao?: boolean;
}) {
  if (enviadaAMao) return <Etiqueta tom="ok">Enviada à mão</Etiqueta>;
  if (!valor) return <Etiqueta tom="neutro">Não enviado</Etiqueta>;
  if (simulada && valor === "ACEITA_PELO_CANAL") {
    return <Etiqueta tom="aviso">Simulado — nada saiu</Etiqueta>;
  }
  return etiqueta(ENVIO, valor);
}

export const ROTULO_DA_RODADA = Object.fromEntries(
  Object.entries(RODADA).map(([k, v]) => [k, v.texto]),
);
export const ROTULO_DO_PEDIDO = Object.fromEntries(
  Object.entries(PEDIDO).map(([k, v]) => [k, v.texto]),
);
