"use client";

import { useFormStatus } from "react-dom";
import { Botao } from "@/design-system/botao";

export function BotaoAcaoCw({
  children,
  secundario = false,
}: {
  children: React.ReactNode;
  secundario?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Botao
      type="submit"
      peso={secundario ? "secundario" : "primario"}
      tamanho="pequeno"
      carregando={pending}
    >
      {children}
    </Botao>
  );
}
