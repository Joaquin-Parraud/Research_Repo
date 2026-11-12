import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MetadataStatus } from "../../api/csl";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { useToast } from "../../components/Toast";
import { useProject } from "../projects/useProjects";
import { copyRich, copyText } from "./clipboard";
import { parseSafeHtml, SafeHtml, safeText, serializeSafeHtml } from "./safeHtml";
import { useCitation } from "./useCitation";
import styles from "./CitationPanel.module.css";

interface Props {
  projectId: string;
  sourceId: string;
  updatedAt: string;
  status: MetadataStatus;
  /** Opens the metadata editor; only offered to people who can edit. */
  onEditMetadata?: () => void;
}

/** APA 7 reference (with italics) and both in-text forms, each with copy buttons. */
export function CitationPanel({ projectId, sourceId, updatedAt, status, onEditMetadata }: Props) {
  const { t, i18n } = useTranslation("metadata");
  const toast = useToast();
  const project = useProject(projectId);
  const citation = useCitation({
    sourceId,
    updatedAt,
    locale: project.data?.citation_locale,
    status,
  });
  const data = citation.data;
  const parsed = useMemo(() => (data ? parseSafeHtml(data.reference_html) : []), [data]);

  async function copy(action: () => Promise<boolean>) {
    const ok = await action();
    toast.show(ok ? t("citation.copied") : t("citation.copyFailed"), ok ? "info" : "error");
  }

  return (
    <section className={styles.panel} aria-label={t("citation.heading")}>
      <h4 className={styles.heading}>{t("citation.heading")}</h4>

      {status === "pending" && (
        <div className={styles.empty}>
          <p>{t("citation.pending")}</p>
          {onEditMetadata && (
            <Button size="small" onClick={onEditMetadata}>
              {t("citation.addMetadata")}
            </Button>
          )}
        </div>
      )}

      {status !== "pending" && citation.isError && !data && (
        <p role="alert" className={styles.error}>
          {translateError(i18n, citation.error)}{" "}
          <Button size="small" onClick={() => void citation.refetch()}>
            {t("common:retry")}
          </Button>
        </p>
      )}
      {status !== "pending" && citation.isPending && (
        <p role="status" className={styles.muted}>
          {t("citation.loading")}
        </p>
      )}

      {status !== "pending" && data && (
        <div className={styles.body}>
          {status === "suggested" && <p className={styles.notice}>{t("citation.suggestedNotice")}</p>}

          <div className={styles.entry}>
            <div className={styles.label} id={`ref-label-${sourceId}`}>
              {t("citation.reference")}
            </div>
            <p className={styles.reference} aria-labelledby={`ref-label-${sourceId}`}>
              <SafeHtml html={data.reference_html} />
            </p>
            <div className={styles.actions}>
              <Button size="small" onClick={() => void copy(() => copyText(data.reference_text))}>
                {t("citation.copyReference")}
              </Button>
              <Button
                size="small"
                onClick={() =>
                  void copy(() => copyRich(serializeSafeHtml(parsed), safeText(parsed) || data.reference_text))
                }
              >
                {t("citation.copyFormatted")}
              </Button>
            </div>
          </div>

          <InText
            label={t("citation.parenthetical")}
            value={data.in_text_parenthetical}
            copyLabel={t("citation.copyParenthetical")}
            onCopy={() => void copy(() => copyText(data.in_text_parenthetical))}
          />
          <InText
            label={t("citation.narrative")}
            value={data.in_text_narrative}
            copyLabel={t("citation.copyNarrative")}
            onCopy={() => void copy(() => copyText(data.in_text_narrative))}
          />

          <p className={styles.fine}>
            {t("citation.styleNote", {
              language: t(`citation.locale.${data.locale}`, { defaultValue: data.locale }),
            })}
          </p>
        </div>
      )}
    </section>
  );
}

function InText(props: { label: string; value: string; copyLabel: string; onCopy: () => void }) {
  return (
    <div className={styles.entry}>
      <div className={styles.label}>{props.label}</div>
      <div className={styles.inText}>
        <span className={styles.inTextValue}>{props.value}</span>
        <Button size="small" onClick={props.onCopy}>
          {props.copyLabel}
        </Button>
      </div>
    </div>
  );
}
