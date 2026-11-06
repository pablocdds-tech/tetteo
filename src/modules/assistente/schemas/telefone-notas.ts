export function formatarTelefone(telefone: string) {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(telefone);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : telefone;
}
