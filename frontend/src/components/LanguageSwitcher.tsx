import { useTranslation } from "react-i18next";
import { isLanguage, SUPPORTED_LANGUAGES } from "../i18n";
import { useChangeLanguage } from "../auth";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const changeLanguage = useChangeLanguage();
  const current = i18n.resolvedLanguage ?? "en";

  return (
    <label className={styles.wrapper}>
      <span className={styles.label}>{t("language.label")}</span>
      <select
        className={styles.select}
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          if (isLanguage(next)) changeLanguage(next);
        }}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`language.${language}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
