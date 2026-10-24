import type { Metadata } from "next";
import { recuperacaoConfigurada } from "@/core/auth/politicas";
import { FormularioRecuperacao } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recuperar senha · Tetteo" };

export default function PaginaRecuperacao() {
  return <FormularioRecuperacao disponivel={recuperacaoConfigurada()} />;
}
