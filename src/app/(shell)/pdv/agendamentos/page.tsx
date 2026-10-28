import { redirect } from "next/navigation";

/** Links anteriores abrem o filtro da mesma gestão, sem manter outra tela. */
export default function PaginaAgendamentosAnterior() {
  redirect("/pdv?visao=AGENDADOS");
}
