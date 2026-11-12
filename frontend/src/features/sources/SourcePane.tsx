import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/translateError";
import { Button } from "../../components/Button";
import { Pane } from "../../components/Pane";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useSource } from "../library/useLibrary";
import { SourceDetails } from "./SourceDetails";
import styles from "./SourcePane.module.css";

// The viewer (and pdf.js with it) is only downloaded when a PDF is first opened.
const PdfViewer = lazy(() => import("../viewer/PdfViewer").then((module) => ({ default: module.PdfViewer })));

interface Props {
  projectId: string;
  sourceId: string;
  canWrite: boolean;
}

/** Right side when a source is open: the PDF viewer (or a citation-only card) plus its details. */
export function SourcePane({ projectId, sourceId, canWrite }: Props) {
  const { t, i18n } = useTranslation(["shell", "library", "viewer"]);
  const { closeSource } = useAppNavigation();
  const source = useSource(sourceId);

  if (source.isPending) {
    return (
      <Pane title={t("shell:viewer.title")}>
        <p role="status" className={styles.citationBody}>
          {t("common:loading")}
        </p>
      </Pane>
    );
  }
  if (source.isError) {
    return (
      <Pane title={t("shell:viewer.title")}>
        <div className={styles.citationOnly}>
          <p role="alert" className={styles.citationBody}>
            {translateError(i18n, source.error)}
          </p>
          <Button onClick={closeSource}>{t("library:sources.closeSource")}</Button>
        </div>
      </Pane>
    );
  }

  const data = source.data;
  return (
    <div className={styles.wrap}>
      <Pane title={t("shell:viewer.title")}>
        {data.has_file ? (
          <Suspense
            fallback={
              <p role="status" className={styles.citationBody}>
                {t("viewer:loading")}
              </p>
            }
          >
            <PdfViewer
              key={data.id}
              sourceId={data.id}
              initialPage={data.last_page_read}
              canSaveProgress={canWrite}
              onClose={closeSource}
            />
          </Suspense>
        ) : (
          <div className={styles.citationOnly}>
            <p className={styles.citationTitle}>{t("library:details.noPdf")}</p>
            <p className={styles.citationBody}>{t("library:details.citationOnlyBody")}</p>
            <Button onClick={closeSource}>{t("library:sources.closeSource")}</Button>
          </div>
        )}
      </Pane>
      <div className={styles.details}>
        <Pane title={t("shell:details.title")}>
          <SourceDetails projectId={projectId} source={data} canWrite={canWrite} />
        </Pane>
      </div>
    </div>
  );
}
