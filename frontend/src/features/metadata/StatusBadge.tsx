import { useTranslation } from "react-i18next";
import { type MetadataStatus } from "../../api/csl";
import styles from "./StatusBadge.module.css";

/** "Needs metadata" / "Review suggestion"; nothing once the metadata is confirmed. */
export function StatusBadge({ status }: { status: MetadataStatus }) {
  const { t } = useTranslation("metadata");
  if (status === "confirmed") return null;
  return (
    <span className={`${styles.badge} ${status === "pending" ? styles.pending : styles.suggested}`}>
      {t(`status.${status}`)}
    </span>
  );
}
