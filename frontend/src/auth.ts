import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getMe, login, logout, updateMe, type Language, type User } from "./api/auth";
import { ApiError } from "./api/errors";
import { isLanguage } from "./i18n";

const ME_KEY = ["auth", "me"] as const;

/** Current user, or null when not logged in. `isPending` is true until known. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        return await getMe();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.setQueryData(ME_KEY, null),
  });
}

/** Changes the UI language now and, when logged in, persists it. */
export function useChangeLanguage() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const persist = useMutation({
    mutationFn: (language: Language) => updateMe({ language }),
    onSuccess: (updated) => queryClient.setQueryData(ME_KEY, updated),
  });

  return (language: Language) => {
    void i18n.changeLanguage(language);
    if (user && user.language !== language) persist.mutate(language);
  };
}

/** Keeps the UI language in step with the logged-in user's saved language. */
export function useSyncUserLanguage() {
  const { i18n } = useTranslation();
  const { data: user } = useCurrentUser();
  const saved = user?.language;
  useEffect(() => {
    if (saved && isLanguage(saved) && saved !== i18n.resolvedLanguage) {
      void i18n.changeLanguage(saved);
    }
    // Only react to the saved value changing (login, refresh), not to i18n updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
}
