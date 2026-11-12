import { useTranslation } from "react-i18next";
import type { User } from "../api/auth";
import { useLogout } from "../auth";
import { LanguageSwitcher } from "./LanguageSwitcher";
import styles from "./Header.module.css";

export function Header({ user }: { user: User }) {
  const { t } = useTranslation(["common", "auth"]);
  const logout = useLogout();

  return (
    <header className={styles.header}>
      <h1 className={styles.name}>{t("common:app.name")}</h1>
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
