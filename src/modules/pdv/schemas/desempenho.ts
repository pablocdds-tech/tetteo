import { z } from "zod";
import { diaPedidos, periodoPedidos } from "./pedido";
import { ErroPdv } from "./erro";
import type {
  DesempenhoPdv,
  IndicadoresPdv,
  RegistroDesempenho,
} from "../desempenho-types";

const esquema = z
  .object({ de: z.string().optional(), ate: z.string().optional() })
  .strict();
function deslocar(dia: string, quantidade: number) {
  const data = new Date(dia + "T12:00:00Z");
  data.setUTCDate(data.getUTCDate() + quantidade);
  return data.toISOString().slice(0, 10);
}
export function periodoDesempenho(entrada: unknown, agora = new Date()) {
  const d = esquema.parse(entrada);
  const de = d.de ?? diaPedidos(agora),
    ate = d.ate ?? diaPedidos(agora);
  const inicio = periodoPedidos(de).inicio,
    fim = periodoPedidos(ate).fim;
  const dias =
    Math.round(
      (Date.parse(ate + "T12:00:00Z") - Date.parse(de + "T12:00:00Z")) /
        86400000,
    ) + 1;
  if (dias < 1 || dias > 92)
    throw new ErroPdv(
      "Selecione um período de até 92 dias, com a data inicial antes da final.",
    );
  const anteriorDe = deslocar(de, -dias),
    anteriorAte = deslocar(de, -1);
  return {
    de,
    ate,
    anteriorDe,
    anteriorAte,
    inicio,
    fim,
    anteriorInicio: periodoPedidos(anteriorDe).inicio,
    dias,
  };
}
const vazio = (): IndicadoresPdv => ({
  pedidos: 0,
  valorCentavos: 0,
  ticketCentavos: null,
  cancelados: 0,
  valorCanceladoCentavos: 0,
  pendentes: 0,
  valorPendenteCentavos: 0,
});
function somarCentavos(a: number, b: number) {
  const total = a + b;
  if (!Number.isSafeInteger(total) || total < 0)
    throw new ErroPdv(
      "O valor dos pedidos excede o limite de cálculo. Reduza o período e confira os valores na origem.",
    );
  return total;
}
export function resumirDesempenho(
  registros: RegistroDesempenho[],
  periodo: ReturnType<typeof periodoDesempenho>,
): DesempenhoPdv {
  const atual = vazio(),
    anterior = vazio();
  const dias = Array.from({ length: periodo.dias }, (_, i) => ({
    dia: deslocar(periodo.de, i),
    pedidos: 0,
    valorCentavos: 0,
  }));
  const mapaDias = new Map(dias.map((d) => [d.dia, d]));
  const modalidades = new Map<
      string,
      { nome: string; pedidos: number; valorCentavos: number }
    >(),
    origens = new Map<
      string,
      { nome: string; pedidos: number; valorCentavos: number }
    >();
  const produtos = new Map<string, number>();
  for (const r of registros) {
    const quando = new Date(r.criadoEm);
    if (quando < periodo.anteriorInicio || quando >= periodo.fim) continue;
    const neste = quando >= periodo.inicio,
      grupo = neste ? atual : anterior;
    if (r.cancelado) {
      grupo.cancelados++;
      grupo.valorCanceladoCentavos = somarCentavos(
        grupo.valorCanceladoCentavos,
        r.totalCentavos,
      );
      continue;
    }
    grupo.pedidos++;
    grupo.valorCentavos = somarCentavos(grupo.valorCentavos, r.totalCentavos);
    if (r.pendente) {
      grupo.pendentes++;
      grupo.valorPendenteCentavos += r.totalCentavos;
    }
    if (!neste) continue;
    const dia = mapaDias.get(diaPedidos(quando));
    if (dia) {
      dia.pedidos++;
      dia.valorCentavos += r.totalCentavos;
    }
    for (const [mapa, nome] of [
      [modalidades, r.modalidade],
      [origens, r.origem],
    ] as const) {
      const agregado = mapa.get(nome) ?? { nome, pedidos: 0, valorCentavos: 0 };
      agregado.pedidos++;
      agregado.valorCentavos += r.totalCentavos;
      mapa.set(nome, agregado);
    }
    for (const i of r.itens)
      produtos.set(i.nome, (produtos.get(i.nome) ?? 0) + i.quantidade);
  }
  for (const g of [atual, anterior])
    g.ticketCentavos = g.pedidos
      ? Math.round(g.valorCentavos / g.pedidos)
      : null;
  return {
    de: periodo.de,
    ate: periodo.ate,
    anteriorDe: periodo.anteriorDe,
    anteriorAte: periodo.anteriorAte,
    atual,
    anterior,
    dias,
    modalidades: [...modalidades.values()].sort(
      (a, b) => b.valorCentavos - a.valorCentavos,
    ),
    origens: [...origens.values()].sort(
      (a, b) => b.valorCentavos - a.valorCentavos,
    ),
    produtos: [...produtos]
      .map(([nome, quantidade]) => ({ nome, quantidade }))
      .sort(
        (a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome),
      )
      .slice(0, 10),
  };
}
