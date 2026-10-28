"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";

const Ambientes = createContext<{
  principal: string;
  rotaAplicativo: string;
} | null>(null);

export function ProvedorDeAmbientes({
  principal,
  rotaAplicativo,
  children,
}: {
  principal: string;
  rotaAplicativo: string;
  children: ReactNode;
}) {
  return (
    <Ambientes value={{ principal, rotaAplicativo }}>{children}</Ambientes>
  );
}

/** Uma navegação administrativa atravessa a origem com uma carga de página. */
export function LinkIntegrado({
  href,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  const ambiente = useContext(Ambientes);
  const foraDoAplicativo =
    ambiente &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    href !== ambiente.rotaAplicativo &&
    !href.startsWith(`${ambiente.rotaAplicativo}/`) &&
    !href.startsWith(`${ambiente.rotaAplicativo}?`);
  if (foraDoAplicativo)
    return <a href={`${ambiente.principal}${href}`} {...props} />;
  return <Link href={href} {...props} />;
}
