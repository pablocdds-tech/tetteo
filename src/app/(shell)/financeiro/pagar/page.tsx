import { redirect } from "next/navigation";
export default function Pagina() {
  redirect("/financeiro/lancamentos?direcao=PAGAR");
}
