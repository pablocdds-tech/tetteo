"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/modules/crm/components/virtual-navigation.module.css";
export default function EquipeNavigation({
  configure,
  bind,
}: {
  configure: boolean;
  bind: boolean;
}) {
  const path = usePathname();
  const links = [
    ["notas", "Notas pelo WhatsApp"],
    ["avisos", "Avisos e disparos"],
    ["conversas", "Conversas da equipe"],
    ["whatsapp", "WhatsApp da equipe"],
    ...(configure ? [["agentes", "Agentes de aviso"]] : []),
    ...(bind ? [["vinculos", "Pessoas e números"]] : []),
    ["eventos", "Eventos"],
  ];
  return (
    <nav className={styles.tabs} aria-label="Equipe e avisos">
      {links.map(([key, title]) => {
        const href = `/assistente/equipe/${key}`;
        return (
          <Link
            key={key}
            href={href}
            aria-current={
              path === href || path.startsWith(`${href}/`) ? "page" : undefined
            }
          >
            {title}
          </Link>
        );
      })}
    </nav>
  );
}
