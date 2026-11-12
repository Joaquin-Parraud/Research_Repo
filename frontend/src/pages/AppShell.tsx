import { useTranslation } from "react-i18next";
import type { User } from "../api/auth";
import { EmptyState } from "../components/EmptyState";
import { Header } from "../components/Header";
import { Pane } from "../components/Pane";
import styles from "./AppShell.module.css";

export function AppShell({ user }: { user: User }) {
  const { t } = useTranslation("shell");

  return (
    <div className={styles.shell}>
      <Header user={user} />
      <main className={styles.panes}>
        <div className={styles.left}>
          <Pane title={t("projects.title")}>
            <EmptyState title={t("projects.empty.title")} body={t("projects.empty.body")} />
          </Pane>
        </div>
        <div className={styles.middle}>
          <Pane title={t("sources.title")}>
            <EmptyState title={t("sources.empty.title")} body={t("sources.empty.body")} />
          </Pane>
        </div>
        <div className={styles.right}>
          <Pane title={t("viewer.title")}>
            <EmptyState title={t("viewer.empty.title")} body={t("viewer.empty.body")} />
          </Pane>
          <Pane title={t("citation.title")}>
            <EmptyState body={t("citation.empty.body")} />
          </Pane>
        </div>
      </main>
    </div>
  );
}
