"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./campaigns.module.css";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <nav className={styles.tabs} aria-label="Áreas do CRM">
        {[
          ["/crm", "Contatos"],
          ["/crm/publicos", "Públicos"],
          ["/crm/campanhas", "Campanhas e resultados"],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
