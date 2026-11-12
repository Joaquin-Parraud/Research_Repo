import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router";
import i18n from "./i18n";
import { AppRoutes } from "./routes";

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
