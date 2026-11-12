import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useUploadItems, useUploadQueue } from "./UploadProvider";
import type { UploadItem } from "./uploadQueue";
import styles from "./UploadPanel.module.css";

function UploadRow({ item }: { item: UploadItem }) {
  const { t, i18n } = useTranslation("library");
  const queue = useUploadQueue();
  const { openSource } = useAppNavigation();

  return (
    <li className={styles.item}>
      <span className={styles.name} title={item.file.name}>
        {item.file.name}
      </span>
      {(item.status === "uploading" || item.status === "queued") && (
        <progress
          className={styles.progress}
          max={1}
          value={item.status === "queued" ? 0 : item.progress}
          aria-label={t("upload.progressLabel", { name: item.file.name })}
        />
      )}
      <span className={item.status === "failed" ? styles.errorText : styles.status}>
        {item.status === "queued" && t("upload.status.queued")}
        {item.status === "uploading" &&
          t("upload.status.uploading", { percent: Math.round(item.progress * 100) })}
        {item.status === "done" && t("upload.status.done")}
        {item.status === "duplicate" && t("upload.status.duplicate")}
        {item.status === "failed" && translateError(i18n, item.error)}
      </span>
      <div className={styles.actions}>
        {item.status === "failed" && (
          <Button size="small" onClick={() => queue.retry(item.id)}>
            {t("upload.retry")}
          </Button>
        )}
        {item.status === "duplicate" && (
          <>
            <Button size="small" variant="primary" onClick={() => queue.addAnyway(item.id)}>
              {t("upload.addAnyway")}
            </Button>
            <Button size="small" onClick={() => queue.dismiss(item.id)}>
              {t("upload.skip")}
            </Button>
            {item.existingSourceId && (
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  if (item.existingSourceId) openSource(item.existingSourceId);
                }}
              >
                {t("upload.showExisting")}
              </Button>
            )}
          </>
        )}
        {(item.status === "failed" || item.status === "done" || item.status === "queued" || item.status === "uploading") && (
          <Button size="small" variant="ghost" onClick={() => queue.dismiss(item.id)}>
            {item.status === "uploading" || item.status === "queued" ? t("upload.cancel") : t("upload.dismiss")}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Queue of uploads with per-file progress, success and failure states. */
export function UploadPanel() {
  const { t } = useTranslation("library");
  const items = useUploadItems();
  const queue = useUploadQueue();
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;
  const active = items.filter((item) => item.status === "queued" || item.status === "uploading").length;

  return (
    <section className={styles.panel} aria-label={t("upload.title")}>
      <div className={styles.header}>
        <h2 className={styles.heading}>
          {t("upload.title")}
          {active > 0 ? ` · ${t("upload.active", { count: active })}` : ""}
        </h2>
        <div className={styles.headerActions}>
          <Button size="small" variant="ghost" onClick={() => queue.clearFinished()}>
            {t("upload.clearFinished")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? t("upload.expand") : t("upload.collapse")}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <ul className={styles.list}>
          {items.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
