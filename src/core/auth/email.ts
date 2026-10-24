import { recuperacaoConfigurada } from "./politicas";

/** O conteúdo e o link nunca entram no log. O provedor só recebe o e-mail solicitado. */
export async function enviarRecuperacao(email: string, link: string) {
  if (!recuperacaoConfigurada()) throw new Error("RECUPERACAO_INDISPONIVEL");
  const resposta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM,
      to: [email],
      subject: "Redefina sua senha do Tetteo",
      text: `Você pediu para redefinir sua senha do Tetteo.\n\nAbra este link em até 30 minutos:\n${link}\n\nO link funciona uma única vez. Se não foi você, ignore este e-mail; sua senha continua igual.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resposta.ok) throw new Error("ENVIO_RECUPERACAO_FALHOU");
}
