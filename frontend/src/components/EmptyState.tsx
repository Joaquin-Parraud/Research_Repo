import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  title?: string;
  body: string;
}

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {title && <p className={styles.title}>{title}</p>}
      <p className={styles.body}>{body}</p>
    </div>
  );
}
