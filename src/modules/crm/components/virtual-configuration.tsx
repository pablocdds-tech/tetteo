import VirtualConnections from "./virtual-connections";
import { VirtualCredit, VirtualHeader } from "./virtual-header";
import styles from "./virtual.module.css";

export default function VirtualConfiguration() {
  return (
    <main className={styles.page}>
      <VirtualHeader section="configuracao" />
      <section id="gemini" aria-label="Conexão do Gemini">
        <VirtualConnections embedded />
      </section>
      <VirtualCredit />
    </main>
  );
}
