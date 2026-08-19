import { env } from "./env";

export const databaseConfig = {
  url: env.DATABASE_URL,
  isConfigured: env.DATABASE_URL.length > 0,
} as const;
