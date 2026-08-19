export const env = {
  PORT: Number(Bun.env.PORT ?? 3000),
  JWT_SECRET: Bun.env.JWT_SECRET ?? "dev-secret",
  DATABASE_URL: Bun.env.DATABASE_URL ?? "",
  NODE_ENV: Bun.env.NODE_ENV ?? "development",
  CLIENT_URL: Bun.env.CLIENT_URL ?? "http://localhost:5173",
} as const;
