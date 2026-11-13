import { useTranslation } from "react-i18next";
import type { User } from "../api/auth";
import { useLogout } from "../auth";
import { LanguageSwitcher } from "./LanguageSwitcher";
import styles from "./Header.module.css";

interface HeaderProps {
  user: User;
  sidebarOpen: boolean;
  sidebarId: string;
  onToggleSidebar: () => void;
}

export function Header({ user, sidebarOpen, sidebarId, onToggleSidebar }: HeaderProps) {
  const { t } = useTranslation(["common", "auth"]);
  const logout = useLogout();

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          aria-label={t("common:sidebar.toggle")}
          onClick={onToggleSidebar}
        >
          <span aria-hidden="true">&#9776;</span>
        </button>
        <h1 className={styles.name}>{t("common:app.name")}</h1>
      </div>
      <div className={styles.actions}>
        <LanguageSwitcher />
        <span className={styles.user}>{user.display_name}</span>
        <button type="button" className={styles.button} onClick={() => logout.mutate()}>
          {t("auth:logout")}
        </button>
      </div>
    </header>
  );
}
