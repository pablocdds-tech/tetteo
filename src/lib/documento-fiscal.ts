/** Validadores puros: não consultam Receita/SEFAZ e não comprovam autorização de uso. */
export function cnpjValido(valor: string): boolean {
  if (!/^\d{14}$/.test(valor) || /^(\d)\1+$/.test(valor)) return false;
  const digito = (base: string) => {
    let peso = base.length - 7;
    const soma = [...base].reduce((s, n) => {
      const v = s + Number(n) * peso--;
      if (peso < 2) peso = 9;
      return v;
    }, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return (
    digito(valor.slice(0, 12)) === Number(valor[12]) &&
    digito(valor.slice(0, 13)) === Number(valor[13])
  );
}

export function cpfValido(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1+$/.test(v)) return false;
  const dv = (n: number) => {
    const r =
      ([...v.slice(0, n)].reduce((s, d, i) => s + Number(d) * (n + 1 - i), 0) *
        10) %
      11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(v[9]) && dv(10) === Number(v[10]);
}
export const documentoFiscalValido = (v: string) =>
  v.length === 11 ? cpfValido(v) : cnpjValido(v);

export function digitoChaveFiscal(base: string): string {
  if (!/^\d{43}$/.test(base)) return "";
  const soma = [...base]
    .reverse()
    .reduce((s, d, i) => s + Number(d) * (2 + (i % 8)), 0);
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}
export function chaveFiscalValida(v: string): boolean {
  return (
    /^\d{44}$/.test(v) &&
    !/^(\d)\1+$/.test(v) &&
    digitoChaveFiscal(v.slice(0, 43)) === v[43] &&
    cnpjValido(v.slice(6, 20)) &&
    ["55", "65"].includes(v.slice(20, 22)) &&
    Number(v.slice(4, 6)) >= 1 &&
    Number(v.slice(4, 6)) <= 12
  );
}
export function dadosDaChave(v: string) {
  if (!chaveFiscalValida(v)) return null;
  return {
    cnpj: v.slice(6, 20),
    modelo: v.slice(20, 22),
    serie: v.slice(22, 25),
    numero: v.slice(25, 34),
    anoMes: v.slice(2, 6),
  };
}
export function eanValido(v: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(v) || /^(\d)\1+$/.test(v))
    return false;
  const soma = [...v.slice(0, -1)]
    .reverse()
    .reduce((s, d, i) => s + Number(d) * (i % 2 ? 1 : 3), 0);
  return (10 - (soma % 10)) % 10 === Number(v.at(-1));
}
/** Política de arredondamento, definida pelo operador, nunca pelo documento/modelo. */
export function toleranciaFiscalCentavos(): number {
  const v = process.env.NOTAS_TOLERANCIA_CENTAVOS;
  return v && /^\d+$/.test(v) && Number(v) <= 5 ? Number(v) : 1;
}
