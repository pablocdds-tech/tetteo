import { googleConfigurado } from "@/core/auth/politicas";
import { FormularioLogin } from "./formulario";
import { superficiePublica } from "@/core/superficie";
import aparenciaPdv from "@/modules/pdv/components/pdv-aparencia.module.css";

export async function generateMetadata() {
  return {
    title: (await superficiePublica()).operacional
      ? "Entrar no PDV | Vitaliano"
      : "Entrar | Tetteo",
  };
}

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; senha?: string }>;
}) {
  const parametros = await searchParams;
  const superficie = await superficiePublica();
  return (
    <div
      className={
        superficie.operacional
          ? `${aparenciaPdv.aparencia} w-full max-w-sm`
          : "contents"
      }
    >
      <FormularioLogin
        operacional={superficie.operacional}
        googleDisponivel={googleConfigurado()}
        erroGoogle={Boolean(parametros.error)}
        senhaRedefinida={parametros.senha === "redefinida"}
      />
    </div>
  );
}
