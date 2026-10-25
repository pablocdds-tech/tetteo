export function ContatoAcesso() {
  const email = process.env.AUTH_SUPPORT_EMAIL?.trim();
  return (
    <p>
      Para dúvidas sobre o acesso ou solicitações sobre seus dados,{" "}
      {email ? (
        <>
          entre em contato com o responsável pelo Tetteo em{" "}
          <a
            className="text-accent break-all underline underline-offset-4"
            href={`mailto:${email}`}
          >
            {email}
          </a>
          .
        </>
      ) : (
        "fale com o administrador da sua loja."
      )}
    </p>
  );
}
