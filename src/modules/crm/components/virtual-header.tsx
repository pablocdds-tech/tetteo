import Link from "next/link";
import styles from "./virtual.module.css";

export function VirtualHeader({
  section,
  children,
}: {
  section: "inbox" | "escalacoes" | "saude" | "base" | "conexoes";
  children?: React.ReactNode;
}) {
  const titles = {
    inbox: "Atendimento virtual",
    escalacoes: "Escalações da equipe",
    saude: "Saúde do atendimento",
    base: "Informações da unidade",
    conexoes: "Conexões do atendimento",
  };
  return (
    <>
      <header className={styles.heading}>
        <div>
          <h1>{titles[section]}</h1>
          <p>
            Conversas com contexto, reservas e passagem para uma pessoa da
            Vitaliano.
          </p>
        </div>
        {children}
      </header>
      <div className={styles.toolbar}>
        <nav className={styles.navigation} aria-label="Atendimento virtual">
          {[
            ["inbox", "/crm/atendimento", "Inbox"],
            ["escalacoes", "/crm/atendimento/escalacoes", "Escalações"],
            ["saude", "/crm/atendimento/saude", "Saúde da operação"],
            ["base", "/crm/atendimento/base", "Informações da unidade"],
            ["conexoes", "/crm/atendimento/conexoes", "Conexões"],
          ].map(([key, href, label]) => (
            <Link
              key={key}
              href={href}
              aria-current={section === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className={styles.demo} style={{ marginTop: 16 }}>
        <strong>Canal de demonstração</strong>
        <span>
          Canal local com mensagens fictícias. Nenhum número real recebe envios.
        </span>
      </div>
    </>
  );
}

export function VirtualCredit() {
  return (
    <p className={styles.credit}>
      Fluxo e composição inspirados nas prévias ilustrativas de atendimento da{" "}
      <a
        href="https://portal.kairulabs.com.br/images/solutions/atendimento-virtual-1.png"
        target="_blank"
        rel="noreferrer"
      >
        Kairu
      </a>
      , adaptados ao Tetteo. Os exemplos não comprovam atendimento ou entrega
      real.
    </p>
  );
}
