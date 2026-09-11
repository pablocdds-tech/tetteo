import { headers } from "next/headers";

/**
 * O FREIO DA PÁGINA PÚBLICA — por endereço de rede, na memória do servidor.
 *
 * O código do link tem 256 bits: adivinhar não é o risco. O freio existe para
 * o robô que martela a página e para o formulário enviado em laço, e se soma
 * às travas do próprio link (dez envios inválidos o bloqueiam; um envio a cada
 * dez segundos).
 *
 * Fica na memória de cada cópia do servidor — com duas cópias, o limite
 * efetivo dobra. Para um link por fornecedor por semana, basta.
 */

const REGRAS = {
  ler: { maximo: 30, janelaMs: 60_000 },
  enviar: { maximo: 12, janelaMs: 60_000 },
} as const;

const vistos = new Map<string, number[]>();

export async function passouDoLimite(
  tipo: keyof typeof REGRAS,
): Promise<boolean> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "desconhecido";
  const regra = REGRAS[tipo];
  const agora = Date.now();
  const chave = `${tipo}:${ip}`;

  const recentes = (vistos.get(chave) ?? []).filter(
    (t) => agora - t < regra.janelaMs,
  );
  recentes.push(agora);
  vistos.set(chave, recentes);

  // Faxina: endereços que não aparecem há um minuto saem da memória.
  if (vistos.size > 10_000) {
    for (const [k, v] of vistos) {
      if (v.every((t) => agora - t >= 60_000)) vistos.delete(k);
    }
  }
  return recentes.length > regra.maximo;
}
