import VirtualSettings from "@/modules/crm/components/virtual-settings";
import {
  VirtualCredit,
  VirtualHeader,
} from "@/modules/crm/components/virtual-header";
import styles from "@/modules/crm/components/virtual.module.css";
export default function Page() {
  return (
    <main className={styles.page}>
      <VirtualHeader section="limites" />
      <VirtualSettings />
      <VirtualCredit />
    </main>
  );
}
