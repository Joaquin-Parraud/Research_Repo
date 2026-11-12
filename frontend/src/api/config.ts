import { apiRequest } from "./client";

export interface AppConfig {
  max_upload_mb: number;
  metadata_lookup_enabled: boolean;
}

export const getConfig = () => apiRequest<AppConfig>("GET", "/config");
