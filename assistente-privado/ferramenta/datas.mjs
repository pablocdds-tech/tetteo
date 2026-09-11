/**
 * AS DATAS DA FERRAMENTA.
 *
 * Tudo é "AAAA-MM-DD" em texto, no fuso de São Paulo. `Date` só entra para
 * descobrir "que dia é hoje lá"; conta de dias é feita em UTC sobre a data
 * pura, para horário de verão (se voltar) nunca comer um dia.
 */

const FUSO = "America/Sao_Paulo";

const formatadorIso = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-09-11" — o dia de hoje em São Paulo. */
export function hojeEmSaoPaulo(agora = new Date()) {
  return formatadorIso.format(agora);
}

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** "AAAA-MM-DD" ou "DD/MM/AAAA" → "AAAA-MM-DD"; null se o dia não existe. */
export function lerData(texto) {
  const t = String(texto ?? "").trim();
  let ano, mes, dia;
  let r = RE_ISO.exec(t);
  if (r) [, ano, mes, dia] = r;
  else if ((r = RE_BR.exec(t))) [, dia, mes, ano] = r;
  else return null;

  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (
    data.getUTCFullYear() !== Number(ano) ||
    data.getUTCMonth() !== Number(mes) - 1 ||
    data.getUTCDate() !== Number(dia)
  ) {
    return null;
  }
  return `${ano}-${mes}-${dia}`;
}

function paraUtc(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** Quantos dias de `de` até `ate` (negativo se `ate` vem antes). */
export function diasEntre(de, ate) {
  return Math.round((paraUtc(ate) - paraUtc(de)) / 86_400_000);
}

/** A data `dias` depois (ou antes, se negativo). */
export function somarDias(iso, dias) {
  return new Date(paraUtc(iso) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Todos os dias de `de` a `ate`, inclusive. */
export function diasDoPeriodo(de, ate) {
  const dias = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** "2026-09-01" → "01/09/2026" */
export function dataBr(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
