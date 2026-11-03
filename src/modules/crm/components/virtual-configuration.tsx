import VirtualConnections from "./virtual-connections";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import VirtualKnowledgePage from "./virtual-knowledge";
import styles from "./virtual.module.css";

export default function VirtualConfiguration() {
  return (
    <main className={styles.page}>
      <VirtualHeader section="configuracao" />
      <section id="gemini" aria-label="Conexão do Gemini">
        <VirtualConnections embedded />
      </section>
      <section id="informacoes" aria-label="Base operacional e limites">
        <VirtualKnowledgePage embedded />
      </section>
      <VirtualCredit />
    </main>
  );
}
