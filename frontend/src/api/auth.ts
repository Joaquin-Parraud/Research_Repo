import { apiRequest } from "./client";

export type Language = "en" | "es";

export interface User {
  id: string;
  email: string;
  display_name: string;
  language: Language;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateMeInput {
  language?: Language;
  display_name?: string;
}

export const login = (input: LoginInput) => apiRequest<User>("POST", "/auth/login", input);
export const logout = () => apiRequest<undefined>("POST", "/auth/logout");
export const getMe = () => apiRequest<User>("GET", "/auth/me");
export const updateMe = (input: UpdateMeInput) => apiRequest<User>("PATCH", "/auth/me", input);
