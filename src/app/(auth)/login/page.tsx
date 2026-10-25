import { googleConfigurado } from "@/core/auth/politicas";
import { FormularioLogin } from "./formulario";

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; senha?: string }>;
}) {
  const parametros = await searchParams;
  return (
    <FormularioLogin
      googleDisponivel={googleConfigurado()}
      erroGoogle={Boolean(parametros.error)}
      senhaRedefinida={parametros.senha === "redefinida"}
    />
  );
}
