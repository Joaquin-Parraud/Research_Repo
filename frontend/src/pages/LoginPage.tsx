import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../api/translateError";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useLogin } from "../auth";
import styles from "./LoginPage.module.css";

export function LoginPage() {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <main className={styles.page}>
      <div className={styles.switcher}>
        <LanguageSwitcher />
      </div>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.brand}>{t("common:app.name")}</h1>
        <h2 className={styles.title}>{t("auth:login.title")}</h2>
        <p className={styles.subtitle}>{t("auth:login.subtitle")}</p>

        <label className={styles.field}>
          <span>{t("auth:login.email")}</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>{t("auth:login.password")}</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <div role="alert" className={styles.error}>
          {login.isError ? translateError(i18n, login.error) : null}
        </div>

        <button type="submit" className={styles.submit} disabled={login.isPending}>
          {login.isPending ? t("auth:login.submitting") : t("auth:login.submit")}
        </button>
      </form>
    </main>
  );
}
