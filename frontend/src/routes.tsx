import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router";
import { useCurrentUser, useSyncUserLanguage } from "./auth";
import { AppShell } from "./pages/AppShell";
import { LoginPage } from "./pages/LoginPage";

export function AppRoutes() {
  const { t } = useTranslation();
  const { data: user, isPending } = useCurrentUser();
  useSyncUserLanguage();

  if (isPending) return <p className="status">{t("loading")}</p>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      {/*
        One layout route for every app URL, so moving between project, folder and source
        URLs keeps the same AppShell mounted (upload queue, toasts, open dialogs).
        The shell reads the selection from the URL itself.
      */}
      <Route element={user ? <AppShell user={user} /> : <Navigate to="/login" replace />}>
        <Route path="/" element={null} />
        <Route path="/p/:projectId" element={null} />
        <Route path="/p/:projectId/f/:folderId" element={null} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
