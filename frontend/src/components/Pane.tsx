import type { ReactNode } from "react";
import styles from "./Pane.module.css";

interface PaneProps {
  title: string;
  children: ReactNode;
}

export function Pane({ title, children }: PaneProps) {
  return (
    <section className={styles.pane} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
